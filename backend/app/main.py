from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from backend.app.config import settings
from backend.app.database import engine, Base
from backend.app.api.v1.auth import router as auth_router
from backend.app.api.v1.applications import router as applications_router
from backend.app.api.v1.lands import router as lands_router
from backend.app.api.v1.documents import router as documents_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database tables on startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    # Cleanup database connection pool on shutdown
    await engine.dispose()

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="FastAPI Backend for Hierarchical Blockchain Land Registry with EIP-4361 SIWE Auth and PostgreSQL Read-Model.",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API v1 Routers
app.include_router(auth_router, prefix="/api/v1")
app.include_router(applications_router, prefix="/api/v1")
app.include_router(lands_router, prefix="/api/v1")
app.include_router(documents_router, prefix="/api/v1")

@app.get("/health", tags=["Health"])
async def health_check():
    """Liveness probe returning service and blockchain network configuration."""
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "network": "Ethereum Sepolia",
        "chainId": settings.CHAIN_ID,
    }
