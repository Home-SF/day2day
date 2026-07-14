// ---------------------------------------------------------------
// Scheduled Cloud Function: creates tomorrow's day document at
// midnight every night, so the page for the next day already
// exists before anyone opens it (rather than being created lazily
// on first visit, which is still kept as a fallback in app.js for
// any day that — for whatever reason — doesn't get pre-created).
//
// Deploy to Field Log's own dedicated Firebase project (see README.md
// in the project root for setup steps and cost/plan notes — this
// requires the Blaze plan since scheduled functions use Cloud
// Scheduler).
// ---------------------------------------------------------------

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

const COLLECTION_PREFIX = "activityLog";
const DAYS_COLLECTION = `${COLLECTION_PREFIX}_days`;
const TIME_ZONE = "America/Los_Angeles"; // change if you're logging from elsewhere

function pad(n) { return String(n).padStart(2, "0"); }

// Formats "tomorrow" as YYYY-MM-DD in TIME_ZONE, not the server's UTC day.
function tomorrowIdInZone() {
  const now = new Date();
  const zoned = new Date(now.toLocaleString("en-US", { timeZone: TIME_ZONE }));
  zoned.setDate(zoned.getDate() + 1);
  return `${zoned.getFullYear()}-${pad(zoned.getMonth() + 1)}-${pad(zoned.getDate())}`;
}

exports.createTomorrowsDayPage = onSchedule(
  {
    schedule: "0 0 * * *",
    timeZone: TIME_ZONE,
  },
  async () => {
    const dayId = tomorrowIdInZone();
    const docRef = db.collection(DAYS_COLLECTION).doc(dayId);
    const snap = await docRef.get();
    if (snap.exists) {
      console.log(`Day page ${dayId} already exists, skipping.`);
      return;
    }
    await docRef.set({ createdAt: new Date().toISOString(), createdBy: "scheduled-function" });
    console.log(`Created day page ${dayId}.`);
  }
);
