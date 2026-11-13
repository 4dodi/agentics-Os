/** Runs once when the server starts: begins the background scheduler (automations, OMI import). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler");
    await import("./lib/omi-job");
    startScheduler();
  }
}
