using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;
using SpaceCraft;
using UnityEngine;

namespace PlanetNavigator
{
    /// <summary>Scans the loaded scene for resource nodes and containers. Main thread only.</summary>
    internal static class Scanner
    {
        private const int ObjectsPerFrame = 400;
        private const double ClientActiveSeconds = 60;

        // "(Clone)" anywhere, then trailing digits / whitespace / "_" / "-" / "(N)" suffixes.
        private static readonly Regex CloneSuffix = new Regex(@"\(Clone\)", RegexOptions.CultureInvariant);
        private static readonly Regex TrailingNoise = new Regex(@"(\s*\(\d+\)|[\s\d_\-])+$", RegexOptions.CultureInvariant);

        private static string _lastScanPlanet;
        private static float _lastScanTime = float.NegativeInfinity;
        private static bool _objectFailLogged;
        private static bool _findFailLogged;

        /// <summary>
        /// True when a client was seen within the last 60 s and either the interval elapsed,
        /// a rescan was requested, or the planet changed since the last scan.
        /// </summary>
        public static bool ShouldScan(float intervalSeconds, StateStore store, float now)
        {
            if ((DateTime.UtcNow - store.LastClientSeen).TotalSeconds > ClientActiveSeconds) return false;
            if (store.RescanRequested) return true;

            string planet = store.Position?.Planet;
            if (!string.Equals(planet, _lastScanPlanet, StringComparison.Ordinal)) return true;

            return now - _lastScanTime >= intervalSeconds;
        }

        public static IEnumerator ScanCoroutine(StateStore store, string planet)
        {
            // Clear the flag at the start so requests arriving mid-scan trigger another scan.
            store.RescanRequested = false;
            _lastScanPlanet = planet;

            var sw = Stopwatch.StartNew();
            var items = new List<Poi>(1024);
            var seen = new HashSet<string>(StringComparer.Ordinal);
            _storedByWorldObjectId = BuildStoredIndex();
            var state = new ScanState();
            int frames = 1;

            var kinds = new[] { "minable", "grabable", "openable" };
            var found = new int[3];
            var added = new int[3];

            for (int k = 0; k < kinds.Length; k++)
            {
                Actionnable[] objects = Find(k);
                found[k] = objects.Length;

                for (int i = 0; i < objects.Length; i++)
                {
                    if (TryAdd(objects[i], kinds[k], items, seen, state)) added[k]++;

                    state.Processed++;
                    if (state.Processed % ObjectsPerFrame == 0)
                    {
                        frames++;
                        yield return null; // spread the work; objects may be destroyed between frames
                    }
                }
            }

            _lastScanTime = Time.unscaledTime;
            sw.Stop();

            string currentPlanet = store.Position?.Planet;
            if (!string.Equals(currentPlanet, planet, StringComparison.Ordinal))
            {
                // Planet changed while scanning: discard mixed results. ShouldScan will see the
                // new planet and scan again.
                Plugin.LogVerbose($"Scan for {planet} discarded: planet changed to {currentPlanet ?? "(none)"} mid-scan");
                yield break;
            }

            PoiSnapshot snap = null;
            try
            {
                snap = store.PublishPois(items, planet);
            }
            catch (Exception ex)
            {
                Plugin.Log?.LogWarning($"Publishing scan results failed: {ex.GetType().Name}: {ex.Message}");
            }

            if (state.Failures > 0 && !_objectFailLogged)
            {
                _objectFailLogged = true;
                Plugin.Log?.LogWarning($"{state.Failures} object(s) failed during scan (reported once); first: {state.FirstFailure}");
            }

            Plugin.LogVerbose(string.Format(CultureInfo.InvariantCulture,
                "Scan #{0} {1}: minable {2}/{3}, grabable {4}/{5}, openable {6}/{7}, total {8} POIs, {9} failures, {10} ms over {11} frame(s)",
                snap?.ScanId ?? 0, planet,
                added[0], found[0], added[1], found[1], added[2], found[2],
                items.Count, state.Failures, sw.ElapsedMilliseconds, frames));
        }

        private sealed class ScanState
        {
            public int Processed;
            public int Failures;
            public string FirstFailure;
        }

        private static Actionnable[] Find(int kind)
        {
            try
            {
                switch (kind)
                {
                    case 0: return UnityEngine.Object.FindObjectsByType<ActionMinable>(FindObjectsSortMode.None);
                    case 1: return UnityEngine.Object.FindObjectsByType<ActionGrabable>(FindObjectsSortMode.None);
                    default: return UnityEngine.Object.FindObjectsByType<ActionOpenable>(FindObjectsSortMode.None);
                }
            }
            catch (Exception ex)
            {
                if (!_findFailLogged)
                {
                    _findFailLogged = true;
                    Plugin.Log?.LogWarning($"FindObjectsByType failed (reported once): {ex.GetType().Name}: {ex.Message}");
                }
                return Array.Empty<Actionnable>();
            }
        }

        private static bool TryAdd(Actionnable c, string kind, List<Poi> items, HashSet<string> seen, ScanState state)
        {
            try
            {
                if (c == null) return false; // destroyed since FindObjectsByType
                if (!c.isActiveAndEnabled) return false;
                var go = c.gameObject;
                if (go == null || !go.activeInHierarchy) return false;

                string group = GroupOf(c, go);
                Vector3 p = c.transform.position;
                if (float.IsNaN(p.x) || float.IsNaN(p.y) || float.IsNaN(p.z)) return false;

                string id = group + "@"
                    + Mathf.RoundToInt(p.x).ToString(CultureInfo.InvariantCulture) + ":"
                    + Mathf.RoundToInt(p.y).ToString(CultureInfo.InvariantCulture) + ":"
                    + Mathf.RoundToInt(p.z).ToString(CultureInfo.InvariantCulture);

                if (!seen.Add(id)) return false;

                string container = StorageOf(c, go);
                items.Add(new Poi
                {
                    Id = id, Kind = kind, Group = group, X = p.x, Y = p.y, Z = p.z,
                    InStorage = container != null, Container = container,
                });
                return true;
            }
            catch (Exception ex)
            {
                state.Failures++;
                if (state.FirstFailure == null) state.FirstFailure = ex.GetType().Name + ": " + ex.Message;
                return false;
            }
        }

        private const int MaxAncestorDepth = 12;

        /// <summary>WorldObject id → group id of the holder whose inventory contains it. Rebuilt per scan. Main thread only.</summary>
        private static Dictionary<int, string> _storedByWorldObjectId = new Dictionary<int, string>();
        private static bool _indexFailLogged;

        /// <summary>
        /// Items inside any inventory (crates, lockers, shelves, machine input/output slots, vegetube
        /// growing slots) are listed by the game's InventoriesHandler even when they also have a scene
        /// object. Map each contained WorldObject id to the group id of the holder that owns that
        /// inventory (via linked / secondary inventory ids), or "inventory" when no holder is found.
        /// </summary>
        private static Dictionary<int, string> BuildStoredIndex()
        {
            var result = new Dictionary<int, string>();
            try
            {
                var inventories = InventoriesHandler.Instance;
                var worldObjects = WorldObjectsHandler.Instance;
                if (inventories == null) return result;

                var holderByInventoryId = new Dictionary<int, string>();
                if (worldObjects != null)
                {
                    foreach (var kv in worldObjects.GetAllWorldObjects())
                    {
                        var wo = kv.Value;
                        if (wo == null) continue;
                        string gid = wo.GetGroup()?.id;
                        if (string.IsNullOrEmpty(gid)) continue;
                        if (wo.HasLinkedInventory()) holderByInventoryId[wo.GetLinkedInventoryId()] = gid;
                        var secondary = wo.GetSecondaryInventoriesId();
                        if (secondary != null)
                            for (int i = 0; i < secondary.Count; i++) holderByInventoryId[secondary[i]] = gid;
                    }
                }

                foreach (var kv in inventories.GetAllInventories())
                {
                    var inv = kv.Value;
                    if (inv == null) continue;
                    holderByInventoryId.TryGetValue(inv.GetId(), out string holder);
                    var inside = inv.GetInsideWorldObjects();
                    if (inside == null) continue;
                    for (int i = 0; i < inside.Count; i++)
                    {
                        var wo = inside[i];
                        if (wo != null) result[wo.GetId()] = holder ?? "inventory";
                    }
                }
            }
            catch (Exception ex)
            {
                if (!_indexFailLogged)
                {
                    _indexFailLogged = true;
                    Plugin.Log?.LogWarning($"Building the storage index failed (reported once): {ex.GetType().Name}: {ex.Message}");
                }
            }
            return result;
        }

        /// <summary>
        /// Returns the group id of the storage/furniture that holds this object, or null when the object
        /// is loose in the world. Displayed inventory contents (shelves, display cases, vegetubes, crates
        /// with InventoryShowContent) are instantiated as children of the holder, so the holder is found
        /// by walking up the transform hierarchy. A WorldObject whose position is unset is inside an
        /// inventory whose holder has no scene presence; that is reported as "inventory".
        /// </summary>
        private static string StorageOf(Component c, GameObject go)
        {
            var associatedFirst = c.GetComponent<WorldObjectAssociated>();
            if (associatedFirst != null)
            {
                var wo = associatedFirst.GetWorldObject();
                if (wo != null && _storedByWorldObjectId.TryGetValue(wo.GetId(), out string holder)) return holder;
            }

            var t = go.transform.parent;
            for (int depth = 0; t != null && depth < MaxAncestorDepth; depth++, t = t.parent)
            {
                var holder = t.gameObject;
                if (holder.GetComponent<InventoryShowContent>() != null
                    || holder.GetComponent<InventoryAssociated>() != null
                    || holder.GetComponent<InventoryFromScene>() != null
                    || holder.GetComponent<ActionOpenable>() != null)
                {
                    string id = GroupOf(holder.transform, holder);
                    return string.IsNullOrEmpty(id) ? "storage" : id;
                }
            }

            var associated = c.GetComponent<WorldObjectAssociated>();
            if (associated != null)
            {
                var wo = associated.GetWorldObject();
                if (wo != null && !wo.GetIsPlaced()) return "inventory";
            }
            return null;
        }

        private static string GroupOf(Component c, GameObject go)
        {
            var fromScene = c.GetComponent<WorldObjectFromScene>();
            if (fromScene != null)
            {
                var gd = fromScene.GetGroupData();
                if (gd != null && !string.IsNullOrEmpty(gd.id)) return gd.id;
            }

            var associated = c.GetComponent<WorldObjectAssociated>();
            if (associated != null)
            {
                var wo = associated.GetWorldObject();
                if (wo != null)
                {
                    var g = wo.GetGroup();
                    if (g != null && !string.IsNullOrEmpty(g.id)) return g.id;
                }
            }

            return CleanName(go.name);
        }

        internal static string CleanName(string name)
        {
            if (string.IsNullOrEmpty(name)) return "unknown";
            string s = CloneSuffix.Replace(name, string.Empty);
            s = TrailingNoise.Replace(s, string.Empty).Trim();
            return s.Length > 0 ? s : name.Trim();
        }
    }
}
