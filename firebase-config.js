// ---------------------------------------------------------------
// Firebase config — this site now uses its OWN dedicated Firebase
// project, kept fully separate from the Paris/London and Tokyo/KL/
// Singapore trip sites (personal data vs. family-shared data).
//
// Create a new project at console.firebase.google.com, then paste
// its config here (Project Settings → General → "Your apps" → SDK
// setup and configuration → Config).
// ---------------------------------------------------------------

export const firebaseConfig = {
  apiKey: "AIzaSyBDGgRcnjQfbGwLK6muANAAVuGlesMmPQg",
  authDomain: "field-log-2f9ac.firebaseapp.com",
  projectId: "field-log-2f9ac",
  storageBucket: "field-log-2f9ac.firebasestorage.app",
  messagingSenderId: "1025126631069",
  appId: "1:1025126631069:web:dadb0dff796bc545b57674"
};

// No longer need collection/storage prefixes to avoid colliding with
// the trip sites' data — this project is dedicated to Field Log alone.
// Kept as named constants so the rest of the code stays readable.
export const COLLECTION_PREFIX = "activityLog";
export const STORAGE_PREFIX = "activityLogPhotos";
