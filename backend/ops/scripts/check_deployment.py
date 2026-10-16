"""Read-only deployment checks: no kill, install, migration or Redis mutation."""

from pathlib import Path
import argparse, json, socket, subprocess
import yaml


def check_deployment(config):
    errors = []
    warnings = []
    ports = {}
    root = Path(config["project_root"]).resolve()
    for role, port in config.get("ports", {}).items():
        with socket.socket() as sock:
            sock.settimeout(0.2)
            listening = sock.connect_ex(("127.0.0.1", int(port))) == 0
        ports[role] = {"port": port, "listening": listening}
        if listening:
            errors.append(f"{role} 端口 {port} 已有监听；仅报告，不停止现有服务")
    envs = {}
    for name in ["business_python", "retrieval_python"]:
        path = Path(config[name])
        envs[name] = {"path": str(path), "exists": path.is_file()}
        if not path.is_file():
            errors.append(name + " 解释器不存在")
    if config.get("user") == "root":
        errors.append("业务服务禁止以 root 运行")
    if config.get("schema") != "medical_report_qc":
        errors.append("需使用独立 medical_report_qc schema")
    if (
        config.get("redis_broker_db") != 8
        or config.get("redis_limits_db") != 9
        or config.get("redis_prefix") != "medical_qc:"
    ):
        errors.append("Redis隔离配置不符合约定")
    for file in (root / "frontend").glob(".env*"):
        if file.is_file() and any(
            line.startswith("VITE_")
            and any(
                k in line.upper() for k in ["SECRET", "TOKEN", "API_KEY", "PASSWORD"]
            )
            for line in file.read_text().splitlines()
        ):
            errors.append("前端环境中存在密钥变量")
    warnings.append(
        "检查未启动服务；已运行的自有服务也会显示端口占用。资产与在线角色需另查 /api/v1/system/status。Redis只允许独立DB及前缀，不执行FLUSH。"
    )
    return {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "port_owners": ports,
        "envs": envs,
    }


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--config", default="configs/deployment.local.yaml")
    a = p.parse_args()
    report = check_deployment(yaml.safe_load(Path(a.config).read_text()))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report["ok"] else 2)
