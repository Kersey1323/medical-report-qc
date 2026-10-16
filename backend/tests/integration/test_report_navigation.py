from datetime import datetime
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlalchemy import event
from tests.integration.test_schema import factory
from app.main import create_app
from app.db.models import QualityRun, Report, RunReport
from app.services.run_service import report_page


def test_next_report_follows_task_order_across_pages_and_skips_invalid_rows(factory):
    with factory.begin() as s:
        run = QualityRun(checks=['csc'], config_snapshot={})
        other = QualityRun(checks=['csc'], config_snapshot={})
        report = Report(description='导航集成测试的合成报告', diagnosis='')
        s.add_all([run, other, report]); s.flush()
        run_id, other_id = run.id, other.id
        ids = []
        for index in range(23):
            row = RunReport(run_id=run_id, report_id=report.id if index != 20 else None,
                            invalid=index == 20, original_row=index + 2,
                            created_at=datetime(2026, 1, 1))
            s.add(row); s.flush(); ids.append(row.id)
    app = create_app(); app.state.session_factory = factory
    client = TestClient(app)
    statements = []
    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)
    engine = factory.kw['bind']
    event.listen(engine, 'before_cursor_execute', capture)
    try:
        data = client.get(f'/api/v1/runs/{run_id}/reports/{ids[19]}/navigation').json()['data']
        assert data == {'previous_run_report_id': ids[18], 'next_run_report_id': ids[21], 'position': 20, 'total': 22}
        assert all('reports.description' not in sql and 'module_results.outcome' not in sql for sql in statements)
    finally:
        event.remove(engine, 'before_cursor_execute', capture)
    final = client.get(f'/api/v1/runs/{run_id}/reports/{ids[-1]}/navigation').json()['data']
    assert final == {'previous_run_report_id': ids[-2], 'next_run_report_id': None, 'position': 22, 'total': 22}
    first = client.get(f'/api/v1/runs/{run_id}/reports/{ids[0]}/navigation').json()['data']
    assert first['previous_run_report_id'] is None
    backwards = client.get(f'/api/v1/runs/{run_id}/reports/{ids[21]}/navigation').json()['data']
    assert backwards['previous_run_report_id'] == ids[19]
    wrong_task = client.get(f'/api/v1/runs/{other_id}/reports/{ids[0]}/navigation')
    assert wrong_task.status_code == 200
    assert wrong_task.json()['detail']['code'] == 'resource_not_found'
    missing = client.get(f'/api/v1/runs/{run_id}/reports/{uuid4()}/navigation')
    assert missing.json()['status'] == 'error'
    with factory() as s:
        assert [r['id'] for r in report_page(s, run_id, 1, 20)['items']] == ids[:20]
        assert [r['id'] for r in report_page(s, run_id, 2, 20)['items']] == ids[20:]


def test_task_search_and_review_distribution_use_full_database(factory):
    app = create_app(); app.state.session_factory = factory
    client = TestClient(app)
    with factory.begin() as s:
        run = QualityRun(checks=['csc'], config_snapshot={})
        s.add(run); s.flush(); id = run.id
    response = client.get('/api/v1/runs', params={'q': id, 'status': 'pending', 'order': 'oldest'}).json()['data']
    assert response['total'] == 1 and response['items'][0]['id'] == id
    assert client.get('/api/v1/runs', params={'q': '%'}).json()['data']['total'] == 0
    summary = client.get('/api/v1/system/summary').json()['data']
    assert sum(summary['review_by_branch'].values()) == summary['review_pending']
