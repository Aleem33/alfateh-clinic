# Al-Fateh Healthcare Suite

Electron desktop app — Firebase Auth + Firestore backend.

## Setup (First Time)

### 1. Firebase Console Setup
1. Go to console.firebase.google.com → al-fateh-clinic project
2. **Authentication** → Sign-in method → Enable **Email/Password**
3. **Firestore Database** → Create database → Start in **production mode** → Enable
4. **Firestore** → Rules tab → paste contents of `firestore.rules` → Publish
5. **Firebase config (local only — never commit):**
   ```bash
   copy firebase-applet-config.example.json firebase-applet-config.json
   ```
   Edit `firebase-applet-config.json` with values from Firebase → Project settings → Your apps → Web app config.

### Security: API key exposed on GitHub?
If GitHub emailed you about a leaked Google API key:
1. **Rotate the key** — [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) → find the key → **Regenerate** or create a new one and delete the old key.
2. Update your local `firebase-applet-config.json` with the new key.
3. **Restrict the key** — same page → Application restrictions (HTTP referrers for web) and API restrictions (Firebase APIs only).
4. This repo no longer tracks `firebase-applet-config.json`; add the same values as **GitHub repository secrets** for release builds: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`, and optionally `FIREBASE_MEASUREMENT_ID`.

### 2. Create Admin User
Firebase Console → Authentication → Users → Add user:
- Email: `admin@alfateh-clinic.internal`
- Password: (your choice, min 6 chars)

Login to the app with:
- Username: `admin`
- Password: (what you set)

### 3. Build the Electron App
```
Double-click BUILD.bat
```
Installer appears in `release\` folder.

## Development (Testing without building)
```bash
npm install --legacy-peer-deps
npm run dev
```
Open: http://localhost:3000

## User Management
Create users from inside the app:
- **HMS**: Staff page → Add Staff → set Username + Password
- **POS**: Users page → Add User → set Username + Password

Usernames are converted internally: `dr.ahmed` → `dr.ahmed@alfateh-clinic.internal`

## Auto-Updates (GitHub Releases)

The installed Windows app (NSIS installer) checks GitHub Releases on startup and can install updates automatically.

### One-time setup

1. Create a GitHub repository and push this project.
2. In `package.json`, replace `YOUR_GITHUB_USERNAME` in both `repository.url` and `build.publish.owner`.
3. Bump `version` in `package.json` for each release (e.g. `3.0.1`, `3.1.0`).

### Publish a new version

**Option A — GitHub Actions (recommended)**

```bash
git tag v3.0.1
git push origin v3.0.1
```

The workflow in `.github/workflows/release.yml` builds the app and uploads installers to GitHub Releases.

**Option B — Manual publish from your PC**

```bash
set GH_TOKEN=your_github_personal_access_token
npm run release
```

Use a token with `repo` scope. Create one at GitHub → Settings → Developer settings → Personal access tokens.

### Notes

- Auto-update works for the **NSIS installer** (`Al-Fateh Clinic Setup.exe`). The portable `.exe` does not auto-update.
- Installed clients must have been built with the correct `build.publish` GitHub owner/repo.
- Users can also check manually from the app selector screen or **HMS → Settings → App Updates**.
