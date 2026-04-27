# Sistem Markah UBBM

## 🚀 How to Deploy to GitHub Pages (The Right Way)

The reason your workflow isn't running is likely because **you deleted it** from GitHub when you used `git push --force`. 

### Step 1: Get the Workflow File Properly
1. Go to your repository at `https://github.com/wanbee68/sistem-ubbm`.
2. check if `.github/workflows/deploy.yml` exists. If not, **create it again** via the web interface (Add file > Create new file).
3. Copy the workflow code from **AI Studio's README** into that file.

### Step 2: Sync your VS Code with GitHub
If you have code in VS Code that you want to push, but don't want to delete the workflow file on GitHub:
```bash
# 1. First, "pull" the workflow file from GitHub to your VS Code
git pull origin main --rebase

# 2. Now you have the .github folder locally! 
# 3. Try to push normally
git push origin main
```

### 🛑 If you get a "Workflow Scope" error when pushing:
If VS Code says: `refusing to allow an OAuth App to create or update workflow...`:
1. **DO NOT DELETE** the `.github` folder.
2. Instead, rename your local folder `.github` to something else (like `_temp_github`) temporarily.
3. Push your code: `git add .`, `git commit`, `git push`.
4. The workflow file **already on GitHub** will remain safe and will trigger the build!

### Step 3: Check if it's working
1. On GitHub, click the **Actions** tab.
2. You should see a yellow dot or green checkmark next to "Deploy to GitHub Pages".
3. If it's red (failed), click it to see why.
4. **Settings > Pages**: Make sure "Source" is set to **GitHub Actions**.

### Step 4: Firebase Authorized Domains
1. Go to [Firebase Console](https://console.firebase.google.com/).
2. **Authentication > Settings > Authorized domains**.
3. Add `wanbee68.github.io`.

---

## 🛠 Troubleshooting Common Errors

### "Updates were rejected... fetch first"
This means GitHub has files (like the workflow) that you don't have. 
*   **Fix:** Run `git pull origin main --rebase`.

### "The site's title doesn't change"
1. Make sure you edited `<title>` in `index.html`.
2. Check the **Actions** tab on GitHub. If the workflow didn't run, the site won't update.
3. Clear your browser cache or open the site in **Incognito/Private mode**.

## Workflow Code (Save as .github/workflows/deploy.yml)
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