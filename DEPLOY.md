# Deploy Sakshya for free (frontend on Vercel, backend on Render)
1. Push the project to GitHub (repo root = the `sakshya` folder that contains `package.json`, `backend/` and `render.yaml`).
2. Render: New > Blueprint > pick the repo > Apply. Wait for the build, copy the URL, open `<url>/api/v1/system/status`.
3. Vercel: Add New Project > import the repo > env var NEXT_PUBLIC_API_URL = the Render URL (no trailing slash) > Deploy.
4. Before the evaluator opens it, visit the Render URL once (free instances sleep after 15 minutes and take about a minute to wake).
Free tiers: Render free = 512 MB RAM, sleeps when idle, ephemeral disk (uploads reset on restart; demo dossiers reload automatically via SAKSHYA_AUTOSEED=1).
There is no real login: anyone can switch role. Upload only synthetic documents.
