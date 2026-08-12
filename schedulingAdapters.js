// schedulingAdapters.js
// Creates exactly one meeting per call — Zoom or Google Meet — on a
// PERSONAL user's own connection (see schedulingRoutes.js's header for why
// this is deliberately separate from the org-admin directoryConnections
// used for posture). This is the first WRITE capability across every
// integration in this codebase (webhooks receive only, directories read
// only) — a deliberate, bounded exception: a human explicitly requests one
// meeting, this creates exactly that one meeting, nothing else. No polling,
// no calendar reads, no meeting management beyond the single create call.

export const ZOOM_SCHEDULING_SCOPES = ["meeting:write"];
export const GOOGLE_MEET_SCHEDULING_SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

export async function createZoomMeeting(accessToken, { topic, startTime, durationMinutes }) {
  const res = await fetch("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: String(topic || "ShieldAI call").slice(0, 200),
      type: 2, // scheduled meeting
      start_time: startTime, // ISO 8601, UTC
      duration: durationMinutes || 30,
      settings: { waiting_room: true, join_before_host: false },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Zoom create meeting failed: ${res.status} ${JSON.stringify(data)}`);
  return { joinUrl: data.join_url, startTime: data.start_time, externalId: String(data.id) };
}

export async function createGoogleMeetEvent(accessToken, { topic, startTime, durationMinutes }) {
  const start = new Date(startTime);
  const end = new Date(start.getTime() + (durationMinutes || 30) * 60000);
  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: String(topic || "ShieldAI call").slice(0, 200),
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      conferenceData: { createRequest: { requestId: `shieldai-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google Calendar create event failed: ${res.status} ${JSON.stringify(data)}`);
  const videoEntry = (data.conferenceData?.entryPoints || []).find(e => e.entryPointType === "video");
  return { joinUrl: data.hangoutLink || videoEntry?.uri || null, startTime: data.start?.dateTime, externalId: data.id };
}

export const SCHEDULING_PROVIDERS = {
  zoom: { scopes: ZOOM_SCHEDULING_SCOPES, create: createZoomMeeting },
  google_meet: { scopes: GOOGLE_MEET_SCHEDULING_SCOPES, create: createGoogleMeetEvent },
};
