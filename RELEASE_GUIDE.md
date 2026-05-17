# Al-Fateh Clinic — Release & Auto-Update Guide

Auto-updates are powered by **electron-builder** + **electron-updater** + **GitHub Releases**.
When a user opens the installed app, it silently checks GitHub for a newer `latest.yml`,
downloads the new installer in the background, and prompts the user to restart.

---

## One-time GitHub setup

### 1 — Repository must be public  
Go to **GitHub → Settings → Danger Zone → Change visibility → Public**.  
Private repos need a `GH_TOKEN` set inside the packaged app — avoid this complexity.

### 2 — Add Firebase secrets  
Go to **GitHub → Settings → Secrets and variables → Actions → New repository secret**
and add ONE of:

**Option A (easiest) — single secret:**
```
Name:  FIREBASE_CONFIG_JSON
Value: (paste the entire contents of your firebase-applet-config.json on one line)
```

**Option B — separate secrets:**
```
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
FIREBASE_MEASUREMENT_ID   (optional)
```

### 3 — Verify `publish` config in package.json  
```json
"publish": {
  "provider": "github",
  "owner": "Aleem33",       ← must match your GitHub username
  "repo":  "alfateh-clinic" ← must match your repository name
}
```

---

## How to publish a release

### Step 1 — Bump the version
```bash
npm run bump:patch   # 3.0.1 → 3.0.2  (bug fixes)
npm run bump:minor   # 3.0.1 → 3.1.0  (new features)
npm run bump:major   # 3.0.1 → 4.0.0  (breaking changes)
```

### Step 2 — Commit and tag
```bash
git add package.json
git commit -m "chore: bump version to 3.0.2"
git tag v3.0.2
git push origin main --tags
```

### Step 3 — GitHub Actions builds it automatically  
Pushing a `v*` tag triggers `.github/workflows/release.yml` which:
1. Installs dependencies
2. Injects Firebase config from secrets
3. Builds the Vite app
4. Packages with electron-builder (NSIS installer + portable EXE)
5. Uploads everything to a new GitHub Release

Watch progress at **GitHub → Actions → Release**.

### Step 4 — Users get the update  
Existing installs silently download the new version on next launch and
show a "Restart to Update" prompt. No action needed from you.

---

## Manual / local build

```bash
# Build installer locally (doesn't publish)
npm run dist

# Build AND publish to GitHub (needs GH_TOKEN env var)
$env:GH_TOKEN="ghp_your_token_here"
npm run release
```

---

## Update log (debugging)

The updater writes a log to:
```
Windows: C:\Users\<user>\AppData\Roaming\Al-Fateh Clinic\updater.log
```

Check this file if updates aren't working.

---

## What gets uploaded to each GitHub Release

| File | Purpose |
|------|---------|
| `Al-Fateh Clinic Setup *.exe` | NSIS installer (recommended for most users) |
| `Al-Fateh Clinic *.exe` | Portable — no install needed |
| `latest.yml` | **Required for auto-update** — tells electron-updater what version is current |
| `*.blockmap` | Used for delta updates (smaller downloads) |

---

## Troubleshooting

**"Updates are only available in the installed app"** — you're running `npm run electron:dev`, not the packaged app. This is correct behaviour.

**Update check silently does nothing** — check `updater.log`. Usually the GitHub release is missing `latest.yml` or the repo is private.

**GitHub Actions fails at Firebase step** — `FIREBASE_CONFIG_JSON` secret is not set. See Step 2 above.

**GitHub Actions fails at electron-builder step** — check that `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` is set in the workflow env (it is by default in this repo).

**NSIS installer shows SmartScreen warning** — the app is unsigned. This is cosmetic; users can click "More info → Run anyway". Code-signing removes this but requires a paid certificate (~$300/yr).
