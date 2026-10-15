# Medical Report QC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已审核的桌面 Web 原型实现为可恢复、可溯源的四项医学影像报告质控系统。

**Architecture:** FastAPI/MySQL 提供持久化业务接口，Celery/Redis 执行独立分支任务；单进程 GPU 服务串行运行三个骨干，CPU 服务常驻检索索引并重排。React 保留已审核样式，替换模拟状态与数据。四项始终读取相同原始报告，模型建议不串入其他分支。

**Tech Stack:** React＋TypeScript＋Vite＋Tailwind CSS；Python 3.11 业务环境、FastAPI、Pydantic 2、SQLAlchemy 2、Alembic、PyMySQL、Loguru、MySQL 8.0+、Celery、Redis 6.2+、openpyxl、httpx、pytest；Python 3.10 独立 GPU 环境，Torch 2.6.0+cu124、Transformers 4.50.0、PEFT 0.15.0；独立 CPU 检索环境。

**Spec:** [系统设计](../specs/2026-10-15-medical-report-qc-rebuild-design.md)、[实验契约](../specs/2026-10-15-medical-cgec-experiment-contract.md)、[后端架构](../specs/2026-10-15-medical-qc-backend-architecture.md)。执行者先读三份 spec，再读本索引和当前子计划。

## Global Constraints

- 日志遵循[通用项目日志规范](../../通用项目日志规范.md)及[本项目落地约定](../../日志落地约定.md)：Loguru、stdout INFO/文件DEBUG、当地午夜轮转/30天/ZIP、统一配置与脱敏追踪。
- 用户已批准 `frontend/prototype/index.html`；只做桌面 Web，验收宽度 1280/1440/1920px。侧栏 256px、收起 80px；不增加移动端、登录、聊天、训练平台或旧三专家兼容逻辑。
- 默认 `diagnosis/csc/cgec/rag` 全选；新系统独立数据库与环境，不迁移旧数据库、不停止旧服务。禁止占用已有 5000/8003/5173。
- 所有自有JSON API错误统一HTTP 200、`status="error"`、`detail=ErrorDetail`；客户端必须解析业务状态，不能以HTTP 200判成功。异常链、脱敏堆栈和request_id必须可追踪。
- MySQL 为事实来源；Redis 丢失不能丢失原文、证据、结果和重试历史。生产环境无 mock 降级。
- 每模型阶段每个执行代际最多总计 3 次尝试；SDK/HTTP/Celery 禁止嵌套自动重试。成功阶段可复用，不能整链重跑掩盖失败。
- GPU 全局并发 1；Celery threads 并发 4；在线调用跨 worker 全局并发 2；CPU rerank 并发 1、FP32、batch 4、线程 4。
- 四项输入均为不可变原始描述；诊断额外读取原始诊断。code point `[start,end)` 是唯一原文坐标，不能按首次文本匹配定位。
- 保留原始模型响应、配置和证据快照，普通日志不写报告正文或密钥。开发真实调用只使用明确合成报告，不自动跑患者数据或论文评测集。
- 本文中的端口、超时和锁租约是工程初值，必须经部署探测与容量验收；不能因此宣称复现论文指标或彻底清除主机历史入侵。部署应在用户重装/确认可信后的环境进行。

## Review Focus

1. 重复消息、发布失败、进程重启：同一工作单元不重复提交，已成功阶段保留（A3/A4、B2、D6）。
2. 分支失败、取消与无效批量行混合：继续其他工作，失败不能显示正常，计数口径明确（A2/A3/A5、D2/D3）。
3. Unicode、重复片段、换行与边界插入：原文位置准确，歧义进入复核（C1/C3/C4/C5、D4）。
4. 近重复证据、重排坏值和少于 Top-k：严格排序过滤，保留真实内容，不补造证据（B5/B6、C4/C5、D4）。
5. 在线 JSON 无效、输出截断、请求超时但 GPU 未停：有限重试，无假成功或自动换模型（B2/B3、C2/C4/C5、D6）。

---

## 实施顺序与文件责任

项目根目录：`/mnt/mydrive/project/medical-report-qc`。下列文件路径均相对根目录；命令除注明外在根目录执行。本轮仅编写计划，不创建计划中的业务文件。

| 顺序 | 子计划 | 可独立验收的交付 |
| --- | --- | --- |
| A | [后端与持久化任务](2026-10-15-medical-qc-backend-plan.md) | 真实 MySQL/Redis 下的导入、任务恢复、复核与 XLSX；测试注入确定性执行器 |
| B | [模型与检索运行时](2026-10-15-medical-qc-runtimes-plan.md) | 有身份、预检和请求追踪的 GPU/CPU 内部 HTTP 服务 |
| C | [四项质控方法](2026-10-15-medical-qc-pipelines-plan.md) | 无 gold 的四个 pipeline，通过方法契约测试并接入真实端口 |
| D | [Web 联调与部署验收](2026-10-15-medical-qc-web-acceptance-plan.md) | 已审核 Web 接口化、持久任务端到端和真实合成输入验收 |

依赖：A1 定义轻量契约后 B 可开发；C 依赖 A1/A3、B 的端口；D1 可在 A7 OpenAPI 稳定后进行，D6 必须等 A/B/C 完成。默认按 A→B→C→D 顺序，禁止提前以 UI mock 冒充四项完成。

### 共享对象与语义（所有子计划使用同一名称）

`backend/contracts/inference.py` 定义轻量 Pydantic DTO，不导入 torch：

- `Branch = Literal['diagnosis','csc','cgec','rag']`。
- `ExecutionStatus = Literal['pending','running','succeeded','failed','cancelled']`。
- `Finding = Literal['no_issue','issue','needs_review']`；只有 `succeeded` 可有 finding。
- `SourceSpan(start:int,end:int,text:str)`；允许 `start==end,text==''` 的插入点；必须满足原文切片校验。
- `ModelIdentity(role:str,path_or_model:str,revision:str|None,tokenizer_hash:str|None,adapter_hash:str|None,source_hashes:dict[str,str])`；真实模型加载后填写。未加载/路径或模型名未知不可ready；在线供应商不提供不可变revision、无本地tokenizer时相应字段为null并记录限制，不伪造hash或据此永久阻塞在线角色。
- `InferenceRequest(request_id:UUID,role:Literal['diagnosis','csc','cgec'],source:str,prompt:str|None,config_fingerprint:str,parameters:dict,deadline_at:datetime)`；prompt 仅 CGEC completion 使用，诊断由 runtime 用版本化模板生成，CSC 忽略 prompt 并拒绝非空。
- `InferenceOutput(request_id, text, raw_text, identity, input_tokens, output_tokens, stop_reason, coverage:dict, elapsed_ms)`。
- `RequestState(request_id,status:Literal['queued','running','succeeded','failed','cancelled','unknown'],output:InferenceOutput|None,error:ErrorDetail|None)`。
- `ErrorDetail(code:str,message:str,retryable:bool,stage:str,remote_state:str|None,exception_type:str|None,cause:str|None,context:dict)`；message/cause/context提供可用于维护的详细原因并脱敏，context只收allowlist字段。新增字段对已有内部构造默认null/空dict。`BranchOutcome.error`和`RequestState.error`仍使用此对象；HTTP错误放在外层detail，不能混淆两层。

`backend/contracts/retrieval.py`：
- `RetrievalRequest(request_id:UUID,source:str,config_fingerprint:str,recall_k:int=20)`。
- `Candidate(candidate_id,node_id,doc_id:str|None,text,content_scope:Literal['report','indexed_chunk'],full_report_text:str|None,provenance:dict,recall_rank:int,recall_score:float|None,rerank_rank:int|None,rerank_score:float|None,similarity:float|None,filter_reason:str|None)`；metadata 缺失保留 null，不能推测来源。text始终为实际检索/重排的正文；full_report_text只有检索项本身为报告或可验证原始语料映射时填写，过滤仍针对text。两者均写证据快照，前端展示全文时不能改写模型当时看到的证据。
- `CandidateSet(candidates:list[Candidate],index_fingerprint,embedding_fingerprint,config_fingerprint)`；20 是上限，真实不足可以少于 20；所有召回项都保留。
- `EvidenceSnapshot(id,branch,candidate:Candidate,used_rank:int|None,used:bool)`；持久保存当次内容，不能查询最新索引代替历史。

`backend/app/domain/results.py`：
- `ReportInput(id:UUID,description:str,diagnosis:str,original_row:int|None,extra_fields:dict)`，冻结对象。
- `RunConfig(checks:list[Branch],profiles:dict[str,str],fingerprint:str,snapshot:dict)`；checks 去重且非空，按四项固定顺序。
- `BranchOutcome(status:ExecutionStatus,finding:Finding|None,spans:list[SourceSpan],suggestions:list[dict],evidence:list[EvidenceSnapshot],stages:list[dict],error:ErrorDetail|None,details:dict)`；failed/cancelled 不允许 finding。
- `StageContext(module_result_id:UUID,generation:int,config:RunConfig,cancel_requested:Callable[[],bool],request_id:UUID|None=None)`，不持有DB Session；request_id为追踪编号，inference payload.request_id为幂等编号，按日志落地约定分开记录。
- `BranchExecutor.execute(branch:Branch,report:ReportInput,context:StageContext)->BranchOutcome` 是 A 的注入边界，C6 提供生产实现。
- pipeline 统一 `run(report:ReportInput,context:StageContext)->BranchOutcome`，依赖由构造函数注入。

### 状态、代际、attempt 和事务

- `module_results` 是稳定工作单元，唯一 `(run_report_id,branch)`；`generation` 初始 1。手动 `retry-failed` 只对 failed 单元开启新 generation，先保存旧结果到 `module_result_versions`；既有 succeeded 和 cancelled 单元不自动重试。
- `inference_attempts` 以 `(module_result_id,generation,stage,chunk_key,attempt_no)` 唯一，stage 包括 `diagnosis.generate/diagnosis.judge/csc.correct/retrieval/cgec.teacher/cgec.student/rag.first/rag.second`。`attempt_no` 为 1..3；远端同一 request ID 的轮询不是新 attempt。
- `StageRunner.run` 的 invoke 必须包含单次模型调用及该阶段结构/语义校验，校验成功才返回StageOutput。`StageValidationError` 携带 ErrorDetail/raw_response/identity 供持久化；不得在StageRunner返回成功后才解析无效JSON，否则重试预算与成功缓存都会出错。
- attempt 包含输入/配置 SHA256、remote request ID、状态与租约、输出/错误及身份。可复用同单元历史 generation 中相同 stage/chunk/input/config 的成功输出，记录 `reused_from_attempt_id`，不得重新计为模型调用。CSC chunk 子表保留原文区间、状态、覆盖和成功输出。
- 提交运行、报告映射、工作单元及 outbox 在一个事务中完成。初始 outbox `eligible=false`；`start` 做完整预检后在事务中设置 `started_at` 并激活 outbox，首次发布在提交后进行。预检失败保持 pending、outbox 不可发布。
- outbox 消息仅携带 ID；重复发布允许，数据库 CAS 认领去重。租约 120s、heartbeat 15s；对在途请求持续续租，恢复前先查询 remote request ID。Celery task `acks_late=true`，`autoretry_for=()`，prefetch=1，不用 chord 成功回调判断整批状态。
- 每个工作单元独立 Session；网络调用前提交 attempt、释放事务，响应后新事务落盘。禁止线程共享 Session。
- 取消：停止新认领/新 chunk；已在途阶段结束后保存；完整产出者可 succeeded，其余 cancelled。只有取消实际留下未执行/未完成单元时终态 cancelled；所有单元已成功时再点取消仍 completed。保留已经成功结果。
- `RunStatus = pending/running/completed/partial/failed/cancelled`。无取消时：全部有效工作成功且没有无效行→completed；有成功且有失败/无效行→partial；无成功且有失败→failed。运行期间失败行不阻断后续行。
- `RunReportSummary(completeness: complete|partial|failed|cancelled|invalid, anomaly: normal|issue|needs_review|unknown)`：issue 优先于 needs_review；只有全部选定分支 succeeded/no_issue 才 normal；失败的无 finding 部分为 unknown；完整性独立计算。
- 计数分别返回 report_total/valid_rows/invalid_rows，units_total/pending/running/succeeded/failed/cancelled，以及 reports_issue/reports_needs_review/reports_incomplete；报告计数可重叠，UI 不求和伪造总数。

### API 决策（A7 固化为 OpenAPI，D1 生成 TS 类型）

RunDTO必须含id/status/revision/checks/config_snapshot/counts/created_at/started_at/finished_at/cancel_requested；ResultDTO含id/run_report_id/branch/generation/review_revision/source_field/source/outcome。JSON 字段 snake_case，UUID 字符串，时间 UTC ISO8601、页面本地化显示；JSON响应采用下面的统一封装。分页 `?page=1&page_size=20`，最大 100，返回 `{items,total,page,page_size}`。业务 API `/api/v1`：

| 方法/路径 | 请求与返回 |
| --- | --- |
| POST `/reports` / GET `/reports/{id}` | description、diagnosis、extra_fields；201 ApiSuccess[ReportDTO]；不存在HTTP 200 / resource_not_found |
| POST `/imports` | multipart file，202 ImportDTO(id,status,columns,preview_rows,errors)；安全随机存储名 |
| GET `/imports/{id}` | 解析状态；CSV UTF-8/BOM、XLSX，禁止宏执行/公式求值 |
| POST `/imports/{id}/confirm` | `{description_column,diagnosis_column?,checks?}`，201 `{report_ids,invalid_rows}`；checks默认四项，决定字段要求；保留原始行号/附加列 |
| POST `/runs` | `{report_ids?,import_id?,checks?,profiles?}`，两种来源互斥；201 RunDTO；无 checks 默认四项；包含导入无效行 |
| POST `/runs/{id}/start` | 幂等 202 RunDTO；预检失败HTTP 200 / preflight_failed，不发布 |
| GET `/runs`、`/runs/{id}`、`/runs/{id}/reports` | 分页、状态、真实计数、config snapshot、结果 ID/分支映射；支持 status/anomaly/completeness 筛选 |
| POST `/runs/{id}/cancel`、`/runs/{id}/retry-failed` | 202 RunDTO；retry request `{expected_revision:int,module_result_ids?:UUID[]}`；只允许failed目标，省略则全部failed；同revision同请求幂等返回，冲突/过期HTTP 200 / revision_conflict。RunDTO.revision与单元generation是不同字段 |
| GET `/results` | 按run_id、branch、status、review_state=pending或reviewed分页，服务端生成待复核队列；不是仅查询已有审核记录 |
| GET `/results/{id}`、`/results/{id}/evidence` | BranchOutcome DTO、attempt 摘要、全部候选+used_rank；原文与证据快照 |
| GET `/results/{id}/attempts/{attempt_id}/raw` | 本机默认操作者审计访问，分段文本，最大单次 1MiB；不含密钥/请求鉴权头 |
| POST `/reviews` | `{module_result_id,generation:int,type:accept|reject|edit|defer,text?,note?,expected_revision:int}`，201 ReviewDTO；revision冲突HTTP 200 / revision_conflict |
| GET `/reviews` | 按 run_id、module_result_id、type 分页；保存附加历史，不覆盖模型 |
| POST `/exports` / GET `/exports/{id}` / GET `/exports/{id}/download` | `{run_id}`→202 ArtifactDTO(status,filename,download_url?)；未完成下载HTTP 200 / artifact_not_ready |
| GET `/system/summary` | 数据库聚合真实run/report/review_pending计数；不从当前分页求总量；无质量评分 |
| GET `/system/status`、`/system/config` | 真实服务状态/脱敏配置；无凭据、无假健康评分 |
| POST `/system/preflight` | `{checks,profiles?}`→PreflightDTO(ready,branches,identities,capacity)；检查身份、配置、服务、索引 |

### 统一响应与异常维护约定（用户2026-10-15修订，覆盖旧HTTP错误码约定）

- 适用于业务API、GPU/CPU内部JSON接口以及自有鉴权/参数/路由/未知异常响应。应用可捕获的错误一律HTTP 200，不再向调用方返回旧404/409/422/500；用稳定业务code区分。成功保留GET 200/创建201/异步接收202，但全部JSON也使用相同外层结构。
- `ApiSuccess[T](status:Literal['success'],data:T,detail:None,request_id:UUID)`；`ApiErrorResponse(status:Literal['error'],data:None,detail:ErrorDetail,request_id:UUID)`；`ApiResponse[T]`为按status判别的联合类型，定义在轻量 `backend/contracts/responses.py`。表中的ReportDTO/RunDTO等都是data内的类型；分页对象也在data内。外层status仅success/error，任务pending/running/failed等状态在data.status，绝不将“查询到失败任务”误认为接口失败。
- 错误例：

```json
{
  "status": "error",
  "data": null,
  "detail": {
    "code": "upstream_timeout",
    "message": "诊断参考生成超时，已等待120秒；可通过请求编号查询在途推理状态",
    "stage": "diagnosis.generate",
    "retryable": true,
    "remote_state": "running",
    "exception_type": "ReadTimeout",
    "cause": "读取本机推理服务响应超时",
    "context": {"module_result_id": "示例工作单元ID", "attempt_no": 1}
  },
  "request_id": "00000000-0000-4000-8000-000000000001"
}
```

- `AppError(detail:ErrorDetail)`为可预期异常基类；按InputValidationError、ResourceNotFoundError、RevisionConflictError、PreflightError、UpstreamError、InfrastructureError、StageValidationError分类。已知基础设施异常在适配边界 `raise UpstreamError(detail) from exc` 等转换并保留cause；语义校验直接抛对应AppError。中间层只在补上下文/回滚/清理时捕获，禁止except-pass、打印后继续或返回空结果冒充成功。
- 业务错误code固定：input_validation_error、resource_not_found、method_not_allowed、revision_conflict、import_mapping_conflict、preflight_failed、artifact_not_ready、internal_auth_invalid、request_id_conflict、queue_full、upstream_timeout、response_invalid、internal_error；方法专属错误保留已定义code。code不是HTTP数字，不能因为HTTP=200而将retryable设为false；retryable由具体异常/远端执行状态决定。未知异常默认internal_error/retryable=false，保留脱敏类型与cause，stage缺失时用api.unhandled。
- FastAPI统一处理AppError、RequestValidationError、Starlette HTTPException（含路由不存在/方法不支持）和未预期Exception；返回HTTP 200的ApiErrorResponse。关闭debug。未知异常也提供脱敏后的异常类型、具体原因、阶段和request_id，不能只给“内部错误”；完整traceback连同cause链由负责结束操作的边界使用logger.exception/opt(exception=...)记录一次，统一redactor处理格式化异常输出，不直接把原始SQL/供应商响应/凭据/报告正文塞进detail。
- StageRunner捕获阶段异常→保存失败attempt/raw审计引用→按retryable和总计3次预算重试→耗尽后抛出；工作单元边界捕获并保存failed outcome，继续其他分支/报告。数据库暂不可用、失败状态也无法落盘时回滚并重新抛出，让任务恢复机制接手；不能确认已处理或吞掉异常。普通catch只捕获Exception，不拦截SystemExit/KeyboardInterrupt/asyncio.CancelledError；正常取消单独清理/传播并落cancelled，不能误判成功。
- GPU后台线程必须捕获每请求异常并保存RequestState.failed/ErrorDetail，不能让Future异常无人读取；CPU服务使用相同响应/异常处理器。内部客户端先检查外层status，error时抛typed AppError，不能当InferenceOutput/CandidateSet解析，也不能缓存为成功。第三方模型供应商仍按其真实HTTP状态（401/429/5xx）分类，保存脱敏upstream_status；本项目不改变供应商协议。
- 前端 `apiRequest<T>` 对合法success返回data，对HTTP 200/error抛 `ApiError(detail,request_id,http_status)`；组件展示detail.message、code、stage、cause、retryable及可复制request_id，context按需展开。fetch非2xx、代理错误、网络中断、非JSON或未知封装独立转TransportError/response_invalid，不能以200或空body放行。失败不触发成功toast/导航/完成状态，revision_conflict按code处理，不再检查HTTP 409。
- XLSX成功下载仍为二进制200，不套JSON；下载失败为JSON 200/error。下载客户端先检查Content-Type并解析错误，再保存文件，不能把JSON错误下载成xlsx。已开始发送的流、进程未能监听、反向代理响应等无法由应用重写，按传输故障明确报告。
- 监控必须读外层status及data.ready（就绪检查），记录业务错误code/stage/request_id，不能用HTTP 2xx成功率替代业务成功率。CLI失败仍返回非零退出码，Celery基础设施异常仍抛出；HTTP 200约定不能扩展成吞掉进程/任务错误。

首版 Settings 为只读配置/检测入口，模型路径和密钥通过后端环境/配置文件更新并重启相应服务；运行快照永不跟随配置改写。不增加无需求的在线配置编辑 API。

### 运行时和部署初值

- API `127.0.0.1:5100`；GPU `127.0.0.1:8101`；CPU 检索 `127.0.0.1:8102`；Vite 开发 `127.0.0.1:5174 --strictPort`。端口冲突时报告并改配置，不能杀旧进程腾端口。上线同源静态文件+API（可信反向代理），默认本机访问，免登录不等于开放公网。
- 独立 MySQL schema `medical_report_qc`，utf8mb4、时区 UTC；Celery broker db8、Celery result backend禁用、cache/locks db9 是候选值，部署前确认未被旧服务使用，独立 key prefix `medical_qc:`。不用 Docker。
- GPU 1 进程、无 reload，queue_max=32；request TTL 1h（只清终态）；HTTP `POST /internal/v1/{diagnosis/generate,csc/correct,cgec/correct}` 返回202 ApiSuccess[RequestState]，再 `GET /internal/v1/requests/{request_id}`。同 ID 同指纹复用，异指纹HTTP 200 / request_id_conflict；过期/重启未知为 unknown，不能冒充未执行。GPU wall deadline 初值 900s；不会强杀在途 CUDA 推理。
- CPU `POST /internal/v1/retrieve`→ApiSuccess[CandidateSet]；`POST /internal/v1/rerank`→ApiSuccess[完整带分数列表]；两服务 `/health/live` 和 `/health/ready`。内部 `Authorization: Bearer` 仅服务端读取，公网不暴露。
- 在线每次 timeout=120s，退避 1s/4s 加小抖动并尊重 Retry-After，第三方供应商连接失败/429/5xx可重试；供应商401/模型不存在/输入超限立即失败。结构错误最多总计三次，不自动换模型。Redis 在线并发许可续租，调用期间不因许可过期超出全局 2。
- 7B 初值 max_input_tokens=3072、max_new_tokens=512、temperature=0、BF16/chat template；超限失败。以此完成真实容量测试后才放开预检，不以此前 64 输出 token 测试代替生产验收。

### 模型与研究资产引用（不能复制进 Git）

| 角色 | 路径/要求 |
| --- | --- |
| diagnosis7B | `/mnt/mydrive/LLM/paper_models/qwen-7b-lora32-sft`；完整 9 分片、实际身份；不宣称已确认 GRPO 血统 |
| CSC CPT | `/mnt/mydrive/LLM/models/Qwen2.5-1.5B-medical-cpt` |
| CSC adapter | `/mnt/mydrive/LLM/models/Qwen2.5-1.5B-medical-csc-lora/checkpoint-600` |
| CGEC student | `/mnt/mydrive/LLM/models/Qwen2.5-1.5B`；Reference-only completion |
| CPU reranker | `/mnt/mydrive/LLM/models/bge-reranker-v2-m3` |
| embedding | 既有 Ollama `bge-m3:latest`，`num_gpu=0,num_thread=2`，记录真实 digest |
| 索引 | `/mnt/mydrive/LLM/rag-optimizer/storage/direct_cache_qcrag_shared_20260430/QcRAG_dev_gold_span` |
| 方法源码 | `/mnt/mydrive/LLM/{simple-csc,LLM4CGEC,rag-optimizer}`，以文件哈希 manifest 固定；新项目只提取必要无 gold 协议/包装器 |

## 验证层次和交接

1. 单元测试：纯逻辑、离线 fixtures；不加载模型，不调用在线 API。
2. 集成测试：专用真实 MySQL/Redis schema/namespace，不能用 SQLite 代替事务/锁验收；GPU/在线端口通过构造注入 fake。
3. 桌面端到端：Playwright 连接测试 API，注入确定性 fake 模型；production bundle 没有 demo/fake 路径。
4. 真实验收：三骨干实际常驻、CPU 索引和重排、各在线角色实际可用，用合成单条及小批量验证。未具备凭据/模型时明确“阻塞/未验证”，不标完成。
5. 记录容量、排队、峰值显存/RAM、真实调用身份和耗时；不输出虚构的质量分数，也不以此声称论文效果复现。

提交是实施子任务的收口步骤，执行前遵守当时用户的 Git 要求；本次计划不自动提交。实施前按 using-git-worktrees 检查隔离环境，未经批准不要在现有服务目录直接替换部署。

日志修订（2026-10-15）：用户指定Loguru通用规范，原文纳入docs；本项目配置入口统一logging_config.py，普通日志保留由14天改为30天，补充多进程隔离/trace context/异常去重及A1–D6验收。

修订记录（2026-10-15）：按用户要求统一自有API错误HTTP 200/status=error/detail，并在A1/A3/A7、B2/B3/B5、D1/D3/D4/D5/D6落实异常传播、封装解析与维护测试。

自审记录（2026-10-15）：三份 spec 的方法/架构/验收已映射到 A1–D6；五类风险均有归属测试；统一了 branch/status/attempt/generation/span/evidence 命名。桌面限定覆盖早期窄屏文字。当前尚未实施，也未运行计划中不存在的测试。
