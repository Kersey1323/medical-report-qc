from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import event, select, func

from app.main import create_app
from app.db.models import QualityRun, RunReport, ModuleResult, Report, ReviewDecision
from tests.integration.test_schema import factory


def test_review_tasks_aggregate_before_pagination_and_respect_latest_generation(factory):
    app = create_app()
    app.state.session_factory = factory
    client = TestClient(app)
    path = '/api/v1/reviews/tasks'
    baseline = client.get(path).json()
    assert baseline['status'] == 'success'
    baseline_total = baseline['data']['total']

    with factory.begin() as session:
        latest = session.scalar(select(func.max(QualityRun.created_at))) or datetime.now()
        base = max(datetime.now(), latest) + timedelta(seconds=1)
        runs = [QualityRun(checks=['diagnosis', 'csc', 'cgec', 'rag'], config_snapshot={},
                           created_at=base + timedelta(seconds=i)) for i in range(3)]
        session.add_all(runs)
        session.flush()
        run_ids = [r.id for r in runs]

        def add_report(run):
            report = Report(description='合成聚合测试描述', diagnosis='合成诊断')
            session.add(report)
            session.flush()
            row = RunReport(run_id=run.id, report_id=report.id)
            session.add(row)
            session.flush()
            return row

        def add_result(row, branch, status='succeeded', finding='issue', generation=1, reviews=()):
            module = ModuleResult(run_report_id=row.id, branch=branch, status=status,
                                  finding=finding, generation=generation)
            session.add(module)
            session.flush()
            for revision, (gen, kind) in enumerate(reviews, 1):
                session.add(ReviewDecision(module_result_id=module.id, generation=gen,
                                          revision=revision, type=kind, operator='test'))
            return module

        row = add_report(runs[0])
        add_result(row, 'csc')
        add_result(row, 'rag', finding='needs_review', reviews=[(1, 'accept'), (1, 'defer')])
        add_result(row, 'diagnosis', reviews=[(1, 'accept')])
        row = add_report(runs[0])
        add_result(row, 'cgec', generation=2, reviews=[(1, 'accept')])
        add_result(add_report(runs[0]), 'csc', status='failed')
        add_result(add_report(runs[0]), 'csc', finding='no_issue')
        row = add_report(runs[1])
        add_result(row, 'csc')
        add_result(row, 'rag', reviews=[(1, 'accept')])
        add_result(add_report(runs[2]), 'csc', finding='no_issue')
        session.flush()

    statements = []
    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)
    engine = factory.kw['bind']
    event.listen(engine, 'before_cursor_execute', capture)
    try:
        first = client.get(path, params={'page_size': 1}).json()['data']
        second = client.get(path, params={'page_size': 1, 'page': 2}).json()['data']
    finally:
        event.remove(engine, 'before_cursor_execute', capture)

    assert first['total'] == baseline_total + 2
    assert first['page_size'] == 1
    assert first['items'][0]['run_id'] == run_ids[1]
    assert first['items'][0]['pending_reports'] == 1
    assert first['items'][0]['pending_results'] == 1
    task = second['items'][0]
    assert task['run_id'] == run_ids[0]
    assert task['report_total'] == 4
    assert task['pending_reports'] == 2
    assert task['pending_results'] == 3
    assert task['filename'] is None
    assert all('module_results.outcome' not in sql for sql in statements)


def test_review_reports_group_branches_before_pagination_and_keep_partial_reviews(factory):
    app = create_app()
    app.state.session_factory = factory
    client = TestClient(app)
    with factory.begin() as s:
        task = QualityRun(checks=['csc', 'rag'], config_snapshot={})
        other = QualityRun(checks=['csc'], config_snapshot={})
        source = Report(description='按报告复核测试原文', diagnosis='测试诊断')
        s.add_all([task, other, source])
        s.flush()
        run_id, other_id = task.id, other.id
        ids, units = [], []
        for i in range(22):
            row = RunReport(run_id=run_id, report_id=source.id, original_row=i + 2)
            s.add(row)
            s.flush()
            ids.append(row.id)
            pair = []
            for branch in ['csc', 'rag']:
                m = ModuleResult(run_report_id=row.id, branch=branch, status='succeeded',
                                 finding='issue' if i < 21 else 'no_issue')
                s.add(m)
                s.flush()
                pair.append(m.id)
            units.append(pair)
        s.add(RunReport(run_id=run_id, report_id=None, invalid=True, original_row=24))
    path = f'/api/v1/reviews/tasks/{run_id}/reports'
    first = client.get(path).json()['data']
    assert first['total'] == 21
    assert [r['id'] for r in first['items']] == ids[:20]
    assert first['items'][0]['pending_branches'] == ['csc', 'rag']
    assert first['items'][0]['pending_results'] == 2
    second = client.get(path, params={'page': 2}).json()['data']
    assert [r['id'] for r in second['items']] == [ids[20]]
    assert client.get(f'/api/v1/reviews/tasks/{other_id}/reports').json()['data']['total'] == 0

    def review(mid, kind, revision=0):
        response = client.post('/api/v1/reviews', json={
            'module_result_id': mid, 'generation': 1, 'expected_revision': revision,
            'type': kind,
        })
        assert response.json()['status'] == 'success'

    review(units[0][0], 'accept')
    partial = client.get(path).json()['data']
    assert partial['total'] == 21
    assert partial['items'][0]['pending_branches'] == ['rag']
    review(units[0][1], 'defer')
    assert client.get(path).json()['data']['items'][0]['pending_results'] == 1
    review(units[0][1], 'reject', 1)
    completed = client.get(path).json()['data']
    assert completed['total'] == 20
    assert ids[0] not in [r['id'] for r in completed['items']]
    all_reports = client.get(path, params={'review_state': 'all'}).json()['data']
    assert all_reports['total'] == 22
    assert all_reports['items'][0]['id'] == ids[0]
    assert all_reports['items'][0]['pending_results'] == 0
    with factory.begin() as s:
        s.get(ModuleResult, units[0][0]).generation = 2
    assert client.get(path).json()['data']['items'][0]['pending_branches'] == ['csc']
