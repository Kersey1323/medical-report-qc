from pathlib import Path
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ROOT / ".env"), extra="ignore")
    database_url: str = "mysql+pymysql://medical_qc:CHANGE_ME@127.0.0.1:3306/medical_report_qc?charset=utf8mb4"
    redis_broker_url: str = "redis://127.0.0.1:6379/8"
    redis_url: str = "redis://127.0.0.1:6379/9"
    redis_prefix: str = "medical_qc:"
    model_service_url: str = "http://127.0.0.1:5555"
    model_auth_enabled: bool = False
    model_service_token: str = ""
    retrieval_service_url: str = "http://127.0.0.1:8102"
    var_dir: Path = ROOT.parent / "var"
    app_log_dir: Path = ROOT.parent / "var/logs"
    instance_id: str = "local"
    online_config_file: Path = ROOT / "configs/profiles.yaml"
    retrieval_config_file: Path = ROOT / "configs/retrieval.yaml"
    lease_seconds: int = 120
    heartbeat_seconds: int = 15
    model_timeout_seconds: int = 850
    online_api_key: str = ""
    judge_api_key: str = ""
    teacher_api_key: str = ""
    localizer_api_key: str = ""
    allow_unknown_embedding_provenance: bool = False


@lru_cache
def get_settings():
    return Settings()
