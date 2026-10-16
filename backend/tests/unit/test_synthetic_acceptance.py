from ops.scripts.run_synthetic_acceptance import run_acceptance


def test_real_smoke_is_explicitly_gated(monkeypatch, tmp_path):
    monkeypatch.delenv("MEDICAL_QC_REAL_SMOKE", raising=False)
    result = run_acceptance("http://127.0.0.1:1", tmp_path)
    assert result["status"] == "blocked" and result["submitted"] == 0
