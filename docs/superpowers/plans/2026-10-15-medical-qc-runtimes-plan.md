# Model and Retrieval Runtimes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为四项方法提供身份可核对、资源受控且可恢复的本机推理与检索能力。

**Architecture:** 一个 GPU 进程常驻诊断7B、CSC CPT＋adapter、CGEC Base 三个骨干并串行推理；一个 CPU 进程加载既有索引和 FP32 reranker。在线模型由 worker 访问，并使用 Redis 全局许可。业务与运行时只交换轻量 DTO。

**Tech Stack:** GPU Python3.10/Torch2.6.0+cu124/Transformers4.50.0/PEFT0.15.0/SDPA；CPU Python3.10、既有索引兼容的 LlamaIndex/FlagEmbedding；FastAPI、httpx、Redis；不安装 FlashAttention。

**Spec:** [总计划](2026-10-15-medical-qc-implementation.md)、[后端架构](../specs/2026-10-15-medical-qc-backend-architecture.md)、[实验契约](../specs/2026-10-15-medical-cgec-experiment-contract.md)。

## Global Constraints

- 日志遵循[通用项目日志规范](../../通用项目日志规范.md)及[本项目落地约定](../../日志落地约定.md)：Loguru、stdout INFO/文件DEBUG、当地午夜轮转/30天/ZIP、统一配置与脱敏追踪。
- 内部HTTP错误同样统一200/status=error/detail，成功为ApiSuccess[T]；用业务code分类重试，供应商HTTP状态按真实协议处理。
- 总计划共享 DTO 与默认参数全部适用；A1 是前置。
- GPU 全局并发1、单进程/no reload；CPU rerank FP32/batch4/threads4/concurrency1；Ollama embedding num_gpu=0/num_thread=2。
- 三个骨干是三个模型角色，不是已经取消的三专家模式。
- runtime 模块可被导入以导出 OpenAPI/测试，但只在 lifespan 的显式 load 中导入重依赖、加载模型。
- 不改旧研究项目、不自动下载替代权重、不重建既有索引、不把配置正确等同于服务真实可用。

## Review Focus

1. 客户端超时后请求仍在 GPU 运行，同 ID 不重复排队（B2）。
2. 三个模型争用同 GPU/adapter 切换时不产生并发和第二份 CPT（B1/B4）。
3. 在线许可过期或多worker重试，不突破并发2、不泄露token（B3）。
4. 索引缺失/embedding身份变化/坏重排分数，明确不可用且不退回未重排顺序（B5）。
5. 20候选过滤后少于5/10或为0，保留完整过滤记录且无虚构来源（B6）。

---

## 文件责任

- `backend/contracts/`：复用 A1，不重新定义 DTO。
- `backend/configs/{runtime,retrieval,profiles}.yaml`、`backend/research_adapters/manifest.json`：模型配置、方法版本、资产哈希；manifest不包含权重。
- `backend/model_runtime/{main,registry,scheduler,request_store,diagnosis,csc,cgec}.py`：模型角色、串行队列、请求状态；三角色解码由B4实现。
- `backend/research_adapters/{simple_csc,rag_optimizer,llm4cgec}.py`：严格无gold单条包装器，重依赖延迟导入。
- `backend/retrieval_runtime/{main,index,embedding,reranker,filtering}.py`：索引恢复、CPU embedding/rerank与过滤。
- `backend/app/ports/{inference,retrieval,online}.py`、`app/clients/{inference,retrieval,online,rate_limit}.py`：调用边界及实现。
- `backend/requirements/{gpu,cpu-retrieval}.lock.txt`、`backend/ops/scripts/{inventory_assets,probe_capacity}.py`：可复建环境与实测。

### B1：资产指纹、独立环境与三骨干 registry

**Files:** Create `backend/configs/runtime.yaml`、`profiles.yaml`、`backend/research_adapters/manifest.json`、`backend/model_runtime/registry.py`、`backend/requirements/gpu.lock.txt`、`backend/ops/scripts/inventory_assets.py`；Test `backend/tests/unit/test_registry.py`、`test_asset_manifest.py`。

**Interfaces:** Consumes A1 ModelIdentity；Produces `inventory_assets(paths:dict[str,Path])->dict`、`ModelRegistry.load(config:RuntimeConfig)->None`、`ModelRegistry.get(role:str)->ModelHandle`、`ModelRegistry.identities()->list[ModelIdentity]`、`ModelRegistry.ready()->bool`。`RuntimeConfig` 从runtime.yaml加载，三角色路径照总计划；ModelHandle 包含model/tokenizer/identity，CSC额外corrector，API不传此对象。

- [ ] **Step 1 — 写失败测试。** 用 tmp_path 创建两分片+tokenizer配置，断言分片缺失、adapter base不符、manifest源文件变化均不可ready。注入 loader 记录调用，加载顺序 diagnosis→csc→cgec，恰好3骨干；CSC corrector.prompted_model is corrector.lm_model，不能再独立load CPT。未知role明确错误，不回退另一个模型。import registry不导入torch。
核心断言（`test_registry_uses_one_cpt_backbone`，变量由上一步的安排/fixture取得）：

```python
assert loaded_backbone_count == 3
assert corrector.prompted_model is corrector.lm_model
assert registry.ready() is True  # complete matching assets case
```

- [ ] **Step 2 — Red。** `cd backend && python -m pytest tests/unit/test_registry.py tests/unit/test_asset_manifest.py -q`；预期 registry 未实现失败。
- [ ] **Step 3 — 实现接口与环境清单。** 新 GPU conda 环境命名 `medical_qc_gpu`，不修改已验证的 `lwy_medical_csc`。以Torch2.6.0+cu124/Transformers4.50.0/PEFT0.15.0为固定基线，补齐 simple-csc 的实际依赖并锁定；引用路径和研究hash都在显式配置，不用glob随便选checkpoint。CPU retrieval另建 `medical_qc_retrieval`，兼容性在B5测试后锁定。inventory只读资产，记录权重索引/配置/tokenizer/adapter文件SHA256与源代码hash，不复制几十GB权重。registry真实加载失败则ready=false并列出角色错误，不保留“半成功全部ready”。
- [ ] **Step 4 — Green。** 重跑Step2，PASS；`python ops/scripts/inventory_assets.py --config configs/runtime.yaml --check` 只读检查实际文件并输出manifest差异，不启动模型；尚未加载的角色标not_loaded。
- [ ] **Step 5 — 提交。** `git add backend/configs/runtime.yaml backend/configs/profiles.yaml backend/research_adapters/manifest.json backend/model_runtime/registry.py backend/requirements/gpu.lock.txt backend/ops/scripts/inventory_assets.py backend/tests/unit/test_registry.py backend/tests/unit/test_asset_manifest.py`；`git commit -m "feat: pin model assets and isolated gpu registry"`。

### B2：串行调度、幂等请求与推理客户端

**Files:** Create `backend/model_runtime/main.py`、`scheduler.py`、`request_store.py`、`backend/app/ports/inference.py`、`backend/app/clients/inference.py`；Test `backend/tests/unit/test_gpu_scheduler.py`、`backend/tests/integration/test_inference_http.py`。

**Interfaces:** Produces `InferencePort.submit(request:InferenceRequest)->RequestState`、`InferencePort.get(request_id:UUID)->RequestState`、`InferenceClient.wait(request:InferenceRequest,on_heartbeat:Callable[[],None])->InferenceOutput`。`SerialScheduler.submit(request:InferenceRequest)->RequestState`、`SerialScheduler.get(request_id:UUID)->RequestState`；role handlers `infer(request:InferenceRequest)->InferenceOutput`。wait超过等待期限时返回 typed ErrorDetail并保留remote状态/requestID；不生成新ID。

- [ ] **Step 1 — 写失败测试。** 三个role各提交2条，用线程Event卡住handler，assert max_active==1；相同ID同source/config/params提交两次只调用一次，异内容返回HTTP 200/error/request_id_conflict。clientHTTP超时后GET可得到同请求running→succeeded且一次生成；队列32满后返回HTTP 200/error/detail.code=queue_full，不无限存储。排队过deadline未执行；运行到deadline不kill CUDA，记录running_late后保存最终结果。request_store模拟进程重启：原running→unknown，terminal可查；TTL只清终态，不清在途。内部缺token返回HTTP 200/error/internal_auth_invalid且不可重试；GPU handler抛异常后RequestState持久failed/detail；并发请求/线程日志的request_id与inference_request_id不串、重试不重复堆栈；调度线程继续下一请求，不允许后台Future异常无人收集；内部client收到200/error必须抛typed异常且不缓存成功；查询外层success/data.status=failed时get返回RequestState，wait读取data.error后抛AppError，不能返回空InferenceOutput。所有客户端参数必须allowlist验证，不能任意覆盖模型路径。
核心断言（`test_http_timeout_does_not_resubmit_inference`，变量由上一步的安排/fixture取得）：

```python
assert max_active_handlers == 1
assert handler_calls_for_request_id == 1
assert recovered_request.status == "succeeded"
assert conflicting_submit.status_code == 200
assert conflicting_submit.json()["status"] == "error"
assert conflicting_submit.json()["detail"]["code"] == "request_id_conflict"
```

- [ ] **Step 2 — Red。** `cd backend && python -m pytest tests/unit/test_gpu_scheduler.py tests/integration/test_inference_http.py -q`；预期 scheduler/HTTP 缺失失败。
- [ ] **Step 3 — 实现接口。** 单独执行线程串行消费队列，FastAPI事件循环只接受/查询。request_store 原子写本地0600权限元数据及短期结果，input/config/params/role联合SHA256；相同ID冲突明确拒绝，不能只比较source。TTL1h、queue_max32，未知ID和重启不确定性有明确状态。OOM记录capacity_exceeded并将capacity ready置false，释放本次KV/临时tensor而不卸载常驻骨干；不得无限retry掩盖显存不足。业务attempt持久requestID，wait只轮询并heartbeat，httpx transport retries=0；B2不消费A3三次预算。202提交与GET路由照总计划，POST不等生成完；健康live与ready分离。启动前调用共用logging_config；API/调度线程用contextualize显式传递和清理X-Request-ID，payload.request_id另外记inference_request_id，防止多请求串号；绑定127.0.0.1并内部token校验；复用A1响应/异常模块，客户端剥离data并检查status，不能只调用raise_for_status。
- [ ] **Step 4 — Green。** 重跑Step2，PASS；通过ASGI fake handler验证并发、断开客户端和重新查询，不需要GPU；确认工厂没有 uvicorn reload/workers>1 配置。
- [ ] **Step 5 — 提交。** `git add backend/model_runtime/main.py backend/model_runtime/scheduler.py backend/model_runtime/request_store.py backend/app/ports/inference.py backend/app/clients/inference.py backend/tests/unit/test_gpu_scheduler.py backend/tests/integration/test_inference_http.py`；`git commit -m "feat: serialize gpu inference with traceable idempotent requests"`。

### B3：在线模型协议、全局并发许可与错误分类

**Files:** Create `backend/app/ports/online.py`、`backend/app/clients/online.py`、`rate_limit.py`；Modify `backend/.env.example`、`backend/configs/profiles.yaml`；Test `backend/tests/unit/test_online_payloads.py`、`backend/tests/integration/test_online_limits.py`。

**Interfaces:** `OnlinePort.invoke(role:str,messages:list[dict],request_id:UUID,config:OnlineRoleConfig)->OnlineResponse`；OnlineResponse(raw_text,response_id,provider,model,api_mode,usage,elapsed_ms,finish_reason)。`OnlineRoleConfig` 定义provider/model/base_url/api_mode/reasoning_effort/output_limit/timeout，密钥只由客户端读取环境。`GlobalPermit.acquire(key:str,limit:int,lease_s:int)->Permit`，Permit支持heartbeat/release。Produces `OnlineClient` 实现；语义JSON校验由C负责，重试由A3 StageRunner负责。

- [ ] **Step 1 — 写失败测试。** httpx.MockTransport记录payload：教师 `Responses + reasoning_effort=low`，无temperature；普通chat角色按显式配置发送，不能统一硬套参数。第三方供应商401/modelnotfound不可retry，429/5xx可retry且解析Retry-After，SDK只调用一次。两个client实例并发6次，真实测试Redis下max_active<=2；调用时间超过lease仍续租，进程崩溃后许可可回收。捕获httpx异常后raise UpstreamError(detail) from exc，验证__cause__保留、detail可读且retryable不因本地HTTP200丢失；错误、请求日志、system配置不含测试secret；缺model配置不换默认模型。
核心断言（`test_responses_teacher_and_global_limit`，变量由上一步的安排/fixture取得）：

```python
assert teacher_payload["reasoning"]["effort"] == "low"
assert "temperature" not in teacher_payload
assert max_active_across_clients <= 2
assert unauthorized_error.retryable is False
```

- [ ] **Step 2 — Red。** `cd backend && python -m pytest tests/unit/test_online_payloads.py tests/integration/test_online_limits.py -q`；预期 online client未实现失败。
- [ ] **Step 3 — 实现接口。** Redis ZSET/Lua原子许可，独立owner token，租约150s/heartbeat15s、超时120s，释放只释放自己的许可；等待许可不消耗模型attempt。全局limit2同时适用于diagnosis judge、CGEC teacher和RAG两轮，供应商更低限制可叠加。原始响应进入受控attempt存储，HTTP异常转typed异常并raise from保留原因，detail含provider/model/stage/脱敏upstream_status与原因；日志映射http_status/error_code/error_type/error_message，外部消息最多1000字符并移除换行/控制字符，重试WARNING、最终责任边界ERROR及完整异常链；不在client内吞异常或返回空OnlineResponse。角色初始值：teacher按已认可实验身份GPT-5.6-sol/Responses/low，实际账号不可用则预检阻塞；诊断与定位按显式DeepSeek配置核验，不猜供应商模型ID。不在开发自动发送患者数据。
- [ ] **Step 4 — Green。** 重跑Step2全部PASS；此处只mock HTTP，不进行收费调用。检查请求单次、不在client内循环retry。
- [ ] **Step 5 — 提交。** `git add backend/app/ports/online.py backend/app/clients/online.py backend/app/clients/rate_limit.py backend/.env.example backend/configs/profiles.yaml backend/tests/unit/test_online_payloads.py backend/tests/integration/test_online_limits.py`；`git commit -m "feat: add role-specific online clients with global concurrency limits"`。

### B4：三个模型的实际解码适配器

**Files:** Create `backend/model_runtime/diagnosis.py`、`csc.py`、`cgec.py`、`backend/research_adapters/simple_csc.py`、`llm4cgec.py`、`backend/ops/scripts/probe_capacity.py`；Modify registry role binding；Test `backend/tests/unit/test_runtime_decoding.py`、`test_student_completion.py`；Create `backend/tests/smoke/test_gpu_roles.py`。

**Interfaces:** 每角色 `infer(request:InferenceRequest)->InferenceOutput`；pure helpers `make_reference_prompt(source:str,reference_correction:str)->str`、`student_budget(source_tokens:int)->int`、`clean_student_completion(raw:str)->str`、`validate_student_stop(stop_reason:str,raw:str,has_boundary:bool)->None`、`run_c2ec(corrector:object,source:str)->str`。所有helpers放research_adapters，API不得导入torch。

- [ ] **Step 1 — 写失败测试。** fake tokenizer/model/corrector记录参数：diagnosis应用chat template、max_input3072/max_new512/temp0且超长不截断；CSC调用LMCorrector而非generate、source长度128完整覆盖且无未检尾部。CGEC固定提示逐字等于C4给定文本，不走chat template；left pad、eos fallback、greedy/use_cache/batch1、input<=2048，预算 `min(768,n+64)`；n=100→164，n=1000→768。EOS只包含有效token ID；completion保留raw，取第一物理行并清已知前缀/围栏和后续示例；空输出不返回source；达到上限或无EOS/有效示例边界→student_output_incomplete。retry attempt2/3用min_new_tokens=max(8,n//2)，超过budget直接失败。
核心断言（`test_student_budget_and_input_are_not_truncated`，变量由上一步的安排/fixture取得）：

```python
assert student_budget(100) == 164
assert student_budget(1000) == 768
assert generate_calls_for_over_2048_input == 0
assert incomplete_output.error.code == "student_output_incomplete"
```

- [ ] **Step 2 — Red。** `cd backend && python -m pytest tests/unit/test_runtime_decoding.py tests/unit/test_student_completion.py -q`；预期适配器缺失失败。
- [ ] **Step 3 — 实现解码。** CSC严格配置：`LMCorrector(model=CPT,prompted_adapter=checkpoint600,config_path='/mnt/mydrive/LLM/simple-csc/configs/c2ec_config.yaml',n_beam=2,n_observed_chars=8,alpha=2.5,temperature=1.5,use_faithfulness_reward=True,max_length=128,torch_dtype=bfloat16,device_map={'':'cuda:0'},trust_remote_code=False)`；不改变C2EC分支/KV方法，同一CPT上adapter切换仅在串行队列内。CGEC Base BF16/SDPA，与CSC不同骨干；raw生成stop/token数记录，parameters中的attempt_no控制空输出后重试下限。诊断7B prompt提取由C2版本文件提供，未配置prompt failfast。probe_capacity对三个已加载角色顺序运行合成输入，记录空闲/加载/峰值显存、RAM和输出停止原因，不自动提高上限。真实测试必须同时常驻三骨干，不分别加载测试后声称足够。
- [ ] **Step 4 — Green。** 重跑Step2 PASS；真实GPU步骤另用 `MEDICAL_QC_REAL_SMOKE=1 .../envs/medical_qc_gpu/bin/python -m pytest tests/smoke/test_gpu_roles.py -q`（工作目录backend），只在D6受控执行。probe必须覆盖7B生产输出512预算、CSC128边界及CGEC2048输入预算，不能以旧64输出的容量记录替代；不符合则预检capacity=false并提出调整，不擅自量化/卸载骨干。
- [ ] **Step 5 — 提交。** `git add backend/model_runtime backend/research_adapters/simple_csc.py backend/research_adapters/llm4cgec.py backend/ops/scripts/probe_capacity.py backend/tests/unit/test_runtime_decoding.py backend/tests/unit/test_student_completion.py backend/tests/smoke/test_gpu_roles.py`；`git commit -m "feat: implement method-faithful diagnosis c2ec and cgec decoding"`。

### B5：既有索引恢复、CPU embedding 与严格重排

**Files:** Create `backend/configs/retrieval.yaml`、`backend/retrieval_runtime/main.py`、`index.py`、`source_reports.py`、`embedding.py`、`reranker.py`、`backend/research_adapters/rag_optimizer.py`、`backend/app/ports/retrieval.py`、`backend/app/clients/retrieval.py`、`backend/requirements/cpu-retrieval.lock.txt`；Test `backend/tests/unit/test_retrieval_runtime.py`、`backend/tests/integration/test_retrieval_http.py`；Create `backend/tests/smoke/test_real_retrieval.py`。

**Interfaces:** `RetrievalPort.retrieve(request:RetrievalRequest)->CandidateSet`；`HybridIndex.restore(path:Path,embedding_identity:str)->None`、`HybridIndex.retrieve(source:str,limit:int=20)->list[Candidate]`；`SourceReportResolver.resolve(node_id:str,metadata:dict,retrieved_text:str)->SourceReport|None`，SourceReport含text/doc_id/corpus/file/record/content_hash；`CpuReranker.score(source:str,candidates:list[Candidate])->list[Candidate]`。`RerankRequest(source:str,candidates:list[Candidate],config_fingerprint:str)` 为内部/rerank DTO；每候选稳定candidate_id映射，不信任外部重排索引。

- [ ] **Step 1 — 写失败测试。** fake持久索引恢复计数：restore不调用embed/rebuild；缺文件、空索引、embedding维度/digest不匹配均notready。确认混合向量+关键词20召回、不调用query synthesis/graph/summary。mock reranker对20候选全评分后稳定降序，同分用recall_rank再candidate_id。缺项、重复ID、越界index、NaN/inf、数量不符都报rerank_invalid，绝不回退recall顺序。CPU handler/embedding/reranker异常均转200/error/detail，检索client先检查封装再解析候选；failed响应不能进共享候选缓存。CPU模型use_fp16=False/devicecpu、batch4/threads4，embedding Ollama num_gpu0；内容完整与nullable metadata保留；全文映射测试包含合法docID、缺失docID、错误hash和越界路径，只有可验证映射填full_report_text。
核心断言（`test_bad_reranking_never_falls_back`，变量由上一步的安排/fixture取得）：

```python
assert error.code == "rerank_invalid"
assert reranker_use_fp16 is False
assert embedding_options["num_gpu"] == 0
assert restored_index_reembedding_calls == 0
```

- [ ] **Step 2 — Red。** `cd backend && python -m pytest tests/unit/test_retrieval_runtime.py tests/integration/test_retrieval_http.py -q`；预期检索模块缺失失败。
- [ ] **Step 3 — 实现恢复与HTTP。** 参考旧TeacherRAG使用 `load_and_index_data(documents=[],use_persist=False,cache_dir=...)` 的恢复方式，先验证cache包含实际node/vector，再恢复；该历史API名字不能作为“成功恢复”证据。建立只读适配层，no automatic empty rebuild。记录index文件manifest与Ollama实际digest。FlagEmbedding FP32 `compute_score(...,normalize=True)` 全候选、并发1，CPU线程4；embedding初值线程2，不与GPU共享。metadata doc_id/source_doc_id优先保留；恢复时检查node是否整份报告；如果是切片，通过既有metadata的doc_id/source_doc_id及配置的原始语料映射读取原报告，验证记录ID/hash/切片确实属于该原文，保存full_report_text和来源记录。SourceReportResolver只读配置allowlist语料文件，禁止任意metadata路径穿越；映射不存在则full_report_text=null、scope=indexed_chunk，不拿模型扩写。检索/重排/过滤仍用当时node.text，不能扩大上下文改变方法。CPU应用复用A1的Loguru logging_config、异常handler与响应模块，模型/embedding/索引加载逐步记录开始/完成/失败/耗时，不打印文本/向量/完整候选；查询失败带可维护detail且后台错误日志保留脱敏堆栈。CPU依赖兼容现有索引/研究加载器后锁定，不修改原研究env。
- [ ] **Step 4 — Green。** 重跑Step2 PASS。真实只读索引 smoke 在D6用合成source执行，断言nodes/vectors非0、embedding真实digest、结果来自既有nodeID；记录CPU/RAM，不把完整索引载入API或每次请求重建。
- [ ] **Step 5 — 提交。** `git add backend/configs/retrieval.yaml backend/retrieval_runtime backend/research_adapters/rag_optimizer.py backend/app/ports/retrieval.py backend/app/clients/retrieval.py backend/requirements/cpu-retrieval.lock.txt backend/tests/unit/test_retrieval_runtime.py backend/tests/integration/test_retrieval_http.py backend/tests/smoke/test_real_retrieval.py`；`git commit -m "feat: restore existing index and rerank candidates on cpu"`。

### B6：实验过滤、候选共享与证据选择

**Files:** Create `backend/retrieval_runtime/filtering.py`、`backend/app/services/retrieval_service.py`；Modify `backend/app/services/evidence_service.py`；Test `backend/tests/unit/test_evidence_selection.py`、`backend/tests/integration/test_shared_candidates.py`。

**Interfaces:** `duplicate_filter_reason(source:str,candidate:str)->tuple[str|None,float]`；`filter_candidates(source:str,candidates:list[Candidate])->list[Candidate]`；`select_evidence(candidate_set:CandidateSet,branch:Branch,top_k:int)->list[EvidenceSnapshot]`；`RetrievalService.candidates(report:ReportInput,context:StageContext)->CandidateSet`；`RetrievalService.evidence(report,context,branch,top_k)->list[EvidenceSnapshot]`。共享缓存key含run_report_id/sourceSHA/index/embedding/recall/rerank/filter指纹，不含top_k；缓存未命中由MySQL attempt成功记录补建，Redis非唯一事实。

- [ ] **Step 1 — 写失败测试。** 测例精确匹配（只去空白）、source包含candidate、反向包含、near_duplicate的阈值0.95，保留标点/大小写差异且SequenceMatcher默认autojunk。比较实现结果与 `SequenceMatcher(None,re.sub(r'\s+','',s),re.sub(r'\s+','',t)).ratio()` 精确相等。过滤在全20重排之后，保存被过滤项。CGEC先取5后RAG仍能取10；只有3条有效时都只用3；0条→no_valid_evidence且不调用模型。并发CGEC/RAG共享候选，配置/索引变更必须miss；重启Redis不丢已保存证据。
核心断言（`test_shared_candidates_keep_independent_top_k`，变量由上一步的安排/fixture取得）：

```python
assert len(all_candidates) == 20
assert len(cgec_evidence) == 5
assert len(rag_evidence) == 10
assert no_evidence_error.code == "no_valid_evidence"
```

- [ ] **Step 2 — Red。** `cd backend && python -m pytest tests/unit/test_evidence_selection.py tests/integration/test_shared_candidates.py -q`；预期过滤/共享服务缺失失败。
- [ ] **Step 3 — 实现过滤与快照。** 顺序：仅 `re.sub(r'\s+','',text)`→exact_source_match→双向包含source_containment→SequenceMatcher默认autojunk且>=0.95为near_duplicate_source。所有20项都持久化recall/rerank/similarity/filter元数据，selected标记独立于candidate资格；Top5/10只从有效降序队列取。RAG同过滤属于显式工程版本，不声称严格历史数值复现。跨分支候选同指纹用数据库唯一cache key/租约singleflight；失败时记录，不把空集缓存成成功。若索引只存chunk且无法恢复全文，保存/返回实际chunk及nullable全文并显示scope，发布验收中明确全文溯源缺口，不虚构“完整报告”；D6要求可用报告级原文映射后才通过用户的全文验收。
- [ ] **Step 4 — Green。** 重跑Step2 PASS；核对保存的所有候选数==真实recall数，used_rank连续1..实际数，不补齐10，不抹掉其他分支证据标记。
- [ ] **Step 5 — 提交。** `git add backend/retrieval_runtime/filtering.py backend/app/services/retrieval_service.py backend/app/services/evidence_service.py backend/tests/unit/test_evidence_selection.py backend/tests/integration/test_shared_candidates.py`；`git commit -m "feat: preserve filtered candidate provenance and branch evidence snapshots"`。
