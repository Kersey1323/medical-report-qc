from concurrent.futures import ThreadPoolExecutor
from app.core.logging_config import configure_logging, logger
from app.core.exceptions import protected_values, register_secrets


def test_concurrent_logs_hide_secrets_and_body_but_keep_exception_chain(tmp_path):
    configure_logging(tmp_path, service="test", instance_id="scope", reset=True)
    register_secrets("test-super-secret")

    def emit(i):
        with (
            logger.contextualize(task_id=f"task-{i}", request_id=f"req-{i}"),
            protected_values("合成正文不应出现在日志"),
        ):
            try:
                try:
                    raise ValueError("test-super-secret 合成正文不应出现在日志")
                except ValueError as cause:
                    raise RuntimeError("outer-failure") from cause
            except Exception as exc:
                logger.opt(exception=exc).error("唯一边界异常")

    with ThreadPoolExecutor(2) as pool:
        list(pool.map(emit, [1, 2]))
    files = list(tmp_path.rglob("*.log"))
    assert len(files) == 1
    content = files[0].read_text()
    assert (
        "test-super-secret" not in content and "合成正文不应出现在日志" not in content
    )
    assert (
        content.count("唯一边界异常") == 2
        and "Caused by:" in content
        and "RuntimeError" in content
        and "ValueError" in content
    )
    assert "task_id=task-1" in content and "task_id=task-2" in content
