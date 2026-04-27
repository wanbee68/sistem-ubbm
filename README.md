# Sistem UBBM

## 🚀 How to Deploy to GitHub Pages (Foolproof Guide)

If you are seeing errors like "Personal Access Token" or "main cannot be resolved", follow these steps exactly.

### Step 1: Prepare your Local Folder
1. Download this project as a ZIP from AI Studio (**Settings > Export > ZIP**) and extract it.
2. Open your terminal (Command Prompt or PowerShell) inside that extracted folder.
3. **IMPORTANT:** Delete the `.github` folder if it exists in your local folder for now. We will add the workflow later via the GitHub website to avoid the "Personal Access Token" error.

### Step 2: Push Your Code to GitHub
Run these commands one by one:
```bash
# 1. Initialize Git
git init

# 2. Add files
git add .

# 3. Commit files (This fixes "main cannot be resolved")
git commit -m "Initialize project"

# 4. Rename branch to main
git branch -M main

# 5. Connect to your GitHub repo
# Replace 'wanbee68' if your username is different
git remote add origin https://github.com/wanbee68/sistem-ubbm

# 6. Push code (Force push to ensure a clean start)
git push -u origin main --force
```

### Step 3: Add the Deployment Workflow (Via GitHub Website)
This avoids the Permission/Scope error you saw earlier.
1. Go to your repository at `https://github.com/wanbee68/sistem-ubbm`.
2. Click **Add file** > **Create new file**.
3. Path: `.github/workflows/deploy.yml`
4. Copy and paste code below into the file:

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm install
      - run: npm run build
      - uses: actions/configure-pages@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: './dist'
      - uses: actions/deploy-pages@v4
```
5. Click **Commit changes**.

### Step 4: Final Settings
1. On your GitHub repo: **Settings > Pages**.
2. **Build and deployment > Source**: Change to **GitHub Actions**.
3. **Firebase Setup:** Go to [Firebase Console](https://console.firebase.google.com/) > Authentication > Settings > Authorized domains. Add `wanbee68.github.io`.

---

## 🛠 Troubleshooting Common Errors

### "Personal Access Token ... without workflow scope"
This happens because your local Git login doesn't have permission to upload "Workflow" files.
*   **Fix:** Follow **Step 1** and **Step 3** above (push without the `.github` folder, then add it via the web).

### "fatal: main cannot be resolved to branch"
This means you haven't "committed" your changes yet.
*   **Fix:** Run `git commit -m "Initial commit"` before you try to push.

### "Insufficent permissions to create the GitHub repository" (In AI Studio)
The AI Studio "Export to GitHub" feature needs extra permissions.
*   **Fix:** Manual upload (Steps 1-4 above) is the most reliable way.