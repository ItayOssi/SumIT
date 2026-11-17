# The friends leaderboard: Firebase setup (once)

`macos/lib/modules/leaderboard.js` keeps the groups in Firestore. Until `Firebase` in `macos/lib/constants.js` has both values,
the "חברים" tab of the study track stays hidden.

1. https://console.firebase.google.com → Add project (Google Analytics is not needed). Use the Spark (free) plan.
2. Build → Firestore Database → Create database, production mode, a region near Israel (e.g. `europe-west1`).
   Rules tab: paste `firestore.rules` from this folder → Publish.
3. Build → Authentication → Get started → Sign-in method → Google → Enable.
   In the Google provider, under "Safelist client IDs from external projects", add the app's OAuth client id
   (`GoogleClientId` in `constants.js`), so Firebase accepts the id_token of the sign-in the app already does for Drive.
4. Project settings → General → Your apps → add a Web app (no hosting). Copy `apiKey` and `projectId` into
   `Firebase: { apiKey, projectId }` in `constants.js`. Both are public by design; the rules are what guard the data.

For a test run without changing the code: `SUMIT_FIREBASE_API_KEY` and `SUMIT_FIREBASE_PROJECT`.
The offline tests use a fake Firebase and never reach the real one.
