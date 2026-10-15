# Four QC Pipelines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按已核实的研究逻辑实现四条无 gold、输入独立、失败可审计的生产 pipeline。

**Architecture:** pipeline 只组织方法，通过 ports 和 StageRunner 调用外部模型，不依赖FastAPI/Celery/SQLAlchemy。共享原文坐标、候选检索和阶段复用；判定、提示和证据使用仍分支独立。

**Tech Stack:** Python、轻量 contracts、difflib、pytest；A 的阶段执行器和 B 的模型/检索端口。

**Spec:** [总计划](2026-10-15-medical-qc-implementation.md)、[系统设计](../specs/2026-10-15-medical-report-qc-rebuild-design.md)、[CGEC实验契约](../specs/2026-10-15-medical-cgec-experiment-contract.md)。

## Global Constraints

- 日志遵循[通用项目日志规范](../../通用项目日志规范.md)及[本项目落地约定](../../日志落地约定.md)：Loguru、stdout INFO/文件DEBUG、当地午夜轮转/30天/ZIP、统一配置与脱敏追踪。
- 输入为同一份冻结 ReportInput；不读取gold/answer/target，不运行研究脚本main，不把前一分支建议作为下一分支原文。
- pipeline内部抛typed AppError并保留异常链，不返回HTTP对象；StageRunner捕获/持久化/重试，execute_unit转failed并继续。HTTP边界才转200/status=error/detail。
- 三次为每阶段总尝试上限；校验失败交给A3 StageRunner，不在pipeline另加循环。
- `diagnosis_thesis`、`csc_punctuation_128_v1`、`cgec_rag_reference_1_5b`、`rag_localization_two_stage_v1` 为默认profiles。
- CSC ≤128 code points 源文分块；CGEC整份描述不做128字分块、完整提示≤2048 tokens、不静默截断。
- 定位分支二阶段只在第一阶段有效无错时执行；CGEC默认不做教师二阶段。
- 提示/source/config/模型/索引身份全部留hash与快照；模型差异本身不等于临床错误。

## Review Focus

1. 非BMP汉字/重复片段/换行映射不能凭首次匹配错标原文（C1/C4/C5）。
2. CSC长文后半段、标点边界插入和部分chunk失败不能被当全文成功（C3）。
3. 诊断生成结果不同不自动判错；无gold字段也可完整执行（C2）。
4. 教师字符串false/矛盾JSON、学生空或截断、师生不同意见必须显式失败或复核（C4）。
5. 定位第一轮坏JSON不能触发第二轮，第二轮失败不能覆盖为无异常（C5）。

---

## 文件责任

- `backend/app/domain/{spans,edits,clinical_facts}.py`：原文code point坐标、模型视图、差异和临床事实风险。
- `backend/app/pipelines/{diagnosis,csc,cgec,localization}.py`：方法编排和结构/语义校验。
- `backend/app/ports/chunks.py`、`backend/app/db/repositories/chunks.py`：CSC块执行持久接口和实现，pipeline不依赖ORM。
- `backend/research_adapters/{diagnosis,llm4cgec}.py`、`backend/prompts/`：提取无gold提示/清理协议，源hash固定。
- `backend/app/services/pipeline_executor.py`、`backend/configs/profiles.yaml`：BranchExecutor生产装配，不使用旧三专家配置。
- `backend/tests/helpers/{ports,stages}.py`：只在测试目录的确定性端口和记录执行器；不进production依赖树。

### C1：原文区间、编辑与单行模型视图

**Files:** Create `backend/app/domain/spans.py`、`edits.py`、`clinical_facts.py`、`backend/tests/helpers/ports.py`、`stages.py`；Test `backend/tests/unit/test_spans_edits.py`、`test_model_view.py`、`test_clinical_facts.py`。

**Interfaces:** `validate_span(source:str,span:SourceSpan)->None`；`resolve_fragment(source:str,fragment:str)->SpanResolution`；`diff_edits(source:str,suggestion:str)->list[SourceEdit]`；`to_single_line(source:str)->ModelView`；`map_model_edits(view:ModelView,edits:list[SourceEdit])->MappedEdits`；`detect_fact_changes(source:str,suggestion:str)->list[FactChange]`。
`SpanResolution(spans,candidate_spans,ambiguous)`；`SourceEdit(start:int,end:int,before:str,after:str)`；`ModelView(original:str,text:str,offset_map:list[tuple[int,int]])` 每个模型字符指向原文区间，换行折叠空格映射整段换行；`MappedEdits(edits:list[SourceEdit],ambiguous:bool,whitespace_only:bool)`；`FactChange(kind:str,before:str,after:str)`。

- [ ] **Step 1 — 写失败测试。** `resolve_fragment('𠮷灶。𠮷灶。','𠮷灶')`→ambiguous且candidate starts `[0,3]`，不能偷偷返回首个。切片不匹配/越界失败，零宽插入可用。`to_single_line('甲\r\n乙\n\n丙')`→`'甲 乙 丙'` 且原文不变；CRLF与连续换行各折叠为一个空格、map可回溯全部原字符；只有空白变化不报语法错误，无法唯一映射的编辑标ambiguous。diff含插入/删除/替换、emoji组合序列，但契约是code point而非JS UTF16。临床左右侧/数字单位/否定词/部位变化触发FactChange；普通标点不触发，算法不得声称验证事实等价。
核心断言（`test_duplicate_fragment_returns_candidate_positions`，变量由上一步的安排/fixture取得）：

```python
assert resolution.ambiguous is True
assert resolution.spans == []
assert [span.start for span in resolution.candidate_spans] == [0, 3]
assert model_view.text == "甲 乙 丙"
```

- [ ] **Step 2 — Red。** `cd backend && python -m pytest tests/unit/test_spans_edits.py tests/unit/test_model_view.py tests/unit/test_clinical_facts.py -q`；预期模块缺失失败。
- [ ] **Step 3 — 实现接口。** 字符列表与原文切片校验；差异用 `SequenceMatcher(None,source,suggestion,autojunk=False)` 的opcodes，禁止全局replace/首次indexof。该diff算法不改变B6过滤所需默认autojunk。模型视图仅规范换行序列，不删除原文字段。建立测试 `ScriptedInference(outputs:list[InferenceOutput|Exception])`、`ScriptedOnline(outputs:list[OnlineResponse|Exception])`，二者公开 `.calls:list`；`RecordingStageRunner` 实现A3同签名、记录stage/requestID并按相同输入复用，可配置次数，fixture不进行HTTP。生产端口不导入这些helpers。
- [ ] **Step 4 — Green。** 重跑Step2，PASS；每条diff都验证before==original[start:end]。
- [ ] **Step 5 — 提交。** `git add backend/app/domain/spans.py backend/app/domain/edits.py backend/app/domain/clinical_facts.py backend/tests/helpers backend/tests/unit/test_spans_edits.py backend/tests/unit/test_model_view.py backend/tests/unit/test_clinical_facts.py`；`git commit -m "feat: preserve unicode source spans and model-view mappings"`。

### C2：第三章诊断生成与三方比较

**Files:** Create `backend/app/pipelines/diagnosis.py`、`backend/research_adapters/diagnosis.py`、`backend/prompts/diagnosis_generation_v1.txt`、`diagnosis_qc_localize_v2.txt`；Modify `backend/research_adapters/manifest.json`、`backend/configs/profiles.yaml`；Test `backend/tests/unit/test_diagnosis_pipeline.py`。

**Interfaces:** `DiagnosisPipeline(inference:InferencePort,online:OnlinePort,stages:StageRunner)`；`run(report:ReportInput,context:StageContext)->BranchOutcome`；`parse_diagnosis_answer(raw:str,diagnosis:str)->DiagnosisJudgement`，Judgement含 finding/spans/candidate_spans/answer/reason可空。

- [ ] **Step 1 — 写失败测试。** ReportInput只有原描述/原诊断和ID、没有ground_truth/answer/has_error；fake7B返回参考，assert judge实际输入同时含原描述+医生诊断+参考。参考与诊断不同但judge答“未发现错误”→succeeded/no_issue，不能自动差异判错。有效片段必须来自医生诊断坐标；重复片段→needs_review和候选位置；片段不在原诊断、解释性长文本/空输出→结构错误有限重试。generate成功、judge失败后重试只调用judge，prompt/model变化导致SHA256缓存miss。
核心断言（`test_reference_difference_is_not_itself_an_error`，变量由上一步的安排/fixture取得）：

```python
assert outcome.status == "succeeded"
assert outcome.finding == "no_issue"
assert original_description in judge_prompt
assert original_diagnosis in judge_prompt
assert reference_diagnosis in judge_prompt
```

- [ ] **Step 2 — Red。** `cd backend && python -m pytest tests/unit/test_diagnosis_pipeline.py -q`；预期pipeline缺失失败。
- [ ] **Step 3 — 提取与实现。** 源 `/mnt/mydrive/LLM/rag-optimizer/prompts/diagnosis_generation_v1.txt` 和 `diagnosis_qc_localize_v2.txt` 按原文提取、hash记录。后者是裸“错误片段/未发现错误”协议，不假定JSON/解释；首版保持协议，reason=null，UI显示“本协议未提供解释”。若未来改JSON必须新profile，不能偷偷改原协议。仅复用 `src/diagnosis_qc/{model,localizer}.py` 的纯规则，禁止直接用带gold/MD5缓存的 `DiagnosisQCPipeline.run_sample`。generation引用7B身份；judge独立在线角色、temperature等按profile快照。错误位置锚定diagnosis，其他三项锚定description，在details显式 `source_field`。
- [ ] **Step 4 — Green。** 重跑Step2 PASS；静态检查production代码不访问ground_truth_diagnosis/answer字段作为业务输入（parse输出answer命名允许），不import离线main。
- [ ] **Step 5 — 提交。** `git add backend/app/pipelines/diagnosis.py backend/research_adapters/diagnosis.py backend/prompts/diagnosis_generation_v1.txt backend/prompts/diagnosis_qc_localize_v2.txt backend/research_adapters/manifest.json backend/configs/profiles.yaml backend/tests/unit/test_diagnosis_pipeline.py`；`git commit -m "feat: implement original-reference diagnosis consistency pipeline"`。

### C3：源文128字CSC分块、覆盖和成功块复用

**Files:** Create `backend/app/pipelines/csc.py`、`backend/app/domain/chunks.py`、`backend/app/ports/chunks.py`、`backend/app/db/repositories/chunks.py`；Test `backend/tests/unit/test_csc_chunks.py`、`backend/tests/integration/test_csc_resume.py`。

**Interfaces:** `split_source(source:str,max_length:int=128)->list[SourceChunk]`；SourceChunk(key:str,start:int,end:int,text:str)。`CscChunkStore.load(module_result_id:UUID,config_hash:str)->list[ChunkResult]`、`.save(module_result_id:UUID,result:ChunkResult)->None`，ChunkResult含chunk/status/output/edits/attempt_id；实现使用独立短事务。`CscPipeline(inference:InferencePort,stages:StageRunner,chunks:CscChunkStore)`，标准run签名。

- [ ] **Step 1 — 写失败测试。** 0/1/127/128/129/694字及非BMP输入，assert `''.join(c.text for c in chunks)==source`、每块<=128、所有原坐标恰好覆盖一次；空source作为输入错误不运行。标点优先 `。！？!?\n`→`；;`→`，,、`→hardcut。129字中第129字出错必须真正被corrector看到并有编辑。boundary插入归右块，全文末插入归最后块，合并不能重复。第2块失败但1/3块成功→全局failed、保存成功块覆盖/建议、没有finding；重试只跑失败块、配置改变不可复用旧块。取消在块间检查，后续块不调用。
核心断言（`test_csc_covers_tail_and_resumes_failed_chunk_only`，变量由上一步的安排/fixture取得）：

```python
assert "".join(chunk.text for chunk in chunks) == source
assert all(len(chunk.text) <= 128 for chunk in chunks)
assert failed_outcome.finding is None
assert retried_chunk_keys == [failed_chunk_key]
```

- [ ] **Step 2 — Red。** `cd backend && python -m pytest tests/unit/test_csc_chunks.py tests/integration/test_csc_resume.py -q`；预期chunk/pipeline缺失失败。
- [ ] **Step 3 — 实现源文分块与编排。** 每次从当前位置看最多128字符，在该窗口寻找最高优先级标点组的最后边界，含标点切出；无标点硬切。只借用 `simple-csc/scripts/split_parallel_csc.py` 的优先级，不传伪target运行源目标对齐工具（其默认192不是此契约）。每块A3 stage `csc.correct` 与稳定chunk_key，B4返回coverage必须等于块区间，未检尾部不可成功。块offset回映射后再校验原文。全部块成功才产生no_issue/issue，partial失败仍保留checked_ranges/unchecked_ranges和局部编辑，不拼成貌似完整的修正稿。输出长度不等于输入不自动报错，插删用C1diff。
- [ ] **Step 4 — Green。** 重跑Step2 PASS；集成测试真实MySQL销毁执行对象再恢复，成功块不重复调用、全部完成后覆盖恰好原文长度。
- [ ] **Step 5 — 提交。** `git add backend/app/pipelines/csc.py backend/app/domain/chunks.py backend/app/ports/chunks.py backend/app/db/repositories/chunks.py backend/tests/unit/test_csc_chunks.py backend/tests/integration/test_csc_resume.py`；`git commit -m "feat: check full source through resumable c2ec chunks"`。

### C4：RAG教师＋Reference-only学生CGEC

**Files:** Create `backend/app/pipelines/cgec.py`、`backend/app/domain/teacher.py`、`backend/prompts/cgec_teacher_system_v1.txt`、`cgec_teacher_rag_v1.txt`、`cgec_reference_student_v1.txt`；Modify `backend/research_adapters/llm4cgec.py`、`manifest.json`、`configs/profiles.yaml`；Test `backend/tests/unit/test_cgec_teacher.py`、`test_cgec_pipeline.py`、`backend/tests/integration/test_cgec_resume.py`。

**Interfaces:** `TeacherResult(has_error:bool,error_type:str,reference_correction:str,explanation:str)`；`parse_teacher(raw:str,source:str)->TeacherResult`；`classify_cgec(source:str,teacher:TeacherResult,student:str,fact_changes:list[FactChange],mapping_ambiguous:bool)->Finding`；`CgecPipeline(retrieval:RetrievalService,online:OnlinePort,inference:InferencePort,stages:StageRunner)` 标准run。Optional profile `cgec_rag_teacher_direct` 只教师直出、单独method_id，不能失败降级切入。

- [ ] **Step 1 — 写失败测试。** teacher字符串`'false'`、未知类别、false但修正不同、true却no_error/没有实际改动、空解释均invalid；允许类别精确 `word_order/redundant_component/mixed_structure/missing_component/connective_error/negation_structure/no_error`。检索=20rerankfilter→Top5，teacher无错仍调用student，invalidteacher三次后studentcalls=0。按spec五行真值表覆盖no_issue/issue/needs_review。学生输入只能含source+reference+固定示例，不含证据正文/type/explanation；多行仅模型视图归一化，CGEC绝不128字切。超2048输入不调用generate；empty/incomplete三次后failed，保留教师证据；学生重试不重检索/教师。teacher/student改了左右侧或数字时标needs_review，原文和候选都保留。
核心断言（`test_normal_teacher_still_runs_student`，变量由上一步的安排/fixture取得）：

```python
assert teacher.has_error is False
assert len(inference.calls) == 1
assert outcome.finding == "no_issue"
assert student_prompt == make_reference_prompt(model_source, teacher.reference_correction)
```

- [ ] **Step 2 — Red。** `cd backend && python -m pytest tests/unit/test_cgec_teacher.py tests/unit/test_cgec_pipeline.py tests/integration/test_cgec_resume.py -q`；预期教师校验/pipeline缺失失败。
- [ ] **Step 3 — 实现严格教师、学生协议和结论。** 从 `LLM4CGEC/medical_validation/run_exam_proxy.py` 提取 `TEACHER_SYSTEM_PROMPT/TEACHER_RAG_USER_TEMPLATE`，不能import其离线main/target。教师只看当前模型视图source和5条真实证据，Responses/low、历史无temperature，按B3输出身份。strict JSON类型不coerce，extra解释文字不吞掉冒充JSON；valid后保存，再调用B4学生。固定Reference-only模板必须逐字为：

```text
中文医学影像报告语法纠错任务。采用最小修改原则，不改变临床事实，只输出纠正后的完整报告。
示例原始报告：双侧胸腔未见积液以及并、积气征。
示例纠正报告：双侧胸腔未见积液、积气征。
待纠正原始报告：{source}
教师参考纠正：{reference_correction}
纠正后的完整报告：
```

学生无chattemplate，预算/终止/清理按B4，attempt2/3下限按实验；raw与cleaned分别保存。五行：教师正常+学生不改→no_issue；教师有错+学生改且等参考→issue；其他师生分歧→needs_review。只有空白变化不作为错误，不能为符合判定而改原文。C1映射歧义或临床事实风险均提升needs_review。直出profile不调用学生，但仍做严格教师、坐标和事实风险检查；不跑五组消融、SEE、有gold评测或CGEC教师第二轮。

- [ ] **Step 4 — Green。** 重跑Step2 PASS；集成测试阶段成功后重建worker、只重跑失败student；保存source/model_view/offset map、teacher raw/reference、student raw/cleaned/stop、evidenceIDs与实际profile，不将teacher结论伪装student结论。
- [ ] **Step 5 — 提交。** `git add backend/app/pipelines/cgec.py backend/app/domain/teacher.py backend/prompts/cgec_teacher_system_v1.txt backend/prompts/cgec_teacher_rag_v1.txt backend/prompts/cgec_reference_student_v1.txt backend/research_adapters/llm4cgec.py backend/research_adapters/manifest.json backend/configs/profiles.yaml backend/tests/unit/test_cgec_teacher.py backend/tests/unit/test_cgec_pipeline.py backend/tests/integration/test_cgec_resume.py`；`git commit -m "feat: implement rag teacher and reference-only cgec student"`。

### C5：Top10原文定位与条件复核

**Files:** Create `backend/app/pipelines/localization.py`、`backend/prompts/qcrag_error_localization_v2_audit.txt`、`qcrag_error_localization_v2_strict_audit.txt`；Modify `backend/research_adapters/manifest.json`、`configs/profiles.yaml`；Test `backend/tests/unit/test_localization_pipeline.py`。

**Interfaces:** `LocalizationAnswer(answer:str,reason:str)`；`parse_localization(raw:str,source:str)->LocalizationAnswer`；`LocalizationPipeline(retrieval:RetrievalService,online:OnlinePort,stages:StageRunner)` 标准run；details保留 first/second、trigger、final_stage、candidate_spans，evidence为实际Top10同次快照。

- [ ] **Step 1 — 写失败测试。** 第1轮有效错误片段→仅1次；有效“未发现错误”→第2轮，source/evidenceID完全相同；malformedJSON/空answer/空reason/片段不在原文→重试当前轮，不能触发第二轮。第2轮失败→failed+已完成stage记录，不能no_issue；第2轮找到片段→issue；两轮正常→no_issue。重复片段返回所有候选且needs_review，不猜位置；每轮只允许一段连续原文，不能接受拼接的两处片段。有效证据7条仅用7，无证据不调用online。
核心断言（`test_invalid_first_round_is_not_second_round_trigger`，变量由上一步的安排/fixture取得）：

```python
assert first_round_attempts == 3
assert second_round_calls == 0
assert outcome.status == "failed"
assert outcome.finding is None
```

- [ ] **Step 2 — Red。** `cd backend && python -m pytest tests/unit/test_localization_pipeline.py -q`；预期pipeline缺失失败。
- [ ] **Step 3 — 实现定位。** 提取两份既有audit模板（`rag-optimizer/prompts/qcrag_error_localization_v2_audit.txt` 与 `...strict_audit.txt`），固定 `{context_str}/{query_str}` 变量，保留JSON括号转义和原规则。严格JSON `{answer,reason}`，不将坏结构当无错；原始片段经C1校验。第一轮谨慎策略、第二轮strict的字形/数字差异策略按源提示保留，不擅自“优化”实验口径。新profile显式two_stage=true，不能继承旧YAML false；CGEC secondstage仍false。每阶段独立attempt/成功复用，Top10证据内容来自持久快照，不调用生成器总结替代。
- [ ] **Step 4 — Green。** 重跑Step2 PASS；用模板format的测试验证JSON大括号不会KeyError；两轮raw/answer/reason和实际证据ID都可在结果接口查询。
- [ ] **Step 5 — 提交。** `git add backend/app/pipelines/localization.py backend/prompts/qcrag_error_localization_v2_audit.txt backend/prompts/qcrag_error_localization_v2_strict_audit.txt backend/research_adapters/manifest.json backend/configs/profiles.yaml backend/tests/unit/test_localization_pipeline.py`；`git commit -m "feat: localize original spans with conditional rag review"`。

### C6：生产装配与四分支可靠性联调

**Files:** Create `backend/app/services/pipeline_executor.py`、`backend/tests/integration/test_four_branches.py`、`test_method_provenance.py`；Modify `backend/app/api/dependencies.py`、`tasks/qc_tasks.py`、`tasks/recovery.py`、`services/system_service.py`、`configs/profiles.yaml`。

**Interfaces:** `PipelineExecutor(pipelines:dict[Branch,object]).execute(branch:Branch,report:ReportInput,context:StageContext)->BranchOutcome` 实现A1 BranchExecutor；`build_executor(settings:Settings)->PipelineExecutor` 仅装配真实clients/repositories；test工厂通过dependency override显式注入。

- [ ] **Step 1 — 写失败测试。** 一份冻结报告四项调用assert每一项source等于同一原描述；诊断judge额外原诊断，其他分支不读其建议。让CGEC teacher连续invalid、检索200/error和模型未知异常分别发生，StageRunner保存异常链/详细错误且不伪缓存成功，其他3分支仍完成；下一行继续，run partial，不是任务中断。重复消息、分支retry、取消、worker重启后stage复用；四个阶段输出各自带prompt/source/config/model/adapter/index指纹。生产未配置某角色时preflight不ready，无任何demo结果；选择只CSC时不强制在线角色可用。
核心断言（`test_four_branches_share_immutable_original_source`，变量由上一步的安排/fixture取得）：

```python
assert observed_source_by_branch == {branch: report.description for branch in ["diagnosis", "csc", "cgec", "rag"]}
assert failed_teacher_outcome.status == "failed"
assert next_report_completed is True
assert run.status == "partial"
```

- [ ] **Step 2 — Red。** `cd backend && python -m pytest tests/integration/test_four_branches.py tests/integration/test_method_provenance.py -q`；预期executor缺失失败。
- [ ] **Step 3 — 装配生产实现（含recovery.lookup_remote接InferenceClient.get）。** branch映射唯一、无旧report/verify/post_verify角色与旧三专家fallback；系统预检按依赖图诊断→7B+judge，CSC→CPT+adapter，CGEC→retrieval+teacher+Base，RAG→retrieval+localizer。方法快照包括prompt文本hash、研究manifest、模型实际身份、输入/输出预算、CSC分块version、rerank/filter配置和在线实际model/API参数。cache hash任一方法关键参数变化失效；保存明示工程差异（CGECbatch1、RAG过滤、CSC128）不冒称历史复现。
- [ ] **Step 4 — Green。** `cd backend && python -m pytest tests/unit tests/integration -q`，全部PASS；在业务环境 `import app.main` 不加载GPU模型；以缺配置启动只显示真实unavailable而非假ready。
- [ ] **Step 5 — 提交。** `git add backend/app/services/pipeline_executor.py backend/app/api/dependencies.py backend/app/tasks/qc_tasks.py backend/app/tasks/recovery.py backend/app/services/system_service.py backend/configs/profiles.yaml backend/tests/integration/test_four_branches.py backend/tests/integration/test_method_provenance.py`；`git commit -m "feat: wire independent qc pipelines into durable execution"`。
