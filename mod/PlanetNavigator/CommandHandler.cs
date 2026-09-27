using System;
using System.Collections.Generic;

namespace PlanetNavigator
{
    /// <summary>Executes queued client commands. Main thread only.</summary>
    internal static class CommandHandler
    {
        private const int MaxUnknownTypesTracked = 64;
        private static readonly HashSet<string> UnknownLogged = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        public static void Handle(Command cmd, StateStore store)
        {
            if (cmd == null) return;
            string type = (cmd.Type ?? string.Empty).Trim();

            switch (type.ToLowerInvariant())
            {
                case "rescan":
                    store.RescanRequested = true;
                    Plugin.LogVerbose("Rescan requested by client");
                    break;

                default:
                    // Bounded so a misbehaving client cannot grow this set without limit.
                    if (UnknownLogged.Count < MaxUnknownTypesTracked && UnknownLogged.Add(type))
                        Plugin.Log?.LogInfo($"Ignoring unknown command type '{type}' (reported once per type)");
                    break;
            }
        }
    }
}
