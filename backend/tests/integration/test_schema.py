import os
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import IntegrityError
from dotenv import load_dotenv
from app.db.models import Base, Report, QualityRun, RunReport, ModuleResult

load_dotenv(".env")


@pytest.fixture(scope="session")
def factory():
    url = os.getenv("TEST_MYSQL_URL")
    if not url:
        pytest.skip("TEST_MYSQL_URL missing: real MySQL acceptance not executed")
    engine = create_engine(url, hide_parameters=True)
    assert engine.url.database.startswith("medical_qc_test_")
    Base.metadata.create_all(engine)
    yield sessionmaker(engine, expire_on_commit=False)


@pytest.fixture
def seeded(factory):
    with factory.begin() as s:
        r = Report(description="合成描述", diagnosis="合成诊断")
        q = QualityRun(checks=["csc"], config_snapshot={})
        s.add_all([r, q])
        s.flush()
        rr = RunReport(run_id=q.id, report_id=r.id)
        s.add(rr)
        s.flush()
        m = ModuleResult(run_report_id=rr.id, branch="csc")
        s.add(m)
        s.flush()
        return q.id, rr.id, m.id, r.id


def test_unique_work_unit(factory, seeded):
    with pytest.raises(IntegrityError):
        with factory.begin() as s:
            s.add(ModuleResult(run_report_id=seeded[1], branch="csc"))
