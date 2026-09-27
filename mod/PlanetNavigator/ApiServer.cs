using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using BepInEx.Logging;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace PlanetNavigator
{
    /// <summary>
    /// Local HTTP JSON + Server-Sent Events server.
    /// IMPORTANT: nothing in this class may touch the Unity API. It runs entirely on background
    /// threads and only reads immutable snapshots from <see cref="StateStore"/>.
    /// </summary>
    internal sealed class ApiServer
    {
        private const int PortAttempts = 6;          // port .. port+5
        private const int MaxSseClients = 16;
        private const int MaxBodyBytes = 64 * 1024;
        private const int MaxQueuedCommands = 256;
        private const int SseTickMs = 100;
        private const int KeepAliveMs = 15000;

        private static readonly byte[] EmptyPois = JsonUtil.Utf8.GetBytes("{\"planet\":null,\"scanId\":0,\"t\":0,\"items\":[]}");
        private static readonly byte[] NotFoundBody = JsonUtil.Utf8.GetBytes("{\"error\":\"not found\"}");
        private static readonly byte[] QueuedBody = JsonUtil.Utf8.GetBytes("{\"queued\":true}");

        private readonly StateStore _store;
        private readonly int _basePort;
        private readonly string _gameVersion;
        private readonly ManualLogSource _log;
        private readonly Stopwatch _uptime = Stopwatch.StartNew();
        private readonly ManualResetEvent _stopEvent = new ManualResetEvent(false);

        private HttpListener _listener;
        private Thread _acceptThread;
        private volatile bool _stopping;
        private int _stopCalled;
        private int _sseClients;

        public int Port { get; private set; }
        public int SseClients => Volatile.Read(ref _sseClients);

        /// <param name="gameVersion">Captured on the main thread (Application.version is a Unity API).</param>
        public ApiServer(StateStore store, int basePort, string gameVersion, ManualLogSource log)
        {
            _store = store ?? throw new ArgumentNullException(nameof(store));
            _basePort = basePort;
            _gameVersion = gameVersion;
            _log = log;
        }

        /// <summary>Binds the listener (with port fallback) and starts the accept thread. Throws if no port could be bound.</summary>
        public void Start()
        {
            Exception last = null;
            for (int i = 0; i < PortAttempts; i++)
            {
                int port = _basePort + i;
                if (port < 1 || port > 65535) continue;

                var listener = new HttpListener();
                try
                {
                    // Literal loopback IP: no URL ACL / admin rights needed, never exposed on the LAN.
                    listener.Prefixes.Add("http://127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture) + "/");
                    // IgnoreWriteExceptions stays false: SSE relies on write failures to detect disconnects.
                    listener.Start();
                    _listener = listener;
                    Port = port;
                    break;
                }
                catch (Exception ex)
                {
                    last = ex;
                    _log.LogWarning($"Could not bind http://127.0.0.1:{port}/ ({ex.GetType().Name}: {ex.Message})");
                    try { listener.Close(); } catch { /* ignore */ }
                }
            }

            if (_listener == null)
                throw new InvalidOperationException($"No free port in {_basePort}..{_basePort + PortAttempts - 1}", last);

            _acceptThread = new Thread(AcceptLoop)
            {
                IsBackground = true,
                Name = "PlanetNavigator.HttpAccept",
            };
            _acceptThread.Start();

            _log.LogInfo($"HTTP server listening on http://127.0.0.1:{Port}/");
        }

        /// <summary>Idempotent; safe to call from OnDestroy and OnApplicationQuit.</summary>
        public void Stop()
        {
            if (Interlocked.Exchange(ref _stopCalled, 1) != 0) return;

            _stopping = true;
            try { _stopEvent.Set(); } catch { /* ignore */ }

            var listener = _listener;
            if (listener != null)
            {
                try { listener.Stop(); } catch { /* ignore */ }
                try { listener.Close(); } catch { /* ignore */ }
            }

            var t = _acceptThread;
            if (t != null && t != Thread.CurrentThread)
            {
                try { t.Join(500); } catch { /* ignore */ }
            }

            _log.LogInfo("HTTP server stopped");
        }

        // ------------------------------------------------------------------ accept loop

        private void AcceptLoop()
        {
            var listener = _listener;
            while (!_stopping)
            {
                HttpListenerContext ctx;
                try
                {
                    ctx = listener.GetContext();
                }
                catch (Exception ex) when (ex is HttpListenerException || ex is ObjectDisposedException || ex is InvalidOperationException)
                {
                    if (_stopping || !IsListening(listener)) break;
                    _log.LogWarning($"Accept failed: {ex.GetType().Name}: {ex.Message}");
                    Thread.Sleep(50);
                    continue;
                }
                catch (Exception ex)
                {
                    if (_stopping) break;
                    _log.LogWarning($"Accept failed: {ex.GetType().Name}: {ex.Message}");
                    Thread.Sleep(50);
                    continue;
                }

                if (_stopping)
                {
                    SafeAbort(ctx);
                    break;
                }

                try
                {
                    Dispatch(ctx);
                }
                catch (Exception ex)
                {
                    // e.g. thread creation failure; never let the accept loop die.
                    _log.LogWarning($"Dispatch failed: {ex.GetType().Name}: {ex.Message}");
                    SafeAbort(ctx);
                }
            }
        }

        private static bool IsListening(HttpListener l)
        {
            try { return l.IsListening; } catch { return false; }
        }

        private void Dispatch(HttpListenerContext ctx)
        {
            var req = ctx.Request;
            if (req.HttpMethod == "GET" && PathOf(req) == "/api/events")
            {
                // Long-lived: dedicated thread so it never starves the ThreadPool.
                var t = new Thread(() => HandleSse(ctx))
                {
                    IsBackground = true,
                    Name = "PlanetNavigator.Sse",
                };
                t.Start();
            }
            else
            {
                ThreadPool.QueueUserWorkItem(_ => HandleRequest(ctx));
            }
        }

        private static string PathOf(HttpListenerRequest req)
        {
            string path = req.Url?.AbsolutePath ?? "/";
            if (path.Length > 1 && path.EndsWith("/", StringComparison.Ordinal)) path = path.TrimEnd('/');
            return path.ToLowerInvariant();
        }

        // ------------------------------------------------------------------ plain requests

        private void HandleRequest(HttpListenerContext ctx)
        {
            var req = ctx.Request;
            var res = ctx.Response;
            try
            {
                _store.Touch();
                SetCommonHeaders(res);

                string method = req.HttpMethod;
                string path = PathOf(req);

                if (method == "OPTIONS")
                {
                    res.StatusCode = 204;
                    return;
                }

                if (method == "GET" && path == "/api/status") { HandleStatus(res); return; }
                if (method == "GET" && path == "/api/position") { HandlePosition(res); return; }
                if (method == "GET" && path == "/api/pois") { HandlePois(req, res); return; }
                if (method == "POST" && path == "/api/command") { HandleCommand(req, res); return; }

                WriteJson(res, 404, NotFoundBody);
            }
            catch (Exception ex) when (IsDisconnect(ex))
            {
                Plugin.LogDebug($"Client disconnected during {req.HttpMethod} {req.Url?.AbsolutePath}: {ex.GetType().Name}");
            }
            catch (Exception ex)
            {
                _log.LogWarning($"Request {req.HttpMethod} {req.Url?.AbsolutePath} failed: {ex.GetType().Name}: {ex.Message}");
                try { WriteJson(res, 500, JsonUtil.SerializeUtf8(new { error = "internal error" })); } catch { /* headers may be sent */ }
            }
            finally
            {
                SafeClose(res);
            }
        }

        private void HandleStatus(HttpListenerResponse res)
        {
            var pos = _store.Position;
            var pois = _store.Pois;
            var body = JsonUtil.SerializeUtf8(new
            {
                modVersion = PluginInfo.PLUGIN_VERSION,
                gameVersion = _gameVersion,
                port = Port,
                planet = pos?.Planet,
                playerName = pos?.LocalPlayer?.Name,
                scanId = pois?.ScanId ?? 0,
                poiCount = pois?.Count ?? 0,
                ti = pos?.Ti ?? 0d,
                lushThreshold = pos?.LushThreshold ?? 0d,
                uptimeSeconds = Math.Round(_uptime.Elapsed.TotalSeconds, 1),
                sseClients = SseClients,
                samplerState = PositionSampler.LastNullReason ?? "ok",
            });
            WriteJson(res, 200, body);
        }

        private void HandlePosition(HttpListenerResponse res)
        {
            var pos = _store.Position;
            if (pos == null)
            {
                res.StatusCode = 204; // in menu / loading: no body
                return;
            }
            WriteJson(res, 200, pos.JsonUtf8);
        }

        private void HandlePois(HttpListenerRequest req, HttpListenerResponse res)
        {
            var pois = _store.Pois;
            if (pois == null)
            {
                WriteJson(res, 200, EmptyPois);
                return;
            }

            string sinceRaw = req.QueryString["since"];
            if (sinceRaw != null
                && long.TryParse(sinceRaw, NumberStyles.Integer, CultureInfo.InvariantCulture, out long since)
                && since == pois.ScanId)
            {
                res.StatusCode = 304;
                return;
            }

            WriteJson(res, 200, pois.JsonUtf8);
        }

        private void HandleCommand(HttpListenerRequest req, HttpListenerResponse res)
        {
            if (req.ContentLength64 > MaxBodyBytes)
            {
                WriteJson(res, 413, JsonUtil.SerializeUtf8(new { error = "body too large" }));
                return;
            }

            string text;
            try
            {
                text = ReadBody(req);
            }
            catch (InvalidDataException)
            {
                WriteJson(res, 413, JsonUtil.SerializeUtf8(new { error = "body too large" }));
                return;
            }

            JObject obj;
            try
            {
                obj = string.IsNullOrWhiteSpace(text) ? null : JsonUtil.ParseObject(text);
            }
            catch (JsonException)
            {
                obj = null;
            }

            string type = null;
            if (obj != null && obj.TryGetValue("type", StringComparison.Ordinal, out JToken typeToken) && typeToken.Type == JTokenType.String)
                type = ((string)typeToken)?.Trim();

            if (obj == null || string.IsNullOrEmpty(type))
            {
                WriteJson(res, 400, JsonUtil.SerializeUtf8(new { error = "bad json: expected an object with a string \"type\"" }));
                return;
            }

            if (_store.Commands.Count >= MaxQueuedCommands)
            {
                WriteJson(res, 503, JsonUtil.SerializeUtf8(new { error = "command queue full" }));
                return;
            }

            _store.Commands.Enqueue(new Command { Type = type, Payload = obj });
            WriteJson(res, 202, QueuedBody);
        }

        private static string ReadBody(HttpListenerRequest req)
        {
            if (!req.HasEntityBody) return string.Empty;
            var encoding = req.ContentEncoding ?? Encoding.UTF8;
            using (var input = req.InputStream)
            using (var ms = new MemoryStream())
            {
                var buf = new byte[8192];
                int n;
                while ((n = input.Read(buf, 0, buf.Length)) > 0)
                {
                    ms.Write(buf, 0, n);
                    if (ms.Length > MaxBodyBytes) throw new InvalidDataException("body too large");
                }
                return encoding.GetString(ms.GetBuffer(), 0, (int)ms.Length);
            }
        }

        // ------------------------------------------------------------------ SSE

        private void HandleSse(HttpListenerContext ctx)
        {
            var res = ctx.Response;
            int clients = Interlocked.Increment(ref _sseClients);
            try
            {
                _store.Touch();
                SetCommonHeaders(res);

                if (clients > MaxSseClients)
                {
                    WriteJson(res, 503, JsonUtil.SerializeUtf8(new { error = "too many event stream clients" }));
                    return;
                }

                res.StatusCode = 200;
                res.ContentType = "text/event-stream";
                res.SendChunked = true;
                res.KeepAlive = true;

                Plugin.LogDebug($"SSE client connected ({clients} active)");

                // Disposing the writer closes the response stream; the finally below also closes the response.
                using (var writer = new StreamWriter(res.OutputStream, new UTF8Encoding(false), 8192))
                {
                    writer.NewLine = "\n";
                    writer.Write("retry: 2000\n\n");
                    writer.Flush();

                    long lastSeq = long.MinValue;
                    long lastScanId = long.MinValue;
                    string lastPlanet = null;
                    bool planetSent = false;
                    var sinceKeepAlive = Stopwatch.StartNew();

                    while (!_stopping)
                    {
                        bool wrote = false;

                        var pos = _store.Position;
                        string planet = pos?.Planet;

                        // Planet first so clients switch maps before receiving the new position.
                        if (!planetSent || !string.Equals(planet, lastPlanet, StringComparison.Ordinal))
                        {
                            WriteEvent(writer, "planet", JsonUtil.Serialize(new { planet }));
                            lastPlanet = planet;
                            planetSent = true;
                            wrote = true;
                        }

                        if (pos != null && pos.Seq != lastSeq)
                        {
                            WriteEvent(writer, "position", pos.Json);
                            lastSeq = pos.Seq;
                            wrote = true;
                        }

                        var pois = _store.Pois;
                        long scanId = pois?.ScanId ?? 0;
                        if (scanId != lastScanId)
                        {
                            WriteEvent(writer, "pois", JsonUtil.Serialize(new { scanId, planet = pois?.Planet }));
                            lastScanId = scanId;
                            wrote = true;
                        }

                        if (sinceKeepAlive.ElapsedMilliseconds >= KeepAliveMs)
                        {
                            writer.Write(": keepalive\n\n");
                            sinceKeepAlive.Restart();
                            wrote = true;
                        }

                        if (wrote) writer.Flush();

                        // An open event stream counts as an active client for the scan loop.
                        _store.Touch();

                        // Wakes immediately on Stop().
                        if (_stopEvent.WaitOne(SseTickMs)) break;
                    }
                }
            }
            catch (Exception ex) when (IsDisconnect(ex))
            {
                Plugin.LogDebug($"SSE client disconnected: {ex.GetType().Name}");
            }
            catch (Exception ex)
            {
                _log.LogWarning($"SSE stream failed: {ex.GetType().Name}: {ex.Message}");
            }
            finally
            {
                int left = Interlocked.Decrement(ref _sseClients);
                SafeClose(res);
                Plugin.LogDebug($"SSE client closed ({left} active)");
            }
        }

        private static void WriteEvent(StreamWriter writer, string name, string json)
        {
            // Payloads are single-line JSON (Formatting.None), so one data: line is enough.
            writer.Write("event: ");
            writer.Write(name);
            writer.Write("\ndata: ");
            writer.Write(json);
            writer.Write("\n\n");
        }

        // ------------------------------------------------------------------ helpers

        private static void SetCommonHeaders(HttpListenerResponse res)
        {
            res.Headers["Access-Control-Allow-Origin"] = "*";
            res.Headers["Access-Control-Allow-Headers"] = "Content-Type";
            res.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
            // Chrome Private Network Access preflights (harmless elsewhere).
            res.Headers["Access-Control-Allow-Private-Network"] = "true";
            res.Headers["Cache-Control"] = "no-cache";
        }

        private static void WriteJson(HttpListenerResponse res, int status, byte[] body)
        {
            res.StatusCode = status;
            res.ContentType = "application/json; charset=utf-8";
            res.ContentLength64 = body.Length;
            res.OutputStream.Write(body, 0, body.Length);
        }

        private static bool IsDisconnect(Exception ex) =>
            ex is IOException || ex is HttpListenerException || ex is ObjectDisposedException
            || ex.InnerException is IOException || ex.InnerException is System.Net.Sockets.SocketException;

        private static void SafeClose(HttpListenerResponse res)
        {
            try { res.Close(); }
            catch (Exception) { /* client gone or listener closed */ }
        }

        private static void SafeAbort(HttpListenerContext ctx)
        {
            try { ctx.Response.Abort(); }
            catch (Exception) { /* ignore */ }
        }
    }
}
