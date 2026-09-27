using System;
using System.Collections;
using BepInEx;
using BepInEx.Configuration;
using BepInEx.Logging;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace PlanetNavigator
{
    [BepInPlugin(PluginInfo.PLUGIN_GUID, PluginInfo.PLUGIN_NAME, PluginInfo.PLUGIN_VERSION)]
    public class Plugin : BaseUnityPlugin
    {
        internal static ManualLogSource Log;
        private static volatile bool _verbose;

        private const int MaxCommandsPerFrame = 32;
        private const float SceneSettleSeconds = 5f;

        private ConfigEntry<int> _port;
        private ConfigEntry<bool> _serverEnabled;
        private ConfigEntry<int> _positionHz;
        private ConfigEntry<float> _scanInterval;
        private ConfigEntry<bool> _scanEnabled;
        private ConfigEntry<bool> _verboseLogging;

        private StateStore _store;
        private ApiServer _server;
        private long _seq;
        private float _nextSampleTime;
        private float _sceneRescanAt = -1f;
        private bool _sampleFailLogged;
        private bool _scanLoopFailLogged;

        /// <summary>Debug-level log, promoted to Info when Logging.Verbose is on. Any thread.</summary>
        internal static void LogVerbose(string message)
        {
            if (Log == null) return;
            if (_verbose) Log.LogInfo(message);
            else Log.LogDebug(message);
        }

        /// <summary>Alias kept for readability at call sites that are pure diagnostics.</summary>
        internal static void LogDebug(string message) => LogVerbose(message);

        private void Awake()
        {
            Log = Logger;

            _port = Config.Bind("Server", "Port", 27641,
                "First TCP port to try on 127.0.0.1. If busy, Port+1 .. Port+5 are tried.");
            _serverEnabled = Config.Bind("Server", "Enabled", true,
                "Enable the local HTTP/SSE server used by the companion app.");
            _positionHz = Config.Bind("Sampling", "PositionHz", 10,
                new ConfigDescription("Player position samples per second.", new AcceptableValueRange<int>(1, 30)));
            _scanInterval = Config.Bind("Scan", "IntervalSeconds", 20f,
                "Seconds between automatic resource scans while a client is connected (minimum 1).");
            _scanEnabled = Config.Bind("Scan", "Enabled", true,
                "Enable scanning the loaded scene for resource nodes and containers.");
            _verboseLogging = Config.Bind("Logging", "Verbose", false,
                "Log diagnostic messages (scan timings, client connects) at Info level.");

            _verbose = _verboseLogging.Value;
            _verboseLogging.SettingChanged += (_, __) => _verbose = _verboseLogging.Value;

            _store = new StateStore();

            if (_serverEnabled.Value)
            {
                try
                {
                    // Application.version is a Unity API: read it here, on the main thread.
                    string gameVersion = Application.version;
                    var server = new ApiServer(_store, _port.Value, gameVersion, Log);
                    server.Start();
                    _server = server;
                }
                catch (Exception ex)
                {
                    _server = null;
                    Log.LogError($"HTTP server failed to start; the companion app will not connect. {ex.GetType().Name}: {ex.Message}");
                }
            }
            else
            {
                Log.LogInfo("HTTP server disabled by config (Server.Enabled = false)");
            }

            SceneManager.sceneLoaded += OnSceneLoaded;
            StartCoroutine(ScanLoop());

            Log.LogInfo($"{PluginInfo.PLUGIN_NAME} {PluginInfo.PLUGIN_VERSION} loaded");
        }

        private void Update()
        {
            if (_server == null) return;

            float now = Time.unscaledTime;
            if (now >= _nextSampleTime)
            {
                int hz = Mathf.Clamp(_positionHz.Value, 1, 30);
                float period = 1f / hz;
                // Stay on a fixed cadence, but don't burst to catch up after a hitch.
                _nextSampleTime = Mathf.Max(_nextSampleTime + period, now + period * 0.5f);

                try
                {
                    _store.PublishPosition(PositionSampler.Sample(++_seq));
                }
                catch (Exception ex)
                {
                    _store.PublishPosition(null);
                    if (!_sampleFailLogged)
                    {
                        _sampleFailLogged = true;
                        Log.LogWarning($"Position sampling failed (reported once): {ex}");
                    }
                }
            }

            for (int i = 0; i < MaxCommandsPerFrame && _store.Commands.TryDequeue(out var cmd); i++)
            {
                try { CommandHandler.Handle(cmd, _store); }
                catch (Exception ex) { Log.LogWarning($"Command '{cmd?.Type}' failed: {ex.GetType().Name}: {ex.Message}"); }
            }
        }

        private IEnumerator ScanLoop()
        {
            while (true)
            {
                yield return new WaitForSecondsRealtime(1f);

                string planet = null;
                bool scan = false;
                try
                {
                    if (_sceneRescanAt >= 0f && Time.unscaledTime >= _sceneRescanAt)
                    {
                        // Follow-up scan once streamed-in world objects have settled.
                        _sceneRescanAt = -1f;
                        _store.RescanRequested = true;
                    }

                    if (_server != null && _scanEnabled.Value)
                    {
                        planet = _store.Position?.Planet;
                        if (planet != null)
                        {
                            float interval = Mathf.Max(1f, _scanInterval.Value);
                            scan = Scanner.ShouldScan(interval, _store, Time.unscaledTime);
                        }
                    }
                }
                catch (Exception ex)
                {
                    if (!_scanLoopFailLogged)
                    {
                        _scanLoopFailLogged = true;
                        Log.LogWarning($"Scan scheduling failed (reported once): {ex.GetType().Name}: {ex.Message}");
                    }
                }

                if (scan)
                    yield return StartCoroutine(Scanner.ScanCoroutine(_store, planet));
            }
        }

        private void OnSceneLoaded(Scene scene, LoadSceneMode mode)
        {
            if (_store == null) return;
            _store.RescanRequested = true;
            _sceneRescanAt = Time.unscaledTime + SceneSettleSeconds;
            LogVerbose($"Scene loaded: {scene.name} ({mode}); rescan requested");
        }

        private void OnDestroy()
        {
            SceneManager.sceneLoaded -= OnSceneLoaded;
            _server?.Stop();
        }

        private void OnApplicationQuit()
        {
            _server?.Stop();
        }
    }
}
