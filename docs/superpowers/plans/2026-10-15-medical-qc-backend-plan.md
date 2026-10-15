# Persistent Backend and Task Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建以 MySQL 为事实来源的报告、批量任务、恢复、复核及真实 XLSX 接口。

**Architecture:** API 只接受和查询短请求，Celery 执行独立工作单元。持久 outbox、租约和阶段 attempt 连接两者；测试通过 BranchExecutor 注入，无生产 mock。

**Tech Stack:** Python 3.11、FastAPI/Pydantic2、SQLAlchemy2/Alembic/PyMySQL、Celery/Redis、Loguru、httpx、openpyxl、pytest。

**Spec:** [总计划及共享契约](2026-10-15-medical-qc-implementation.md)、[后端架构](../specs/2026-10-15-medical-qc-backend-architecture.md)、[系统设计](../specs/2026-10-15-medical-report-qc-rebuild-design.md)。

## Global Constraints

- 日志遵循[通用项目日志规范](../../通用项目日志规范.md)及[本项目落地约定](../../日志落地约定.md)：Loguru、stdout INFO/文件DEBUG、当地午夜轮转/30天/ZIP、统一配置与脱敏追踪。
- 总计划所有 Global Constraints 和共享 DTO 是本计划的组成部分。
- 不加载 torch、CUDA 或研究索引；API import 必须是轻量的。
- 真实 MySQL 验收事务与并发，使用专用测试 schema；不得清空业务 schema。
- 每个线程/工作单元独立 Session；不跨网络请求持有数据库事务。
- 自有JSON接口错误统一HTTP 200/status=error/detail，成功为ApiSuccess[T]，外层与任务状态分离；异常规则见总计划。
- max attempts=3；行/分支失败继续，失败与取消不产生 no_issue。

## Review Focus

1. 重复消息/进程崩溃/Redis 丢失后任务可恢复且结果不重复（A3/A4）。
2. CSV BOM、列缺失、混合无效行、XLSX 公式内容不被当作有效报告或执行（A2）。
3. 取消时仍在途的请求保存输出，未开始的工作不启动（A3）。
4. 复核并发提交不覆盖别人意见，模型输出保持不变（A5）。
5. 全失败/部分成功仍能导出真实 XLSX，外部文本不会成为公式（A6）。

---

## 文件责任

- `backend/pyproject.toml`、`.env.example`、`app/main.py`、`app/api/router.py`、`app/core/{config,logging_config,exceptions}.py`：业务依赖、配置、应用工厂、脱敏日志。
- `backend/contracts/{inference,retrieval,errors,responses}.py`、`app/domain/{results,state,ports}.py`、`app/schemas/{reports,runs,imports,results,reviews,exports,system}.py`：总计划对象与 DTO。
- `backend/app/db/{session,models}.py`、`db/repositories/{reports,runs,attempts,outbox,reviews,artifacts}.py`、`migrations/`、`alembic.ini`：事实表、事务和迁移。
- `backend/app/services/{report_service,import_service,run_service,execution_service,evidence_service,review_service,export_service,system_service}.py`：聚焦的业务用例。
- `backend/app/tasks/{celery_app,qc_tasks,import_tasks,export_tasks,recovery}.py`：消息入口和恢复命令。
- `backend/app/api/{router,dependencies}.py`、`api/v1/{reports,imports,runs,results,reviews,exports,system}.py`：REST，固定契约生成 OpenAPI。
- `backend/tests/conftest.py`、`tests/unit/`、`tests/integration/`：纯测试与真实存储测试；每个任务下面列出具体文件。

### A1：轻量契约、状态与数据库骨架

**Files:** Create 上述配置/契约/domain、`backend/app/api/router.py`（空APIRouter供后续任务逐步注册）、`backend/app/db/session.py`、`backend/app/db/models.py`、`backend/alembic.ini`、`backend/migrations/versions/0001_initial.py`、`backend/tests/conftest.py`；Test `backend/tests/unit/test_contracts.py`、`test_state.py`、`test_error_contracts.py`、`backend/tests/unit/test_logging_config.py`、`backend/tests/integration/test_schema.py`。

**Interfaces:** Consumes 总计划 DTO；Produces `create_app()->FastAPI`、`Settings`、`session_scope()->Iterator[Session]`、`summarize_report(outcomes:list[BranchOutcome],selected:list[Branch],invalid:bool=False)->ReportSummary`、`summarize_run(counts:RunCounts,cancel_requested:bool)->str`。`ReportSummary` 含 completeness/anomaly，`RunCounts` 字段照总计划计数。后续所有模型由此处 ORM 引用。另产出 `AppError(detail:ErrorDetail)`、其分类子类及 `configure_logging(log_root:Path,*,service:str,instance_id:str,reset:bool=False)->None`、`install_exception_handlers(app:FastAPI)->None`、ApiSuccess[T]/ApiErrorResponse，轻量包供B复用。

- [ ] **Step 1 — 写失败测试。** 参数化AppError、缺失资源、参数错误、未知RuntimeError：断言HTTP 200、status=error、data=null、detail含code/message/stage/exception_type/cause、request_id；用含测试secret的异常链配合测试专用Loguru sink验证原因和脱敏traceback关联、无secret；不能只用caplog而没有Loguru桥接。success解包后任务status=failed仍是外层success。新增日志测试：stdout仅INFO+、文件DEBUG+、格式/UTF-8/TTY颜色/调用点正确；重复初始化不重复输出，reset仅重建受管sink；不可写目录告警但stdout可用；rotation=00:00/retention=30 days/compression=zip/diagnose=False；两个并发请求/线程不串request_id，标准logging/Uvicorn/Celery无重复handler，外部错误1000字上限且移除控制字符和敏感内容。测试总计划枚举/不可变输入、默认四项及空 checks 拒绝；参数化覆盖完整/部分/失败/取消统计。明确 `failed + issue => (partial,issue)`，单一成功 no_issue 加 pending 不得 normal。`SourceSpan(0,1,'𠮷')` 可表示一个字符；failed 携带 finding 必须校验失败。集成测试启动 Alembic 后以两个 Session 插入同 `(run_report_id,branch)`，第二个应唯一约束失败。测试 fixture：`db_session:Session` 与 `session_factory:Callable[[],Session]` 只连接 `TEST_MYSQL_URL` 指定、名称以 `medical_qc_test_` 开头的 schema；无变量时明确 skip，本地验收必须提供。`redis_client:Redis` 用 `TEST_REDIS_URL` 与随机测试 prefix，退出只清自己 namespace。`client:TestClient` 用 app dependency override 绑定测试 Session；`executor` fixture 是记录调用的 BranchExecutor fake，仅 tests 下提供。
核心断言（`test_failure_and_issue_remain_separate`，变量由上一步的安排/fixture取得）：

```python
assert summary.completeness == "partial"
assert summary.anomaly == "issue"
assert failed_outcome.finding is None
assert error_response.status_code == 200
assert error_response.json()["status"] == "error"
assert error_response.json()["detail"]["exception_type"] == "RuntimeError"
assert error_response.json()["request_id"]
assert file_sink_options["rotation"] == "00:00"
assert file_sink_options["retention"] == "30 days"
assert file_sink_options["compression"] == "zip"
assert file_sink_options["diagnose"] is False
assert sink_output.count("测试日志事件") == 1  # repeated configure_logging
```

- [ ] **Step 2 — Red。** `cd backend && python -m pytest tests/unit/test_contracts.py tests/unit/test_state.py tests/unit/test_error_contracts.py tests/unit/test_logging_config.py tests/integration/test_schema.py -q`；预期新增模块/迁移尚不存在而失败。
- [ ] **Step 3 — 实现上述接口及统一异常处理器。** 按总计划 schema 建 10 张批准主表、`module_result_versions`、`csc_chunks`、`imports`、`import_rows`；UUID CHAR(36)，原文 LONGTEXT，快照 JSON，utf8mb4，FK/索引明确。结果表执行状态与 finding 分列；attempt 独立 append；lease owner/expiry/heartbeat 与 revision 独立字段。Pydantic frozen ReportInput，数据库无 report update 路径；API无重模型导入。定义responses/errors，在业务与内部服务复用同一封装与handler；处理FastAPI校验和Starlette路由/方法异常，不保留框架默认422/404。TestClient对未知异常响应校验时使用raise_server_exceptions=False，另以异常链/日志断言确认不是把异常吞掉。handler输出200但只在边界转换，服务内部保留raise/from与异常链；脱敏同时覆盖格式化traceback。logging_config.py按docs规范配置Loguru并将标准logging/框架日志受控转发，文本key=value字段真实输出，业务启动前幂等初始化；传入绝对APP_LOG_DIR与service/instance_id、按PID文件隔离。error_code/error_type/error_message和attempt/max_attempts日志字段固定；API与任务上下文用contextvars/contextualize，线程显式设置/恢复。业务环境依赖生成lock文件，GPU/CPU extras 不随 API 安装。
- [ ] **Step 4 — Green。** 重跑 Step2，全部 PASS（不得以缺数据库 skip 冒充验收）；另用空环境 `python -c "import app.main,sys; assert 'torch' not in sys.modules"`。迁移 upgrade/downgrade/upgrade 在空测试 schema 成功。
- [ ] **Step 5 — 提交。** `git add backend/pyproject.toml backend/.env.example backend/app/main.py backend/app/api/router.py backend/app/core backend/contracts backend/app/domain backend/app/schemas backend/app/db backend/alembic.ini backend/migrations backend/tests/conftest.py backend/tests/unit/test_contracts.py backend/tests/unit/test_state.py backend/tests/unit/test_error_contracts.py backend/tests/unit/test_logging_config.py backend/tests/integration/test_schema.py`；`git commit -m "feat: define qc contracts and persistent schema"`。

### A2：不可变报告与异步批量导入

**Files:** Create `backend/app/services/report_service.py`、`import_service.py`、`backend/app/db/repositories/reports.py`、`backend/app/tasks/import_tasks.py`、`backend/app/api/v1/reports.py`、`imports.py`；Modify `backend/app/api/router.py`；Test `backend/tests/unit/test_import_parser.py`、`backend/tests/integration/test_reports_imports.py`。

**Interfaces:** Consumes A1 Session/ReportInput；Produces `create_report(session:Session,data:ReportCreate)->ReportInput`、`parse_upload(path:Path,media_type:str)->ParsedImport`、`confirm_import(session:Session,import_id:UUID,mapping:ColumnMapping,checks:list[Branch])->ImportConfirmation`。`ParsedImport(columns:list[str],rows:list[ParsedRow],errors:list[dict])`，`ParsedRow(original_row:int,cells:dict[str,str|None],errors:list[dict])`；`ColumnMapping(description_column:str,diagnosis_column:str|None)`；ImportConfirmation 返回 report_ids/invalid_rows，映射与checks组合幂等。

- [ ] **Step 1 — 写失败测试。** 在测试中直接构造 BOM CSV bytes 与 openpyxl Workbook：第2行有效、第3行描述空、第4行有效，附加列含中文/引号/换行。断言保留原始行号2/3/4、两条有效报告、一条 invalid、额外列逐字保留；缺列/空文件/重复表头/全无效必须给明确错误。XLSX `=HYPERLINK(...)` 作为单元格文本保留且不求值。路径 `../../x.xlsx` 不影响随机存储名；超 20MiB、超10000数据行、超100列或超解压200MiB拒绝；大文件解析在 worker 而非上传 HTTP 中运行。标题映射不按相似列名自动确认，原文不可 PATCH。
核心断言（`test_bom_csv_preserves_invalid_row_and_extra_fields`，变量由上一步的安排/fixture取得）：

```python
assert parsed.columns == ["影像描述", "医生诊断", "附加列"]
assert [row.original_row for row in parsed.rows] == [2, 3, 4]
assert len(confirmation.invalid_rows) == 1
assert len(confirmation.report_ids) == 2
```

- [ ] **Step 2 — Red。** `cd backend && python -m pytest tests/unit/test_import_parser.py tests/integration/test_reports_imports.py -q`；预期 parser/路由缺失失败。
- [ ] **Step 3 — 实现接口并注册到app/api/router.py。** CSV 严格 UTF-8-sig；XLSX 只接受 xlsx，zip size 预检，read_only、data_only=False；只读取首个工作表并将名称记录在导入元数据。保存上传 artifact 的 SHA256 和原名，路径由 ID 决定。上传202，解析通过 outbox kind=import 接入 A4；未到 A4 时测试直接调用 import task 函数，不加进程内 background fallback。confirm 在事务中固定映射与报告；重复确认同映射返回原结果，异映射/checks返回HTTP 200/status=error/detail.code=import_mapping_conflict；invalid 行持久保存。run导入须使用确认时checks，变更checks重新确认新导入或重新建报告运行，不沿用不相符的有效性判断。诊断仅在所选 checks 不含 diagnosis 时可为空，默认四项要求两列均非空。
- [ ] **Step 4 — Green。** 重跑 Step2；断言 POST 返回202时还未同步执行解析，确认后原始数据/invalid 行可重新查询，响应没有服务器绝对路径。
- [ ] **Step 5 — 提交。** `git add backend/app/services/report_service.py backend/app/services/import_service.py backend/app/db/repositories/reports.py backend/app/tasks/import_tasks.py backend/app/api/v1/reports.py backend/app/api/v1/imports.py backend/app/api/router.py backend/tests/unit/test_import_parser.py backend/tests/integration/test_reports_imports.py`；`git commit -m "feat: persist immutable reports and mapped batch imports"`。

### A3：独立工作单元、阶段重试与取消

**Files:** Create `backend/migrations/versions/0002_run_commands.py`、`backend/app/services/run_service.py`、`execution_service.py`、`backend/app/db/repositories/runs.py`、`attempts.py`、`backend/app/tasks/qc_tasks.py`；Test `backend/tests/integration/test_execution.py`、`test_stage_attempts.py`。

**Interfaces:** Consumes `BranchExecutor.execute`、A1 domain；Produces `create_run(session:Session,data:RunCreate)->RunDTO`、`start_run(run_id:UUID,preflight:PreflightDTO)->RunDTO`、`execute_unit(module_result_id:UUID,executor:BranchExecutor)->None`、`cancel_run(run_id:UUID)->RunDTO`、`retry_failed(run_id:UUID,expected_revision:int,module_result_ids:list[UUID]|None=None)->RunDTO`。`StageRunner.run(stage:str,chunk_key:str,input_hash:str,context:StageContext,invoke:Callable[[UUID,int],StageOutput])->StageOutput`；StageOutput 为 `{payload:dict,identity:dict,request_id:UUID|None}`；用同 request ID 查询属于 invoke 内部，只有确定新调用才创建新 attempt；invoke包含模型返回后的结构/语义校验，不把无效响应缓存为成功。StageValidationError保留raw与身份，结构错误可在总计3次内重试。

- [ ] **Step 1 — 写失败测试。** fixture executor 按 branch 配置：diagnosis succeeded/issue、csc failed、其余 succeeded/no_issue；两份报告执行后断言全部8单元都被处理、run partial、finding 不覆写、每线程 Session 不同。两个线程同时 execute 同 ID，executor 调用一次。StageRunner 对可重试错误恰好调用3次、配置错误1次；第2阶段失败重试时第1阶段复用并记录源attempt。增加链式异常场景：适配器raise UpstreamError from ReadTimeout→StageRunner持久失败并有限重试→最终重新抛出→execute_unit落failed，日志关联同一request_id/task_id/item_id及inference_request_id，最终责任边界完整堆栈一次、重试WARNING摘要；数据库落盘失败必须继续抛InfrastructureError，不能假确认成功。取消时用 threading.Event 卡住一条调用：取消后已在途返回落盘、下一 chunk/单元未调用、终态 cancelled。retry-failed 并发同expected_revision只开启一次新generation，成功单元不变，旧输出可查。
核心断言（`test_branch_failure_does_not_stop_remaining_work`，变量由上一步的安排/fixture取得）：

```python
assert run.status == "partial"
assert len(executor.calls) == 8
assert generation_after_retry == generation_before_retry + 1
assert successful_stage_calls_after_retry == successful_stage_calls_before_retry
```

- [ ] **Step 2 — Red。** `cd backend && python -m pytest tests/integration/test_execution.py tests/integration/test_stage_attempts.py -q`；预期服务不存在而失败。
- [ ] **Step 3 — 实现服务。** CAS 认领+租约 heartbeat，调用前后独立短事务。StageRunner 统一次数、退避、错误分类及成功复用；Cancelled/invalid 不当 failure 重试。创建所有单元与不可发布 outbox 同一事务；预检可用后 start 原子激活。generation属于工作单元；retry请求expected_revision匹配运行revision，二者不混用。持久保存该次retry命令的revision+目标集合，重复相同请求返回原响应，过期冲突返回HTTP 200/error/revision_conflict；增加run_commands表及(command_kind,run_id,expected_revision)唯一约束（补充迁移0002_run_commands）。创建/重试/attempt记录origin_request_id并传入StageContext；每次任务状态变化递增RunDTO.revision；尝试历史不可删。成功模块结果落盘和汇总在事务内更新，必要时以事实重算，不能只靠 Celery 回调。
- [ ] **Step 4 — Green。** 重跑 Step2，真实 MySQL 并发测试 PASS；测试超时必须释放 Event，不能留下线程。所有失败/取消 DTO 无 finding。
- [ ] **Step 5 — 提交。** `git add backend/migrations/versions/0002_run_commands.py backend/app/db/models.py backend/app/services/run_service.py backend/app/services/execution_service.py backend/app/db/repositories/runs.py backend/app/db/repositories/attempts.py backend/app/tasks/qc_tasks.py backend/tests/integration/test_execution.py backend/tests/integration/test_stage_attempts.py`；`git commit -m "feat: execute durable branch units with bounded stage retries"`。

### A4：事务 outbox、Celery 与恢复

**Files:** Create `backend/app/db/repositories/outbox.py`、`backend/app/tasks/celery_app.py`、`recovery.py`、`backend/ops/systemd/medical-qc-recovery.service`、`medical-qc-recovery.timer`；Modify `backend/app/main.py`；Test `backend/tests/integration/test_outbox_recovery.py`。

**Interfaces:** Consumes A3 工作单元与 attempt；Produces `publish_outbox(limit:int=100)->RecoveryCounts`、`recover_once(now:datetime,lookup_remote:Callable[[UUID],RequestState]|None=None)->RecoveryCounts`、命令 `python -m app.tasks.recovery --once`；RecoveryCounts 包括 published/reclaimed/reconciled/errors。任务入口 `process_qc_unit(module_result_id:str)`、`process_import(import_id:str)`、`process_export(artifact_id:str)`，只传 ID。lookup_remote通过注入调用未来B2的 `InferencePort.get(request_id:UUID)->RequestState`；本任务测试注入lambda返回已知RequestState，不提前import尚未创建的client。未配置lookup时在途远端状态不确定、保持不重复提交；C6再接生产实现。

- [ ] **Step 1 — 写失败测试。** 模拟 DB 提交后 broker publish 报错；run和outbox都还在，恢复后可发布执行。发布成功但标记前崩溃→重复发布，A3 CAS 保证结果唯一。expired lease+远端 running 时续管、不再 enqueue；远端 succeeded 时取结果；unknown 标 `remote_state_unknown` 并保留原requestID；只有确认runtime重启、旧实例已终止才可有限新attempt。仅网络不可达时先等待/失败标不确定，不盲目重复排队；不得宣称 exactly-once。清空仅测试 Redis namespace 后 recover 能由 MySQL 重建消息；cancelled/pending未start不补发。两个 recover 并发无重复结果。
核心断言（`test_publish_crash_recovery_is_idempotent`，变量由上一步的安排/fixture取得）：

```python
assert persisted_run_id == submitted_run_id
assert executor_call_count == 1
assert saved_result_count == 1
assert recovery_of_unstarted_run.published == 0
```

- [ ] **Step 2 — Red。** `cd backend && python -m pytest tests/integration/test_outbox_recovery.py -q`；预期模块缺失失败。
- [ ] **Step 3 — 实现 outbox 和恢复。** outbox kind qc/import/export，支持延迟 eligible；发布失败不删除行。每次有界扫描及数据库认领，回收前查看活跃 attempt；远端无法确认不抹去不确定性。Celery threads4、prefetch1、acks_late，禁止自动重试叠加。API 启动执行一次恢复；systemd timer OnUnitActiveSec=60s，同命令可重入，无 Beat。发布补偿与任务重放不消费模型尝试次数。发布、执行、每批或30秒节流进度及最终结果如实记录；日志task_id=quality_run.id、item_id=run_report.id，传输Celery ID另记；成功/失败/取消完成计数互斥，不与报告异常数混算。
- [ ] **Step 4 — Green。** 重跑 Step2；在测试 broker 短暂不可用时 API 返回持久任务而非内存成功，恢复测试全部PASS。`systemd-analyze verify backend/ops/systemd/medical-qc-recovery.service backend/ops/systemd/medical-qc-recovery.timer` 使用 D5 补全环境路径后无语法错误；本任务不启动主机 unit。
- [ ] **Step 5 — 提交。** `git add backend/app/db/repositories/outbox.py backend/app/tasks/celery_app.py backend/app/tasks/recovery.py backend/app/main.py backend/ops/systemd/medical-qc-recovery.service backend/ops/systemd/medical-qc-recovery.timer backend/tests/integration/test_outbox_recovery.py`；`git commit -m "feat: recover durable jobs through outbox and leases"`。

### A5：结果证据查询与追加复核

**Files:** Create `backend/app/services/evidence_service.py`、`review_service.py`、`backend/app/db/repositories/reviews.py`、`backend/app/api/v1/results.py`、`reviews.py`；Modify `backend/app/api/router.py`；Test `backend/tests/integration/test_results_reviews.py`。

**Interfaces:** Consumes module_results/evidence/attempts；Produces `get_result(result_id:UUID)->ResultDTO`、`get_evidence(result_id:UUID)->list[EvidenceSnapshot]`、`append_review(command:ReviewCreate,operator:str='local_operator')->ReviewDTO`，响应含 revision 和完整审核历史。复核作用于该 module_result 的指定 generation，不自动迁移到新模型输出；命令必须携带generation，过期返回HTTP 200/error/revision_conflict。GET /results分页支持review_state=pending/reviewed，defer仍pending，accept/reject/edit才reviewed。

- [ ] **Step 1 — 写失败测试。** 两次同 expected_revision=0 的 review 并发，一条HTTP 201/status=success、另一HTTP 200/status=error且detail.code=revision_conflict；defer 不产生确认稿，edit 必须非空；accept/reject 不改原始描述/模型 text。重试新 generation 后旧审核仍可查且不自动视为已审核。evidence 查询即使索引文件改变也返回原快照，保留 nullable 来源和实际used数。raw endpoint 只能取属于 result 的 attempt，跨ID返回HTTP 200/error/resource_not_found，鉴权头和密钥不出现在响应/日志。
核心断言（`test_review_conflict_preserves_originals`，变量由上一步的安排/fixture取得）：

```python
assert sorted(response_codes) == [200, 201]
assert conflict_response.json()["status"] == "error"
assert conflict_response.json()["detail"]["code"] == "revision_conflict"
assert original_report_sha_after == original_report_sha_before
assert model_output_sha_after == model_output_sha_before
```

- [ ] **Step 2 — Red。** `cd backend && python -m pytest tests/integration/test_results_reviews.py -q`；预期路由/服务缺失失败。
- [ ] **Step 3 — 实现查询、追加复核并注册路由。** 受控 raw 分段限制1MiB，artifact外路径不可访问；不把日志当 raw 存储。保留建议冲突，逐项复核，不生成自动合并“最终完整报告”。单元不存在返回HTTP 200/status=error/detail.code=resource_not_found，绝不返回示例结果。
- [ ] **Step 4 — Green。** 重跑 Step2，PASS；在DB中比较复核前后报告/attempt输出SHA256一致。
- [ ] **Step 5 — 提交。** `git add backend/app/services/evidence_service.py backend/app/services/review_service.py backend/app/db/repositories/reviews.py backend/app/api/v1/results.py backend/app/api/v1/reviews.py backend/app/api/router.py backend/tests/integration/test_results_reviews.py`；`git commit -m "feat: expose frozen evidence and append-only review history"`。

### A6：异步真实 XLSX 导出

**Files:** Create `backend/app/services/export_service.py`、`backend/app/db/repositories/artifacts.py`、`backend/app/tasks/export_tasks.py`、`backend/app/api/v1/exports.py`；Modify `backend/app/api/router.py`；Test `backend/tests/integration/test_exports.py`。

**Interfaces:** Consumes RunDTO/持久结果；Produces `request_export(run_id:UUID)->ArtifactDTO`、`build_export(artifact_id:UUID)->Path`；artifact 含 status、sha256、snapshot_at、filename、受控download_url。导出读取快照，不随生成期间复核改写。

- [ ] **Step 1 — 写失败测试。** partial/failed/cancelled 三类各生成；用 openpyxl 重新打开检查精确7张表：`报告汇总,诊断质控,字符纠错,语法纠错,片段定位,失败记录,处理汇总`。检查 invalid 行、未选中分支、失败stage、取消、配置版本与重叠统计。输入 `=1+1,+SUM(A1),-1,@cmd` 等字符串单元格 data_type 必须 `s`，内容不变；XLSX ZIP 文件头与 MIME 正确。超32767字符的正文分段到连续编号行，不能静默截断；raw大响应不入表。
核心断言（`test_partial_export_is_literal_xlsx`，变量由上一步的安排/fixture取得）：

```python
assert workbook.sheetnames == ["报告汇总", "诊断质控", "字符纠错", "语法纠错", "片段定位", "失败记录", "处理汇总"]
assert formula_like_cell.value == "=1+1"
assert formula_like_cell.data_type == "s"
```

- [ ] **Step 2 — Red。** `cd backend && python -m pytest tests/integration/test_exports.py -q`；预期导出服务缺失失败。
- [ ] **Step 3 — 实现异步导出并注册路由。** 请求与outbox事务提交，write-only workbook逐行写；外部内容显式文本类型。没有任何有效行的导入不建run；只要run有持久报告即可导出，全部模型失败不阻塞。下载按artifactID查路径，未完成HTTP 200/error/artifact_not_ready、未知HTTP 200/error/resource_not_found，文件名可读且后缀xlsx；临时文件原子rename，SHA256落盘。
- [ ] **Step 4 — Green。** 重跑 Step2；导出接口202，worker完成后下载200，断网/刷新页面不取消导出。
- [ ] **Step 5 — 提交。** `git add backend/app/services/export_service.py backend/app/db/repositories/artifacts.py backend/app/tasks/export_tasks.py backend/app/api/v1/exports.py backend/app/api/router.py backend/tests/integration/test_exports.py`；`git commit -m "feat: export auditable partial qc results as xlsx"`。

### A7：REST 聚合、预检和稳定 OpenAPI

**Files:** Create `backend/app/api/dependencies.py`、`api/v1/runs.py`、`system.py`、`backend/app/services/system_service.py`、`backend/ops/scripts/export_openapi.py`；Modify `backend/app/main.py`、`backend/app/api/router.py`、`backend/app/schemas/`；Test `backend/tests/integration/test_api_contract.py`、`backend/tests/unit/test_redaction.py`、`backend/tests/integration/test_exception_boundaries.py`；Create `backend/openapi.json`。

**Interfaces:** Consumes A1–A6及ApiResponse[T]；Produces总计划API全集（JSON响应统一封装），`PreflightDTO(ready:bool,branches:dict[Branch,BranchReadiness],identities:list[ModelIdentity],capacity:dict)`；`BranchReadiness(ready:bool,reasons:list[ErrorDetail])`。`SystemService.preflight(config:RunConfig)->PreflightDTO` 依赖 B 的 readiness clients，未配置明确unavailable。

- [ ] **Step 1 — 写失败测试。** TestClient 完整路径：建report→默认四项run→预检一个角色不可用→start返回HTTP 200/status=error/detail.code=preflight_failed且零消息；显式只选可用项后202；start重复不重复outbox。GET未知ID返回HTTP 200/error/resource_not_found，列表分页稳定按 created_at,id 排序；check=[]返回HTTP 200/error/input_validation_error。/system/summary在超过一页报告时仍返回DB全量聚合，GET /results待复核筛选与defer一致。状态与审计JSON不能包含测试secret、原始鉴权头或假CPU健康分。接口未提供模型路径修改与登录；无CORS通配公网配置。每接口验证统一ApiResponse封装；未捕获RuntimeError也必须200/error且有可追踪detail。批量失败查询是外层success/data.status=partial，不能错误封装成接口error。
核心断言（`test_unavailable_branch_blocks_start_without_dropping_it`，变量由上一步的安排/fixture取得）：

```python
assert start_response.status_code == 200
assert start_response.json()["status"] == "error"
assert start_response.json()["detail"]["code"] == "preflight_failed"
assert published_message_count == 0
assert run.checks == ["diagnosis", "csc", "cgec", "rag"]
```

- [ ] **Step 2 — Red。** `cd backend && python -m pytest tests/integration/test_api_contract.py tests/unit/test_redaction.py tests/integration/test_exception_boundaries.py -q`；预期聚合路由/预检缺失失败。
- [ ] **Step 3 — 固化路由与DTO及聚合查询。** 总计划接口落到APIRouter，传入工厂依赖；preflight检测全部依赖，拒绝以mock ready作为生产预检。统一exception handler挂载并约束所有JSON路由响应；成功201/202保留但data封装，失败统一200。OpenAPI按status判别的ApiResponse联合不能仍将错误只描述在4xx/5xx，也不能出现默认422响应。日志按照落地约定记录request_id/task_id/item_id/module_result_id/stage/attempt/max_attempts，接口http_status=200同时记录response_status=error/error_code；HTTP中间件路径不含query、耗时用perf_counter，最终边界Loguru异常记录包含脱敏cause链/traceback且不重复；展示用detail与日志可互查。生成 `backend/openapi.json`，错误码枚举附JSON schema，供D1类型生成。前端只读system配置，不向其暴露供应商token。
- [ ] **Step 4 — Green。** `cd backend && python -m pytest tests/unit tests/integration -q`，全部PASS；`python ops/scripts/export_openapi.py --output openapi.json` 后重新导出到临时路径并逐字一致；此阶段不要求实际模型预检ready。
- [ ] **Step 5 — 提交。** `git add backend/app/api backend/app/services/system_service.py backend/app/main.py backend/app/schemas backend/ops/scripts/export_openapi.py backend/openapi.json backend/tests/integration/test_api_contract.py backend/tests/unit/test_redaction.py backend/tests/integration/test_exception_boundaries.py`；`git commit -m "feat: finalize persistent qc rest api and preflight contract"`。
