using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace PlanetNavigator
{
    /// <summary>One player's position. Serialized with lowercase JSON names.</summary>
    public sealed class PlayerDto
    {
        [JsonProperty("id")] public int Id;
        [JsonProperty("name")] public string Name;
        [JsonProperty("x")] public float X;
        [JsonProperty("y")] public float Y;
        [JsonProperty("z")] public float Z;
        /// <summary>Degrees clockwise from +z (0..360).</summary>
        [JsonProperty("heading")] public float Heading;
        [JsonProperty("isLocal")] public bool IsLocal;
    }

    /// <summary>
    /// Immutable position sample. Built on the Unity main thread, read from HTTP threads.
    /// The JSON body is serialized exactly once at construction.
    /// </summary>
    public sealed class PositionSnapshot
    {
        public long Seq { get; }
        public string Planet { get; }
        /// <summary>Unix time in milliseconds.</summary>
        public double T { get; }
        /// <summary>Terraformation index; 0 if unknown.</summary>
        public double Ti { get; }
        /// <summary>Start value of the planet's moss terraform stage; 0 if unknown.</summary>
        public double LushThreshold { get; }
        public IReadOnlyList<PlayerDto> Players { get; }
        /// <summary>Pre-serialized <c>{t, planet, ti, players}</c>.</summary>
        public string Json { get; }
        /// <summary>UTF-8 (no BOM) bytes of <see cref="Json"/>.</summary>
        public byte[] JsonUtf8 { get; }

        public PositionSnapshot(long seq, string planet, double t, double ti, double lushThreshold, List<PlayerDto> players)
        {
            Seq = seq;
            Planet = planet;
            T = t;
            Ti = JsonUtil.Finite(ti);
            LushThreshold = JsonUtil.Finite(lushThreshold);
            var copy = players != null ? new List<PlayerDto>(players) : new List<PlayerDto>();
            Players = copy.AsReadOnly();
            Json = JsonUtil.Serialize(new { t = T, planet = Planet, ti = Ti, players = copy });
            JsonUtf8 = JsonUtil.Utf8.GetBytes(Json);
        }

        /// <summary>The local player, or the first player if none is flagged local.</summary>
        public PlayerDto LocalPlayer
        {
            get
            {
                foreach (var p in Players)
                    if (p.IsLocal) return p;
                return Players.Count > 0 ? Players[0] : null;
            }
        }
    }

    /// <summary>A scanned point of interest (resource node, grabbable item, container).</summary>
    public sealed class Poi
    {
        [JsonProperty("id")] public string Id;
        /// <summary>minable | grabable | openable</summary>
        [JsonProperty("kind")] public string Kind;
        [JsonProperty("group")] public string Group;
        [JsonProperty("x")] public float X;
        [JsonProperty("y")] public float Y;
        [JsonProperty("z")] public float Z;
        /// <summary>True when the object is held by / displayed inside a storage or furniture rather than lying in the world.</summary>
        [JsonProperty("inStorage")] public bool InStorage;
        /// <summary>Group id of the holding storage when known, "inventory" when only known to be in an inventory, else null.</summary>
        [JsonProperty("container")] public string Container;
    }

    /// <summary>Immutable result of one POI scan, serialized once.</summary>
    public sealed class PoiSnapshot
    {
        public long ScanId { get; }
        public string Planet { get; }
        public double T { get; }
        public int Count { get; }
        /// <summary>UTF-8 (no BOM) <c>{planet, scanId, t, items:[...]}</c>.</summary>
        public byte[] JsonUtf8 { get; }

        public PoiSnapshot(long scanId, string planet, double t, List<Poi> items)
        {
            ScanId = scanId;
            Planet = planet;
            T = t;
            var list = items ?? new List<Poi>();
            Count = list.Count;
            JsonUtf8 = JsonUtil.Utf8.GetBytes(JsonUtil.Serialize(new { planet, scanId, t, items = list }));
        }
    }

    /// <summary>A command posted by the companion app, executed on the main thread.</summary>
    public sealed class Command
    {
        [JsonProperty("type")] public string Type;
        /// <summary>The whole request body object (including "type").</summary>
        [JsonProperty("payload")] public JObject Payload;
    }

    /// <summary>
    /// JSON helpers. Uses a private serializer so global <see cref="JsonConvert.DefaultSettings"/>
    /// set by other mods cannot change the wire format.
    /// </summary>
    internal static class JsonUtil
    {
        public static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

        private static readonly DateTime UnixEpoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        private static readonly JsonSerializerSettings Settings = new JsonSerializerSettings
        {
            Formatting = Formatting.None,
            NullValueHandling = NullValueHandling.Include,
            ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
            FloatFormatHandling = FloatFormatHandling.DefaultValue,
            DateParseHandling = DateParseHandling.None,
            Culture = System.Globalization.CultureInfo.InvariantCulture,
        };

        public static string Serialize(object value)
        {
            // JsonSerializer.Create (unlike CreateDefault / JsonConvert) does not apply
            // JsonConvert.DefaultSettings. A fresh instance per call keeps this thread-safe.
            var serializer = JsonSerializer.Create(Settings);
            var sb = new StringBuilder(256);
            using (var sw = new StringWriter(sb, System.Globalization.CultureInfo.InvariantCulture))
            using (var jw = new JsonTextWriter(sw) { Formatting = Formatting.None })
            {
                serializer.Serialize(jw, value);
            }
            return sb.ToString();
        }

        public static byte[] SerializeUtf8(object value) => Utf8.GetBytes(Serialize(value));

        /// <summary>Parses a single JSON value without converting date-like strings. Returns null if it is not an object.</summary>
        public static JObject ParseObject(string text)
        {
            using (var sr = new StringReader(text))
            using (var jr = new JsonTextReader(sr) { DateParseHandling = DateParseHandling.None })
            {
                var token = JToken.ReadFrom(jr);
                while (jr.Read())
                {
                    if (jr.TokenType != JsonToken.Comment)
                        throw new JsonReaderException("Additional text after JSON value.");
                }
                return token as JObject;
            }
        }

        public static double Finite(double v) => double.IsNaN(v) || double.IsInfinity(v) ? 0d : v;
        public static float Finite(float v) => float.IsNaN(v) || float.IsInfinity(v) ? 0f : v;

        public static double UnixMsNow() => Math.Floor((DateTime.UtcNow - UnixEpoch).TotalMilliseconds);
    }
}
