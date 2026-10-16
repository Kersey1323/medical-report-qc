"""Only expired log/ZIP files in closed PID directories. Dry-run by default."""

from pathlib import Path
from datetime import datetime, timedelta
import argparse, json, os, re


def prune_logs(log_root, older_than_days=30, dry_run=True):
    if older_than_days < 1:
        raise ValueError("older_than_days must be positive")
    root = Path(log_root)
    if root.is_symlink():
        raise ValueError("log_root must not be a symlink")
    root = root.resolve()
    result = {"deleted": 0, "would_delete": 0, "skipped": 0, "errors": []}
    cutoff = (datetime.now() - timedelta(days=older_than_days)).timestamp()
    if not root.exists():
        return result
    for directory, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = [d for d in dirs if not (Path(directory) / d).is_symlink()]
        for name in files:
            p = Path(directory) / name
            try:
                if (
                    p.is_symlink()
                    or not p.is_file()
                    or not (
                        name.endswith(".log")
                        or name.endswith(".log.zip")
                        or name.endswith(".zip")
                    )
                ):
                    result["skipped"] += 1
                    continue
                pidpart = next(
                    (
                        x
                        for x in p.relative_to(root).parts
                        if re.fullmatch(r"pid-\d+", x)
                    ),
                    None,
                )
                if (
                    not pidpart
                    or Path("/proc", pidpart[4:]).exists()
                    or p.stat().st_mtime >= cutoff
                ):
                    result["skipped"] += 1
                    continue
                result["would_delete"] += 1
                if not dry_run:
                    p.unlink()
                    result["deleted"] += 1
            except OSError as exc:
                result["errors"].append(
                    {"file": str(p.relative_to(root)), "error_type": type(exc).__name__}
                )
    return result


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--log-root", required=True)
    p.add_argument("--older-than-days", type=int, default=30)
    p.add_argument("--apply", action="store_true")
    a = p.parse_args()
    print(
        json.dumps(
            prune_logs(a.log_root, a.older_than_days, not a.apply), ensure_ascii=False
        )
    )
