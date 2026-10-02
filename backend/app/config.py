from pydantic_settings import BaseSettings
from typing import List
import os

class Settings(BaseSettings):
    # Application Info
    APP_NAME: str = "Blockchain Land Registry API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    
    # Network & Chain
    CHAIN_ID: int = 11155111 # Ethereum Sepolia
    SEPOLIA_RPC_URL: str = "https://eth-sepolia.g.alchemy.com/v2/dummy"
    SIWE_DOMAIN: str = "localhost"
    
    # JWT Authentication
    JWT_SECRET_KEY: str = "dev-insecure-secret-key-change-in-production-12345678"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    NONCE_EXPIRE_SECONDS: int = 300 # 5 minutes
    
    # Database
    DATABASE_URL: str = "sqlite+aiosqlite:///./test_land_registry.db"
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "postgres"
    POSTGRES_DB: str = "land_registry"
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    
    # CORS
    BACKEND_CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_origins(self) -> List[str]:
        return [origin.strip() for origin in self.BACKEND_CORS_ORIGINS.split(",") if origin.strip()]

    class Config:
        env_file = "../.env"
        extra = "ignore"

settings = Settings()
