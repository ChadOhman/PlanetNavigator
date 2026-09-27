using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;

namespace PlanetNavigator
{
    /// <summary>
    /// Shared state between the Unity main thread (writer) and HTTP threads (readers).
    /// Thread safety comes from immutability: snapshots are built completely and then
    /// published with a single volatile reference write.
    /// </summary>
    public sealed class StateStore
    {
        private volatile PositionSnapshot _position;
        private volatile PoiSnapshot _pois;
        private long _scanCounter;
        private long _lastClientSeenTicks = DateTime.MinValue.Ticks;
        private volatile bool _rescanRequested;

        /// <summary>Latest position snapshot, or null while in the main menu / loading.</summary>
        public PositionSnapshot Position => _position;

        /// <summary>Latest POI scan result, or null before the first scan.</summary>
        public PoiSnapshot Pois => _pois;

        /// <summary>
        /// Id of the latest published scan (0 if none). Derived from the published snapshot so it
        /// can never run ahead of <see cref="Pois"/>.
        /// </summary>
        public long ScanId => _pois?.ScanId ?? 0;

        /// <summary>Commands from HTTP clients, drained on the main thread.</summary>
        public ConcurrentQueue<Command> Commands { get; } = new ConcurrentQueue<Command>();

        /// <summary>UTC time of the last HTTP request (or SSE heartbeat).</summary>
        public DateTime LastClientSeen => new DateTime(Interlocked.Read(ref _lastClientSeenTicks), DateTimeKind.Utc);

        public bool RescanRequested
        {
            get => _rescanRequested;
            set => _rescanRequested = value;
        }

        public void PublishPosition(PositionSnapshot snapshot) => _position = snapshot;

        /// <summary>Main thread. Serializes once, then publishes with a new scan id.</summary>
        public PoiSnapshot PublishPois(List<Poi> items, string planet)
        {
            long id = Interlocked.Increment(ref _scanCounter);
            var snap = new PoiSnapshot(id, planet, JsonUtil.UnixMsNow(), items);
            _pois = snap;
            return snap;
        }

        /// <summary>Records client activity. Any thread.</summary>
        public void Touch() => Interlocked.Exchange(ref _lastClientSeenTicks, DateTime.UtcNow.Ticks);
    }
}
