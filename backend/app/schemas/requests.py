from typing import Literal
from uuid import UUID
from pydantic import BaseModel, Field, model_validator
from contracts.inference import Branch, BRANCHES


class ReportCreate(BaseModel):
    description: str = Field(min_length=1, max_length=200000)
    diagnosis: str = Field(default="", max_length=200000)
    extra_fields: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def nonblank(self):
        if not self.description.strip():
            raise ValueError("描述不能为空")
        return self


class Checks(BaseModel):
    checks: list[Branch] = Field(default_factory=lambda: list(BRANCHES))
    profiles: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def valid(self):
        if not self.checks:
            raise ValueError("至少选择一项")
        self.checks = [b for b in BRANCHES if b in self.checks]
        return self


class RunCreate(Checks):
    report_ids: list[UUID] | None = None
    import_id: UUID | None = None

    @model_validator(mode="after")
    def source(self):
        if bool(self.report_ids) == bool(self.import_id):
            raise ValueError("报告或导入来源必须且只能提供一种")
        if self.report_ids and len(self.report_ids) > 10000:
            raise ValueError("最多10000份报告")
        return self


class ColumnMapping(Checks):
    description_column: str
    diagnosis_column: str | None = None


class RetryCommand(BaseModel):
    expected_revision: int = Field(ge=0)
    module_result_ids: list[UUID] | None = None


class ReviewCreate(BaseModel):
    module_result_id: UUID
    generation: int = Field(ge=1)
    expected_revision: int = Field(ge=0)
    type: Literal["accept", "reject", "edit", "defer"]
    text: str | None = Field(default=None, max_length=200000)
    note: str | None = Field(default=None, max_length=10000)

    @model_validator(mode="after")
    def edited(self):
        if self.type == "edit" and not (self.text or "").strip():
            raise ValueError("确认内容不能为空")
        return self


class ExportCreate(BaseModel):
    run_id: UUID


class SingleCheck(Checks):
    description: str = Field(min_length=1, max_length=200000)
    diagnosis: str = Field(default="", max_length=200000)

    @model_validator(mode="after")
    def content(self):
        if not self.description.strip():
            raise ValueError("影像描述不能为空")
        if "diagnosis" in self.checks and not self.diagnosis.strip():
            raise ValueError("诊断质控需要医生原始诊断")
        if self.profiles:
            raise ValueError("临时检查使用当前工程配置")
        return self
