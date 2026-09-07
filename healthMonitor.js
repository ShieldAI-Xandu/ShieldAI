// healthMonitor.js
// Lightweight, in-memory operational-health tracking behind the admin
// console's System Health tab — so "is anything actually broken right now"
// has a first stop inside the product itself, instead of always requiring
// Railway's own dashboard/logs.
//
// Deliberately in-memory only, not persisted to db.json: this is a live
// snapshot of the CURRENT process, not a durable audit trail (that's
// adminRoutes.js's audit() log and reportRoutes.js's clientActions — this
// module never touches either). A restart clearing it is expected and fine.

const MAX_ENTRIES = 200;
const recentServerErrors = [];

// Registered once, early in server.js, before any route. Hooks the response
// lifecycle (`res.on("finish")`) rather than Express's error-handling path —
// most 5xx responses in this app are already caught locally per-route and
// turned into `res.status(500).json(...)` without ever calling `next(err)`,
// so a conventional `(err, req, res, next)` error middleware would miss the
// large majority of them. This catches every 5xx regardless of how it was
// produced.
export function serverErrorTracker() {
  return (req, res, next) => {
    res.on("finish", () => {
      if (res.statusCode >= 500) {
        recentServerErrors.push({
          at: new Date().toISOString(),
          status: res.statusCode,
          method: req.method,
          path: req.path,
        });
        if (recentServerErrors.length > MAX_ENTRIES) recentServerErrors.shift();
      }
    });
    next();
  };
}

export function serverErrorSummary() {
  const now = Date.now();
  const lastHour = recentServerErrors.filter(e => now - new Date(e.at).getTime() < 60 * 60 * 1000);
  return {
    trackedSinceProcessStart: true,
    totalTracked: recentServerErrors.length,
    lastHourCount: lastHour.length,
    // Newest first — the ones an admin actually wants to see without scrolling.
    recent: recentServerErrors.slice(-10).reverse(),
  };
}
