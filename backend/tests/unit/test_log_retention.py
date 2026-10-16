from pathlib import Path
from datetime import datetime, timedelta
import os
from ops.scripts.prune_logs import prune_logs


def test_prune_is_dry_run_and_never_follows_symlinks_or_active_pid(tmp_path):
    root = tmp_path / "logs"
    closed = root / "api" / "local" / "pid-999999999" / "app"
    closed.mkdir(parents=True)
    old = closed / "old.log.zip"
    old.write_text("old")
    active = root / "worker" / "local" / f"pid-{os.getpid()}" / "app"
    active.mkdir(parents=True)
    live = active / "app.log"
    live.write_text("live")
    outside = tmp_path / "evidence.log"
    outside.write_text("evidence")
    link = closed / "escape.log"
    link.symlink_to(outside)
    oldtime = (datetime.now() - timedelta(days=40)).timestamp()
    for p in [old, live, outside]:
        os.utime(p, (oldtime, oldtime))
    result = prune_logs(root)
    assert old.exists() and result["would_delete"] == 1
    result = prune_logs(root, dry_run=False)
    assert not old.exists() and live.exists() and outside.exists() and link.is_symlink()
