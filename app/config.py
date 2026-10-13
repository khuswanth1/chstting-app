from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    app_env: str = "development"
    database_url: str = "postgresql+psycopg://chatflow:chatflow@localhost:5432/chatflow"
    secret_key: str = "dev-only-change-me-dev-only-change-me"
    access_token_expire_minutes: int = 60 * 24
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    upload_dir: str = "uploads"
    max_upload_mb: int = 25
    status_ttl_hours: int = 24
    backup_max_media_mb: int = 500   # media included in one data backup

    # WebRTC ICE servers. STUN is free; TURN is optional and needs your own server (e.g. coturn).
    stun_urls: str = "stun:stun.l.google.com:19302"
    # Option A (recommended): coturn with `use-auth-secret`; the API mints short-lived credentials per user.
    turn_urls: str = ""          # e.g. turn:localhost:3478?transport=udp,turn:localhost:3478?transport=tcp
    turn_secret: str = ""        # must equal coturn's static-auth-secret
    turn_ttl_seconds: int = 3600
    # Option B: one static TURN account (e.g. a hosted provider)
    turn_url: str = ""
    turn_username: str = ""
    turn_credential: str = ""

    # ChatFlow AI: any OpenAI-compatible endpoint. Default = local Ollama (free): https://ollama.com
    ai_enabled: bool = True
    ai_base_url: str = "http://localhost:11434/v1"
    ai_model: str = "llama3.2"
    ai_api_key: str = ""            # not needed for Ollama
    ai_reasoning_effort: str = ""   # "low" | "medium" | "high" for reasoning models (e.g. gpt-oss); empty = provider default
    ai_timeout_seconds: int = 90
    ai_rate_limit_per_min: int = 20

    allow_private_webhooks: bool = False  # set true only for local webhook testing

    @property
    def turn_mode(self) -> str | None:
        if self.turn_secret and self.turn_urls:
            return "ephemeral"
        return "static" if self.turn_url else None

    def webrtc_warnings(self) -> list[str]:
        w = []
        if bool(self.turn_secret) != bool(self.turn_urls):
            w.append("TURN_SECRET and TURN_URLS must both be set for time-limited TURN credentials; TURN is disabled")
        if self.turn_url and not (self.turn_username and self.turn_credential):
            w.append("TURN_URL is set without TURN_USERNAME / TURN_CREDENTIAL")
        if not self.stun_urls.strip() and not self.turn_mode:
            w.append("No STUN or TURN servers configured: calls will only work on the same network")
        for u in [*self.stun_urls.split(","), *self.turn_urls.split(","), self.turn_url]:
            if u.strip() and not u.strip().startswith(("stun:", "stuns:", "turn:", "turns:")):
                w.append(f"Invalid ICE URL (must start with stun:/turn:): {u.strip()}")
        return w

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.app_env == "production" and s.secret_key.startswith("dev-only"):
        raise RuntimeError("SECRET_KEY must be set in production")
    return s
