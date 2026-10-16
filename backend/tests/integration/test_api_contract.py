from fastapi.testclient import TestClient
from app.main import create_app
from tests.integration.test_schema import factory
from app.db.models import TaskOutbox
from sqlalchemy import select, func
from uuid import uuid4


def test_api_persistence_and_preflight(factory):
    app = create_app()
    app.state.session_factory = factory
    app.state.preflight = lambda: {"ready": False, "branches": {}}
    c = TestClient(app, raise_server_exceptions=False)
    r = c.post(
        "/api/v1/reports",
        json={"description": "明确合成报告：两肺未见异常。", "diagnosis": "合成诊断。"},
    )
    assert r.status_code == 201 and r.json()["status"] == "success"
    rid = r.json()["data"]["id"]
    q = c.post("/api/v1/runs", json={"report_ids": [rid]})
    assert q.status_code == 201 and q.json()["status"] == "success"
    runid = q.json()["data"]["id"]
    blocked = c.post(f"/api/v1/runs/{runid}/start")
    assert (
        blocked.status_code == 200
        and blocked.json()["detail"]["code"] == "preflight_failed"
    )
    with factory() as s:
        assert not any(
            b.eligible
            for b in s.scalars(
                select(TaskOutbox).where(
                    TaskOutbox.target_id.in_(
                        [
                            v["id"]
                            for r in c.get(f"/api/v1/runs/{runid}/reports").json()[
                                "data"
                            ]["items"]
                            for v in r["results"].values()
                        ]
                    )
                )
            )
        )
    app.state.preflight = lambda: {
        "ready": True,
        "branches": {},
        "model_config_fingerprint": "fake-test",
    }
    r = c.post(f"/api/v1/runs/{runid}/start")
    assert r.status_code == 202, r.text
    assert (
        c.post(f"/api/v1/runs/{runid}/start").json()["data"]["revision"]
        == r.json()["data"]["revision"]
    )
    assert (
        c.post("/api/v1/runs", json={"report_ids": [rid], "checks": []}).json()[
            "status"
        ]
        == "error"
    )
    assert (
        c.get("/api/v1/reports/" + str(uuid4())).json()["detail"]["code"]
        == "resource_not_found"
    )
    assert c.get(f"/api/v1/runs/{runid}").json()["data"]["counts"]["units_total"] == 4


def test_concurrent_start_never_replaces_frozen_identity(factory):
    from app.db.models import QualityRun
    from app.services.run_service import start_run
    from app.services.common import digest

    app = create_app()
    app.state.session_factory = factory
    c = TestClient(app, raise_server_exceptions=False)
    rid = c.post(
        "/api/v1/reports",
        json={"description": "合成并发启动报告", "diagnosis": "合成诊断"},
    ).json()["data"]["id"]
    id = c.post("/api/v1/runs", json={"report_ids": [rid], "checks": ["csc"]}).json()[
        "data"
    ]["id"]

    def preflight():
        with factory.begin() as s:
            q = s.get(QualityRun, id)
            snap = dict(q.config_snapshot)
            snap["preflight"] = {
                "ready": True,
                "model_config_fingerprint": "first-worker",
            }
            q.config_snapshot = snap
            q.config_fingerprint = digest(snap)
            start_run(s, id, snap["preflight"])
        return {"ready": True, "model_config_fingerprint": "second-worker"}

    app.state.preflight = preflight
    r = c.post(f"/api/v1/runs/{id}/start").json()
    assert r["status"] == "success"
    assert (
        r["data"]["config_snapshot"]["preflight"]["model_config_fingerprint"]
        == "first-worker"
    )
