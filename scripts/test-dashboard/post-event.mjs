export async function postDashboardEvent(event) {
  const url = process.env.CFD_TEST_DASHBOARD_EVENTS_URL;
  if (url === undefined) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...event, at: event.at ?? new Date().toISOString() }),
    });
  } catch {
    // Reporting must never change whether the underlying test passes.
  }
}
