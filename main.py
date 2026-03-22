"""
P2C - AI-Powered Legacy Code Modernization Tool
Entry point for the FastAPI application.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import modernize
from config import settings

app = FastAPI(
    title="P2C Code Modernizer",
    description="AI-powered tool to analyze, translate, and test legacy PowerBuilder code",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(modernize.router, prefix="/api/v1", tags=["Modernize"])


@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "ok", "version": "1.0.0"}
