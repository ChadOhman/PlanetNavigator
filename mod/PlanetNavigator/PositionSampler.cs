using System;
using System.Collections.Generic;
using SpaceCraft;

namespace PlanetNavigator
{
    /// <summary>Reads player positions from the game. Main thread only.</summary>
    internal static class PositionSampler
    {
        private static bool _tiFailLogged;
        private static bool _lushFailLogged;
        private static bool _playerFailLogged;

        /// <summary>Why the last sample returned null (diagnostics, shown in /api/status). Volatile string.</summary>
        public static volatile string LastNullReason = "not sampled yet";

        /// <summary>Returns null while no planet is loaded (main menu, loading).</summary>
        public static PositionSnapshot Sample(long seq)
        {
            var playersManager = Managers.GetManager<PlayersManager>();
            if (playersManager == null) { LastNullReason = "PlayersManager not found"; return null; }

            var planetLoader = Managers.GetManager<PlanetLoader>();
            if (planetLoader == null) { LastNullReason = "PlanetLoader not found"; return null; }

            PlanetData pd = planetLoader.GetCurrentPlanetData();
            if (pd == null) { LastNullReason = "PlanetLoader has no current planet"; return null; }
            LastNullReason = null;

            string planet = string.IsNullOrEmpty(pd.id) ? "Prime" : pd.id;

            PlayerMainController active = null;
            try { active = playersManager.GetActivePlayerController(); }
            catch (Exception ex) { LogPlayerFailOnce(ex); }

            var players = new List<PlayerDto>();
            List<PlayerMainController> controllers = null;
            try { controllers = playersManager.playersControllers; }
            catch (Exception ex) { LogPlayerFailOnce(ex); }

            if (controllers != null)
            {
                for (int i = 0; i < controllers.Count; i++)
                {
                    var c = controllers[i];
                    if (c == null) continue; // Unity's overloaded == also catches destroyed objects
                    try
                    {
                        players.Add(ToDto(c, i, active != null && c == active));
                    }
                    catch (Exception ex) { LogPlayerFailOnce(ex); }
                }
            }

            if (players.Count == 0 && active != null)
            {
                try { players.Add(ToDto(active, 0, true)); }
                catch (Exception ex) { LogPlayerFailOnce(ex); }
            }

            double ti = 0;
            try
            {
                var wuh = Managers.GetManager<WorldUnitsHandler>();
                if (wuh != null)
                {
                    var unit = wuh.GetUnit(DataConfig.WorldUnitType.Terraformation);
                    if (unit != null) ti = unit.GetValue();
                }
            }
            catch (Exception ex)
            {
                if (!_tiFailLogged)
                {
                    _tiFailLogged = true;
                    Plugin.Log?.LogWarning($"Reading terraformation index failed (reported once): {ex.GetType().Name}: {ex.Message}");
                }
            }

            double lush = 0;
            try
            {
                var stage = pd.startMossTerraStage;
                if (stage != null) lush = stage.GetStageStartValue();
            }
            catch (Exception ex)
            {
                if (!_lushFailLogged)
                {
                    _lushFailLogged = true;
                    Plugin.Log?.LogWarning($"Reading lush threshold failed (reported once): {ex.GetType().Name}: {ex.Message}");
                }
            }

            return new PositionSnapshot(seq, planet, JsonUtil.UnixMsNow(), ti, lush, players);
        }

        private static PlayerDto ToDto(PlayerMainController c, int id, bool isLocal)
        {
            var tr = c.transform;
            var p = tr.position;
            return new PlayerDto
            {
                Id = id,
                Name = c.playerName,
                X = JsonUtil.Finite(p.x),
                Y = JsonUtil.Finite(p.y),
                Z = JsonUtil.Finite(p.z),
                Heading = JsonUtil.Finite(tr.eulerAngles.y),
                IsLocal = isLocal,
            };
        }

        private static void LogPlayerFailOnce(Exception ex)
        {
            if (_playerFailLogged) return;
            _playerFailLogged = true;
            Plugin.Log?.LogWarning($"Reading player controllers failed (reported once): {ex.GetType().Name}: {ex.Message}");
        }
    }
}
