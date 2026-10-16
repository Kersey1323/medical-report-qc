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
