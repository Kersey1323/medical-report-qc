import pytest
from pydantic import ValidationError
from contracts.inference import SourceSpan
from app.domain.results import ReportInput, BranchOutcome, RunConfig
from app.domain.state import summarize_report, summarize_run
from app.main import create_app
from fastapi.testclient import TestClient


def test_contracts():
    assert SourceSpan(start=0, end=1, text="𠮷").end == 1
    with pytest.raises(ValidationError):
        BranchOutcome(status="failed", finding="no_issue")
    with pytest.raises(ValidationError):
        RunConfig(checks=[])
    assert RunConfig().checks == ["diagnosis", "csc", "cgec", "rag"]
    r = ReportInput(
        id="00000000-0000-4000-8000-000000000001", description="甲", diagnosis="乙"
    )
    with pytest.raises(ValidationError):
        r.description = "丙"


def test_state():
    failed = BranchOutcome(status="failed")
    issue = BranchOutcome(status="succeeded", finding="issue")
    s = summarize_report([failed, issue], ["diagnosis", "csc"])
    assert (s.completeness, s.anomaly) == ("partial", "issue")
    s = summarize_report(
        [
            BranchOutcome(status="succeeded", finding="no_issue"),
            BranchOutcome(status="pending"),
        ],
        ["diagnosis", "csc"],
    )
    assert s.anomaly == "unknown"
    assert (
        summarize_run(
            {
                "succeeded": 2,
                "failed": 1,
                "pending": 0,
                "running": 0,
                "cancelled": 0,
                "invalid_rows": 0,
            },
            False,
        )
        == "partial"
    )


def test_error_boundaries():
    app = create_app()

    @app.get("/boom")
    def boom():
        raise RuntimeError("password=secret-test authorization=Bearer abc123")

    c = TestClient(app, raise_server_exceptions=False)
    for path, code in [("/missing", "resource_not_found"), ("/boom", "internal_error")]:
        r = c.get(path)
        assert r.status_code == 200
        b = r.json()
        assert b["status"] == "error" and b["detail"]["code"] == code
        assert (
            b["request_id"] and "secret-test" not in r.text and "abc123" not in r.text
        )
