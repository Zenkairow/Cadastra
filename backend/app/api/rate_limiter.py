import time
from typing import Dict, List
from fastapi import Request, HTTPException, status

class InMemoryRateLimiter:
    """
    Sliding-window in-memory rate limiter for OWASP API Security Top 10
    (Unrestricted Resource Consumption & Brute-Force Defense).
    Tracks request timestamps per client IP.
    """
    def __init__(self, requests_limit: int = 60, window_seconds: int = 60):
        self.requests_limit = requests_limit
        self.window_seconds = window_seconds
        self._history: Dict[str, List[float]] = {}

    def is_rate_limited(self, client_ip: str) -> bool:
        now = time.time()
        window_start = now - self.window_seconds

        # Get existing timestamps and clean up expired ones
        timestamps = self._history.get(client_ip, [])
        valid_timestamps = [t for t in timestamps if t > window_start]

        if len(valid_timestamps) >= self.requests_limit:
            self._history[client_ip] = valid_timestamps
            return True

        valid_timestamps.append(now)
        self._history[client_ip] = valid_timestamps
        return False

    def clear(self):
        """Clears stored history (useful for test isolation)."""
        self._history.clear()

    async def __call__(self, request: Request):
        client_ip = request.client.host if request.client else "127.0.0.1"

        # Check rate limit
        if self.is_rate_limited(client_ip):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded: maximum {self.requests_limit} requests per {self.window_seconds} seconds.",
                headers={"Retry-After": str(self.window_seconds)}
            )

# Default limiters for dependency injection
default_rate_limiter = InMemoryRateLimiter(requests_limit=100, window_seconds=60)
auth_rate_limiter = InMemoryRateLimiter(requests_limit=15, window_seconds=60)
upload_rate_limiter = InMemoryRateLimiter(requests_limit=20, window_seconds=60)
