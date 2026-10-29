"""Sakshya backend entrypoint:  python -m uvicorn main:app --reload --port 8000
Cloud demo: set SAKSHYA_AUTOSEED=1 and the synthetic demo dossiers are loaded on every cold start (free hosts have ephemeral disks)."""
import os
from app.api import app  # noqa: F401

for _name in ("lab", "reports"):   # optional routers: the core API keeps running if one fails to import
    try:
        _mod = __import__(f"app.{_name}", fromlist=["router"])
        app.include_router(_mod.router)
    except Exception as e:
        print(f"[sakshya] {_name} router disabled: {e!r}")

@app.on_event("startup")
def _autoseed():
    if os.environ.get("SAKSHYA_AUTOSEED") == "1":
        from app import db, demo
        if not db.one("SELECT id FROM applications LIMIT 1"):
            demo.seed_demo()
            print("[sakshya] synthetic demo dossiers loaded")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
