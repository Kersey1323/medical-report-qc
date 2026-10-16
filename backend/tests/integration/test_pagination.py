from sqlalchemy import event
from tests.integration.test_schema import factory, seeded
from app.services.run_service import report_page
from app.services.system_service import summary


def test_report_page_and_summary_do_not_load_outcome_blobs(factory, seeded):
    statements = []
    engine = factory.kw["bind"]

    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        with factory() as s:
            result = report_page(s, seeded[0], 1, 20)
            assert result["total"] == 1 and result["items"][0]["id"] == seeded[1]
            summary(s)
        assert all("module_results.outcome" not in sql for sql in statements)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
