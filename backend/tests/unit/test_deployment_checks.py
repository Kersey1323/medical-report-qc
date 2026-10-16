from pathlib import Path
import socket
from ops.scripts.check_deployment import check_deployment
from ops.scripts.render_units import render_units


def config():
    root = Path(__file__).resolve().parents[3]
    return {
        "project_root": str(root),
        "business_python": str(root / ".venv/bin/python"),
        "retrieval_python": str(root / "backend/.venv-retrieval/bin/python"),
        "user": "dell",
        "ports": {"api": 5100, "retrieval": 8102, "frontend": 5174},
        "schema": "medical_report_qc",
        "redis_broker_db": 8,
        "redis_limits_db": 9,
        "redis_prefix": "medical_qc:",
    }


def test_occupied_port_is_reported_never_killed():
    c = config()
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        c["ports"] = {"api": listener.getsockname()[1]}
        result = check_deployment(c)
        assert not result["ok"] and result["port_owners"]["api"]["listening"]
        assert listener.fileno() > 0


def test_render_scopes_envs_threads_and_recovery(tmp_path):
    paths = render_units(config(), tmp_path)
    text = "\n".join(p.read_text() for p in paths)
    assert "--pool=threads --concurrency=4 --prefetch-multiplier=1" in text
    assert "TZ=Asia/Shanghai" in text and "OnUnitActiveSec=60s" in text
    assert "--reload" not in text and "User=root" not in text
    assert "medical-qc-gpu" not in text  # existing independent 5555 service
    assert "backend/.venv-retrieval/bin/python" in text
