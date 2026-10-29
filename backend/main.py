"""Sakshya backend entrypoint:  python -m uvicorn main:app --reload --port 8000"""
from app.api import app  # noqa: F401

for _name in ("lab", "reports"):   # optional routers: the core API keeps running if one fails to import
    try:
        _mod = __import__(f"app.{_name}", fromlist=["router"])
        app.include_router(_mod.router)
    except Exception as e:
        print(f"[sakshya] {_name} router disabled: {e!r}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
