# Daily Scripture Handoff

## What Changed

- Built a static scripture tracking web app for a small group.
- Added daily entry flow: reader, scripture passage, verse count, takeaway, and character count.
- Added three app views: Today, Entries by day, and Scoreboard.
- Styled the UI to match the provided Daily Scripture mockup, using `backgrnd.png` as the top hero image and simple mobile-first panels.
- Added bottom navigation icons from `src/assets/icons`.
- Added Firebase Realtime Database sync for shared group data.
- Added silent Firebase Anonymous Auth support. Sync requests now wait for an anonymous Auth ID token and send it to Realtime Database REST requests.
- Sync is deliberate: startup performs one merge with Firebase to protect unsynced device data, `Sync now` performs a manual merge, and moving between entry form fields can also sync without repainting the form mid-edit.
- Added per-device reader memory that is quick to initialize but slow to change: once a device has a saved reader, changing the selected reader only updates the device owner after a real entry save or another committed action.
- Added per-entry emoji reactions. Tapping `+ Like` gives a thumbs-up; holding it opens an emoji input. Tapping existing reaction chips shows who reacted.
- Added a temporary sync notice: `Saving online...` / `Synced` appears during sync, then disappears after 5 seconds.
- Added a one-step undo button in the top action row.
- Replaced the published Bible chapter data with the full local data set and added abbreviation support through the parser.
- Added PWA/head icon references in `index.html` and `manifest.webmanifest`.

## Current Architecture

- Static frontend only. No build framework, no bundler, no backend server.
- Local dev server: `node server.mjs`.
- Syntax check/build command: `npm.cmd run build` on this Windows machine. Plain `npm run build` may be blocked by PowerShell script execution policy.
- Main files:
  - `index.html`: app shell, PWA metadata, icon links, cache-busted CSS/JS imports.
  - `src/app.js`: application state, rendering, form handling, streak/stat calculations, undo, tab navigation.
  - `src/passageParser.js`: scripture reference parsing, suggestions, Bible Gateway URL generation.
  - `src/bibleData.js`: Bible book aliases and chapter verse counts.
  - `src/syncStore.js`: Firebase Realtime Database sync.
  - `src/firebaseAuth.js`: silent Firebase Anonymous Auth via REST.
  - `src/firebaseConfig.js`: Firebase database URL.
  - `src/styles.css`: mobile app styling.
  - `manifest.webmanifest`: PWA manifest.
- Data shape in local storage and Firebase:
  - `groups`: group metadata.
  - `people`: reader records scoped by `groupId`.
  - `entries`: daily reading records scoped by `groupId`; entries may include `reactions` keyed by `personId`.
- Group routing is prepared for `/g/{slug}` URLs, with `main` as the default group.
- The selected reader is stored per device in local storage with `daily-scripture-person-{groupId}`.

## Publishing Notes

- Live repo: `BBuisson188/daily-scripture`, branch `main`.
- Live site: `https://bbuisson188.github.io/daily-scripture/`.
- This local folder is not a Git repo. Avoid spending time on normal `git status`, branch, commit, or push flows here unless the workspace has first been initialized/cloned properly.
- In this environment, `git clone` into `C:\tmp` failed with `.git/config.lock` permission errors, and `git clone`/`gh repo clone` inside this workspace failed with Windows credential/schannel errors. The quickest reliable publish path was GitHub's API through authenticated `gh api`.
- Fast text-file publish path:
  - Run `npm.cmd run build`.
  - Create Git blobs for each changed file with `gh api -X POST repos/BBuisson188/daily-scripture/git/blobs` using base64 file content.
  - Get current head with `gh api repos/BBuisson188/daily-scripture/git/ref/heads/main --jq .object.sha`.
  - Get the head tree with `gh api repos/BBuisson188/daily-scripture/git/commits/{headSha} --jq .tree.sha`.
  - Create a new tree with `base_tree` set to the head tree and entries for only the changed files.
  - Create a commit with the current head SHA as the single parent.
  - Patch `refs/heads/main` with `force: false`.
  - Verify with `node -e "fetch('https://bbuisson188.github.io/daily-scripture/').then(async r=>{const t=await r.text(); console.log(r.status, t.includes('src/app.js?v=...'))})"`.
- The last successful publish used this path and created commit `b60b6d577fc19566b5eac44fa75548bab916fe9e` (`Add manual sync control`).
- Keep cache-busting query strings in `index.html` updated when publishing JS/CSS, or GitHub Pages/mobile Safari may keep serving old code.
- For small text-only changes, the GitHub connector `update_file` path is also fine. For multiple files, the `gh api` Git tree flow is faster and keeps all changes in one commit.
- Binary uploads such as `png-icon/` are still better handled by a real Git checkout or manual GitHub upload until this workspace becomes a proper repo.
- Auth/rules files:
  - `firebase.json`: points Firebase CLI at the rules files.
  - `database.rules.json`: Realtime Database rules for the app's current `/groups/{slug}` REST data.
  - `firestore.rules`: Cloud Firestore rules for a possible `/groups/{groupId}` shape; the current app does not use Firestore.

## Unresolved Issues

- The PNG files in local `png-icon/` are referenced by the app but are not currently present on GitHub, so iPhone home-screen icons are missing.
- Local workspace is not a git repository; publishing has been done through the GitHub connector and `gh api`.
- Binary file publishing through the current GitHub connector path is unreliable, so the `png-icon` folder likely needs to be uploaded manually in GitHub.
- `src/firebaseConfig.js` needs the public Firebase Web API key filled into `firebaseApiKey` before authenticated sync can work.
- Firebase Console must have Anonymous Authentication enabled: Authentication > Sign-in method > Anonymous > Enable.
- The Firebase warning was for Cloud Firestore, but the app currently uses Realtime Database. If Firestore is unused, `firestore.rules` can safely lock everything except an authenticated `/groups/{groupId}` document shape.
- There is no timed background polling. Users can tap `Sync now`, and moving from one form field to another does a cautious merge without repainting the entry form.
- Reaction sync merges `entry.reactions` by `personId` and `reaction.updatedAt` so two people reacting to the same entry are less likely to overwrite each other.
- Undo is one-step only and primarily covers the last saved data change.
- Deletes are not fully built out in the UI yet, though undo was added with accidental changes in mind.
- Firebase rules/security are intentionally permissive for simplicity; no user login exists.
- Parser support is improved but should still be tested against more real-world references and abbreviations.

## Next Recommended Steps

- Upload the entire local `png-icon/` folder to GitHub at `png-icon/`:
  - `apple-touch-icon.png`
  - `icon-192.png`
  - `icon-512.png`
  - `favicon.ico`
  - `favicon-32x32.png`
  - `favicon-16x16.png`
- After icon upload, delete and re-add the iPhone home-screen shortcut because iOS caches missing icons.
- Consider adding conflict UI later if two devices edit the same person's same-day entry at the same time.
- Add entry delete/edit controls in the Entries view.
- Add a safer confirmation or undo pattern around deletes.
- Consider initializing this workspace as a real git repo connected to `BBuisson188/daily-scripture` to simplify publishing.
- Add lightweight parser tests for books that previously failed, including Hosea, Joel, Psalm, abbreviations, and cross-chapter ranges.
- Add a simple group switcher later if multiple groups become real.

## Important Implementation Notes

- Do not render over the entry form while the user is typing.
- Firebase sync waits for `getFirebaseAuthToken()` before any Realtime Database read/write starts. If `firebaseApiKey` is blank, the UI shows `Auth setup needed` and keeps local data.
- `syncStore.start()` calls `loadRemote()` once; do not add timed polling unless the form focus behavior is revisited.
- Normal saves merge remote and local data. Undo saves call `syncStore.save({ merge: false })` so the restored local snapshot replaces Firebase instead of remote data reappearing.
- Device owner is stored in local storage as `daily-scripture-person-{groupId}`. If no owner is saved, selecting/matching a reader can initialize it. If an owner already exists, only committed entry/reaction actions should replace it.
- Entry reactions are stored on the entry as `reactions[personId] = { personId, personName, emoji, updatedAt }`. Avoid updating entry text timestamps for reaction-only changes unless intentionally changing entry content.
- Streak logic keeps yesterday's streak alive until a full day passes without activity.
- Averages ignore zero values.
- Verse counts depend on `src/bibleData.js`; if the published version is incomplete, parsing will fail for missing books.
- Cache-busting query strings on module/CSS imports matter for GitHub Pages and mobile Safari.
- iOS home-screen icons depend mainly on `apple-touch-icon.png`, and the file must actually exist on the published site.
