// threatIntelSources.js
// The single registry of every threat-intel data source, live or planned —
// what cveRoutes.js's admin status/probe routes loop over, and the seam a
// future source plugs into.
//
// Each entry's `statusFn` takes `(db)` uniformly, even though only HIBP
// actually reads it (client domain enrollment counts) — a uniform signature
// means the route can call `.map(s => s.statusFn(db))` generically instead
// of special-casing which sources need which arguments.
//
// Adding a fully-implemented source later (EPSS/OSV/ATT&CK today, anything
// else tomorrow): swap that source's stub statusFn/probeFn import for the
// real one once its own service file is built out — this array, and every
// route/UI that reads it, needs no other change.

import { cveServiceStatus, probeCve } from "./cveService.js";
import { darkwebServiceStatus, probeDarkweb } from "./darkwebService.js";
import { kevServiceStatus, probeKev } from "./kevService.js";
import { epssServiceStatus, probeEpss } from "./epssService.js";
import { osvServiceStatus, probeOsv } from "./osvService.js";
import { attackServiceStatus, probeAttack } from "./attackService.js";
import { attackSurfaceServiceStatus, probeAttackSurface } from "./attackSurfaceService.js";

export const THREAT_INTEL_SOURCES = [
  { id: "nvd",           statusFn: () => cveServiceStatus(),           probeFn: probeCve },
  { id: "hibp",          statusFn: (db) => darkwebServiceStatus(db),   probeFn: probeDarkweb },
  { id: "kev",           statusFn: () => kevServiceStatus(),           probeFn: probeKev },
  { id: "epss",          statusFn: () => epssServiceStatus(),          probeFn: probeEpss },
  { id: "osv",           statusFn: () => osvServiceStatus(),           probeFn: probeOsv },
  { id: "attack",        statusFn: () => attackServiceStatus(),        probeFn: probeAttack },
  { id: "attackSurface", statusFn: () => attackSurfaceServiceStatus(), probeFn: probeAttackSurface },
];
