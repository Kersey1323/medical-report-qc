from app.core.config import Settings
from app.services.system_service import config_snapshot


def test_localizer_uses_user_selected_sol_and_snapshot_records_revision():
    snapshot = config_snapshot(Settings(), ["diagnosis", "csc", "cgec", "rag"], {})
    localizer = snapshot["online_roles"]["localizer"]
    teacher = snapshot["online_roles"]["teacher"]
    assert localizer["model"] == "gpt-5.6-sol"
    assert localizer["base_url"] == teacher["base_url"]
    assert localizer["api_mode"] == "responses"
    assert snapshot["online_roles"]["judge"]["model"] == "gpt-5.6-sol"
    assert "judge-teacher-localizer-sol" in snapshot["engineering_model_revision"]
    assert snapshot["research_manifest"]["schema_version"] >= 1
