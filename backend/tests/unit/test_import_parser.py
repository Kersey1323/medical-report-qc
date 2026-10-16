from io import BytesIO
from pathlib import Path
import pytest
from app.services.import_service import parse_upload
from app.core.exceptions import AppError
from openpyxl import Workbook


def test_bom_rows(tmp_path):
    p = tmp_path / "x.csv"
    p.write_bytes(
        '\ufeff影像描述,医生诊断,附加列\n甲,乙,中文\n,丙,无效\n丁,戊,"含\n换行"'.encode()
    )
    r = parse_upload(p, "text/csv")
    assert r.columns == ["影像描述", "医生诊断", "附加列"]
    assert [x.original_row for x in r.rows] == [2, 3, 4]
    assert r.rows[-1].cells["附加列"] == "含\n换行"


def test_formula_literal(tmp_path):
    p = tmp_path / "a.xlsx"
    w = Workbook()
    s = w.active
    s.append(["描述", "诊断"])
    s.append(["=1+1", "乙"])
    w.save(p)
    assert parse_upload(p, "application/xlsx").rows[0].cells["描述"] == "=1+1"


def test_duplicate_headers(tmp_path):
    p = tmp_path / "a.csv"
    p.write_text("甲,甲\n1,2")
    with pytest.raises(AppError):
        parse_upload(p, "text/csv")
