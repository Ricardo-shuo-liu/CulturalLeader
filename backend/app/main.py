from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import FRONTEND_DIR
from .db import init_db
from .routers import admin, chat, cities, flows, geo, guides, route, system, trips


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="CulturalLeader 文旅数字人平台", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system.router)
app.include_router(cities.router)
app.include_router(chat.router)
app.include_router(route.router)
app.include_router(trips.router)
app.include_router(flows.router)
app.include_router(guides.router)
app.include_router(geo.router)
app.include_router(admin.router)

for name in ("js", "css", "assets", "vendor", "js/data"):
    directory = FRONTEND_DIR / name
    if directory.exists():
        app.mount(f"/{name}", StaticFiles(directory=str(directory)), name=f"static-{name.replace('/', '-')}")


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/admin", include_in_schema=False)
def admin_page() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "admin.html")


@app.get("/share/{token}", include_in_schema=False)
def share_page(token: str) -> FileResponse:
    """只读分享页：内容由 /api/guides/shared/{token} 提供，页面本身不含隐私数据。"""
    return FileResponse(FRONTEND_DIR / "share.html")
