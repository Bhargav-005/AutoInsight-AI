"""Start the local development API using validated settings."""

import uvicorn

from app.core.config import Settings

if __name__ == "__main__":
    settings = Settings()
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host=settings.api_host,
        port=settings.api_port,
        access_log=False,
    )
