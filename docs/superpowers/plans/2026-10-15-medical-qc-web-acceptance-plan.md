# Desktop Web Integration and Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保留已批准桌面Web样式，将全部工作流连接持久后台并完成可复核的真实合成输入验收。

**Architecture:** 原型与生产入口隔离，生产只使用REST与生成类型；页面只存临时表单/显示状态。后台任务不依赖浏览器存活，结果与人工意见从服务端恢复；预检和部署不侵入旧服务。

**Tech Stack:** 现有 React19.3.1/TypeScript7.0.2/Vite8.3.4/Tailwind4.3.3/lucide-react1.57.0，保留package-lock；新增Vitest、Testing Library、Playwright、openapi-typescript（实施时选择与锁定当前栈兼容版本）。

**Spec:** [总计划](2026-10-15-medical-qc-implementation.md)、[已审核原型](../../../frontend/prototype/index.html)、[系统设计](../specs/2026-10-15-medical-report-qc-rebuild-design.md)。

## Global Constraints

- 日志遵循[通用项目日志规范](../../通用项目日志规范.md)及[本项目落地约定](../../日志落地约定.md)：Loguru、stdout INFO/文件DEBUG、当地午夜轮转/30天/ZIP、统一配置与脱敏追踪。
- 只验收桌面Web 1280/1440/1920，不增加移动端。保留浅色固定256px/收起80px侧栏、原型导航/信息架构；无密码登录。
- 生产前端不导入demo、retrieved-reports或测试fake，不以示例替代resource_not_found/断网/模型失败。
- 自有API HTTP200也可能失败：先检查status，error读取detail并抛ApiError；外层success/data.status=failed是成功查询到失败任务。
- 每任务约2s轮询，终态停止；关闭/刷新页面不取消后台任务。
- 无虚构4/4、耗时、趋势、分数或完成进度；选择项决定分母，异常与完整性分别展示。
- code point span；RAG抽屉为真实已保存的Top10报告正文及来源，数量不足如实显示。
- 模型密钥不进VITE变量/浏览器/导出；线上模型联调只发送明确合成文本。

## Review Focus

1. 页面重载/前进后退/未知ID不能重置任务或跳到样例（D1/D2）。
2. 轮询乱序/离开页面/断网恢复不能倒退状态或泄露计时器（D2）。
3. 上传文件真正解析映射，首/中/末行失败都继续（D3/D6）。
4. 非BMP与重复片段高亮、Top10来源、复核冲突真实可追溯（D4）。
5. 只有fake测试通过/端口被占用/缺某在线角色不得宣称真实验收完成（D5/D6）。

---

## 文件责任

- `frontend/src/prototype/`、`frontend/prototype.html`、`vite.prototype.config.ts`：隔离离线合成原型；复用纯展示组件，不给生产装配fixture。
- `frontend/src/api/{generated,client,reports,runs,imports,results,reviews,exports,system}.ts`：OpenAPI类型和实际HTTP。
- `frontend/src/hooks/{useHashRoute,useRunPolling,useRequest}.ts`、`src/domain/{status,spans,checks}.ts`：路由、请求生命周期、显示语义。
- 现有 `frontend/src/pages/{Overview,SingleReport,BatchTasks,ReportDetail,Review,Settings}.tsx`、`components/{StudioShell,CheckResult,Overlays}.tsx`、`App.tsx`：保留布局/风格，替换演示数据；必要时将UploadDialog/EvidenceDrawer移入聚焦文件。
- `frontend/tests/`、`frontend/e2e/`：组件、API契约和桌面浏览器验收。
- `backend/ops/scripts/`、`backend/ops/systemd/`、`backend/tests/smoke/`、`docs/operations.md`：无Docker运行、恢复与真实模型验收。

### D1：隔离原型、生成类型与实际API客户端

**Files:** Create `frontend/src/prototype/{App,main}.tsx`、`frontend/prototype.html`、`frontend/vite.prototype.config.ts`、`frontend/src/api/generated.ts`、`client.ts`、`frontend/src/hooks/useHashRoute.ts`、`frontend/tests/setup.ts`、`frontend/tests/{client,route,production-boundary}.test.ts`；Modify `frontend/package.json`、`package-lock.json`、`vite.config.ts`、`scripts/inline-prototype.mjs`、`src/App.tsx`、`src/main.tsx`、`src/types.ts`；Create `frontend/vitest.config.ts`。

**Interfaces:** `apiRequest<T>(path:string,init?:RequestInit)->Promise<T>`、`ApiError(detail:ErrorDetail,request_id:string,http_status:number)`（暴露code/message/detail/request_id/http_status，不用HTTP状态判断业务冲突）；`Route = {page:'overview'|'single'|'batch'|'review'|'settings'} | {page:'task',run_id:string} | {page:'report',run_id:string,run_report_id:string,branch:CheckKey} | {page:'not_found'}`；`useHashRoute()->[Route,(route:Route)=>void]`。路径 `#/runs/{run_id}/reports/{run_report_id}/{branch}`。轻量CheckKey沿用生成Branch，不重复枚举不同值。

- [ ] **Step 1 — 写失败测试。** mock fetch断言相对 `/api/v1`、FormData不手设JSON Content-Type、HTTP200/status=error时抛ApiError并完整保留detail及request_id，HTTP非2xx/非JSON/网络错误转TransportError且不返回样例；业务resource_not_found显示不存在。parse/serialize路由保留两个ID和branch，非法branch/ID不回退首条。静态测试从production入口遍历TS import图，禁止依赖 `src/data/demo.ts`、`retrieved-reports.ts`、`src/prototype`、tests。`App`暂时只路由页面壳，后续接工作流，不保留演示计时器。
核心断言（`client.test.ts / route.test.ts`，变量由上一步的安排/fixture取得）：

```typescript
expect(error.http_status).toBe(200);
expect(error.code).toBe("resource_not_found");
expect(error.detail.message).toBeTruthy();
expect(route.page).toBe("not_found");
expect(productionFixtureImports).toEqual([]);
```

- [ ] **Step 2 — Red。** `cd frontend && npm run test -- tests/client.test.ts tests/route.test.ts tests/production-boundary.test.ts`；预期脚本/模块缺失失败，添加测试依赖后应变为行为断言失败。
- [ ] **Step 3 — 实现入口边界与响应解包客户端。** 保留现有App到prototype入口，合成数据仍只用于离线原型；纯展示组件移除对demo的隐式依赖，metadata移到domain/checks。生产 `build` 只tsc+vite，`build:prototype` 单独Vite配置到dist-prototype，再inline到prototype/index.html；不要覆盖批准原型的视觉。添加 `generate:api` 使用openapi-typescript从 `../backend/openapi.json` 生成 `src/api/generated.ts`；npm test为Vitest run。Vite dev固定5174/strictPort，通过同源proxy `/api`→5100，不在浏览器直连模型端口。JSON先验证ApiResponse的status，success返回data，error构造ApiError；未知封装response_invalid。前端调用点捕获错误并展示detail，可展开code/stage/cause/context并复制request_id；不得仅toast“服务器错误”或console.error后继续成功流程。生产只读前端业务base URL，不允许VITE_API_KEY。
- [ ] **Step 4 — Green。** `cd frontend && npm run generate:api && npm run test -- tests/client.test.ts tests/route.test.ts tests/production-boundary.test.ts && npm run build && npm run build:prototype`；PASS，产物相互隔离。新增依赖锁定package-lock；生成类型再运行应无diff。
- [ ] **Step 5 — 提交。** `git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/vite.prototype.config.ts frontend/vitest.config.ts frontend/prototype.html frontend/scripts/inline-prototype.mjs frontend/src/prototype frontend/src/api frontend/src/hooks/useHashRoute.ts frontend/src/App.tsx frontend/src/main.tsx frontend/src/types.ts frontend/src/domain/checks.ts frontend/tests`；`git commit -m "feat: separate prototype and add typed production api client"`。

### D2：单条运行、真实概览和可恢复进度

**Files:** Create `frontend/src/api/{reports,runs,system}.ts`、`frontend/src/hooks/{useRunPolling,useRequest}.ts`、`frontend/src/domain/status.ts`；Modify `frontend/src/pages/{Overview,SingleReport,BatchTasks,Settings}.tsx`、`frontend/src/App.tsx`、`components/StudioShell.tsx`；Test `frontend/tests/{single-run,polling,status,overview-settings}.test.tsx`。

**Interfaces:** `createReport(data:ReportCreate)->Promise<ReportDTO>`、`createRun(data:RunCreate)->Promise<RunDTO>`、`startRun(id:string)->Promise<RunDTO>`、`getRun(id:string,signal?:AbortSignal)->Promise<RunDTO>`、`useRunPolling(runId:string)->{run?:RunDTO,loading:boolean,error?:ApiError,refresh:()=>void}`、`useRequest<T>(key:string,load:(signal:AbortSignal)=>Promise<T>)->{data?:T,loading:boolean,error?:ApiError}`。状态文案由 `describeResult(status,finding)->{label,tone}`，failed/cancelled/pending/running独立于no_issue。

- [ ] **Step 1 — 写失败测试。** 组件输入原文/诊断、默认四项，assert createReport→createRun→preflight/start顺序及字段逐字不变，重复点击不创建两份。preflight不可用显示具体角色、不静默取消该项；用户可显式关闭。Vitest fake timers：2000ms查询、终态停止、卸载abort、runID改变不接受旧响应、较早revision迟到不覆盖新revision，断网保留最后已知状态并允许恢复。刷新后按routeID查询服务端，不从localStorage恢复假任务。3项选中分母3，failed不显示“通过”。Overview只显示 `/system/summary` 的真实聚合，无数据为空；Settings只读检测不编辑密钥。
核心断言（`polling.test.tsx / status.test.tsx`，变量由上一步的安排/fixture取得）：

```typescript
expect(requestIntervalMs).toBe(2000);
expect(requestCountAfterTerminal).toBe(requestCountAtTerminal);
expect(screen.queryByText("通过")).not.toBeInTheDocument(); // failed result fixture
```

- [ ] **Step 2 — Red。** `cd frontend && npm run test -- tests/single-run.test.tsx tests/polling.test.tsx tests/status.test.tsx tests/overview-settings.test.tsx`；预期新hooks/API或行为断言失败。
- [ ] **Step 3 — 实现API驱动页面。** 任务进度使用units succeeded/failed/cancelled与total，明确“已处理”和“成功”不同；列表分页/筛选由服务端，不能把当前页统计当全站统计。pending开始、running、partial、failed、cancelled均可打开。轮询递归timeout，单flight、AbortController+request generation/revision校验，结束/卸载清理。sidebar计数读取真实聚合，保留256/80布局与本地collapse偏好。Settings显示preflight时间/角色身份/错误，配置变更只影响新任务；不伪造医生账号。
- [ ] **Step 4 — Green。** 重跑Step2，PASS；`npm run build`通过；检查productionApp没有 `setInterval` 模拟进度、fake重试或 `reports[0]` fallback。
- [ ] **Step 5 — 提交。** `git add frontend/src/api/reports.ts frontend/src/api/runs.ts frontend/src/api/system.ts frontend/src/hooks/useRunPolling.ts frontend/src/hooks/useRequest.ts frontend/src/domain/status.ts frontend/src/pages/Overview.tsx frontend/src/pages/SingleReport.tsx frontend/src/pages/BatchTasks.tsx frontend/src/pages/Settings.tsx frontend/src/App.tsx frontend/src/components/StudioShell.tsx frontend/tests/single-run.test.tsx frontend/tests/polling.test.tsx frontend/tests/status.test.tsx frontend/tests/overview-settings.test.tsx`；`git commit -m "feat: connect single checks and persistent run progress"`。

### D3：批量导入、取消/仅失败重试和真实导出

**Files:** Create `frontend/src/api/{imports,exports}.ts`、`frontend/src/components/UploadDialog.tsx`；Modify `frontend/src/api/runs.ts`、`src/components/Overlays.tsx`、`src/pages/BatchTasks.tsx`、`src/App.tsx`；Test `frontend/tests/{batch-import,batch-actions,export}.test.tsx`。

**Interfaces:** `uploadImport(file:File)->Promise<ImportDTO>`、`confirmImport(id:string,mapping:ColumnMapping,checks:CheckKey[])->Promise<ImportConfirmation>`、`cancelRun(id:string)->Promise<RunDTO>`、`retryFailed(id:string,expected_revision:number,module_result_ids?:string[])->Promise<RunDTO>`、`requestExport(run_id:string)->Promise<ArtifactDTO>`、`getExport(id:string)->Promise<ArtifactDTO>`、`downloadArtifact(id:string)->Promise<{blob:Blob,filename:string}>`。

- [ ] **Step 1 — 写失败测试。** 两个上传文件不同正文、服务端返回不同列/preview，UI必须展示各自真实预览而非内置6条；解析pending可关弹窗，重新查询可恢复。映射/checks确认后展示valid/invalid行及原始行号，默认四项创建run。首/中/末行失败场景都允许继续显示后续报告。重试只传失败目标ID，成功结果不闪回pending；重复提交或detail.code=revision_conflict时刷新服务端，取消不kill模型。partial/failed/cancelled均可导出；导出pending显示生成状态，ready后下载服务端xlsx，不创建CSV Blob替代。额外模拟下载HTTP200但Content-Type=application/json且status=error，断言显示detail、没有保存假xlsx。
核心断言（`batch-actions.test.tsx / export.test.tsx`，变量由上一步的安排/fixture取得）：

```typescript
expect(retryBody.module_result_ids).toEqual([failedResultId]);
expect(retryBody.expected_revision).toBe(run.revision);
expect(download.filename.endsWith(".xlsx")).toBe(true);
```

- [ ] **Step 2 — Red。** `cd frontend && npm run test -- tests/batch-import.test.tsx tests/batch-actions.test.tsx tests/export.test.tsx`；预期新接口/组件尚未实现失败。
- [ ] **Step 3 — 实现真实工作流。** 上传file对象、异步解析状态/错误、实际columns映射；缺必需列/空文件阻止创建，无效行保留。创建run成功后按ID导航，刷新独立可访问。retry使用run revision与可选module_result_ids，禁用请求中按钮；failure提示保留stage/errorcode，不用简单toast当完成。下载通过受控artifactURL的客户端读取Content-Type，JSON先按业务封装判错，仅合法xlsx类型保存blob；不得把JSON错误下载为xlsx。下载由真实artifact触发，已完成导出可重复下载。CSV下载模板可以保留，但模板按钮明确区别结果导出。
- [ ] **Step 4 — Green。** 重跑Step2，PASS；选定3项时任务列表与详情都只算3项，invalid行在导出/页面数字一致。
- [ ] **Step 5 — 提交。** `git add frontend/src/api/imports.ts frontend/src/api/exports.ts frontend/src/api/runs.ts frontend/src/components/UploadDialog.tsx frontend/src/components/Overlays.tsx frontend/src/pages/BatchTasks.tsx frontend/src/App.tsx frontend/tests/batch-import.test.tsx frontend/tests/batch-actions.test.tsx frontend/tests/export.test.tsx`；`git commit -m "feat: connect real batch imports retries cancellation and xlsx"`。

### D4：原文详情、Top10全文与持久人工复核

**Files:** Create `frontend/src/api/{results,reviews}.ts`、`frontend/src/domain/spans.ts`、`frontend/src/components/{EvidenceDrawer,MarkedText}.tsx`；Modify `frontend/src/components/CheckResult.tsx`、`Overlays.tsx`、`src/pages/{ReportDetail,Review}.tsx`、`src/App.tsx`、`src/styles.css`；Test `frontend/tests/{source-spans,result-details,evidence,reviews}.test.tsx`。

**Interfaces:** `getResult(id:string)->Promise<ResultDTO>`、`getEvidence(id:string)->Promise<EvidenceSnapshot[]>`、`appendReview(command:ReviewCreate)->Promise<ReviewDTO>`、`splitMarkedText(source:string,spans:SourceSpan[])->Array<{text:string,marked:boolean,span_ids:string[]}>`。`MarkedText({source,spans})` 为标记节点附data-start/code point位置，不再接受fragment首次匹配；`EvidenceDrawer({resultId,onClose})` 读取历史快照；人工队列 `GET /results?review_state=pending`。

- [ ] **Step 1 — 写失败测试。** 原文 `𠮷灶。𠮷灶。` start3/end5 只高亮第二处；零宽插入有可访问标识，重叠span保留多来源。span不符不乱标且显示定位不可用；诊断span用医生诊断，不用描述。failed+cgec已成功teacher显示教师参考/学生失败，不能no_issue。evidence实际7条显示7、排序与used_rank一致，长报告正文完整可阅读，来源null显示未记录；若full_report_text存在显示可验证原报告并另列当时使用片段，否则indexed_chunk明确片段且不伪称全文。复核accept/reject/edit/defer成功后刷新仍在，HTTP200/error/revision_conflict不覆盖、重新加载意见，旧generation审核不套新结果；不自动合并冲突建议。
核心断言（`source-spans.test.tsx / evidence.test.tsx`，变量由上一步的安排/fixture取得）：

```typescript
expect(markedNodes.map(node => node.textContent)).toEqual(["𠮷灶"]);
expect(markedNodes[0].dataset.start).toBe("3");
expect(referenceReportItems).toHaveLength(7);
expect(reviewConflict.http_status).toBe(200);
expect(reviewConflict.code).toBe("revision_conflict");
```

- [ ] **Step 2 — Red。** `cd frontend && npm run test -- tests/source-spans.test.tsx tests/result-details.test.tsx tests/evidence.test.tsx tests/reviews.test.tsx`；预期新组件/行为断言失败。
- [ ] **Step 3 — 实现详情与审核。** 用 `Array.from(source)` 转code point，先校验区间、排序拆分，禁止JS `source.indexOf(fragment)`/UTF16slice直接标记。分开原文编辑、定位span与ambiguity候选；正常结果仍显示完整性，未选分支显示未启用而非failed。evidence展示实际报告文本（优先已保存full_report_text，另保留当时检索片段）、rank、node/docID、来源文件/语料集/行号、score/index version（存在时），不给模型摘要替代；技术attempt/raw按需折叠读取。错误面板展示detail.message/code/stage/cause/retryable/request_id，失败attempt可展开脱敏诊断信息，保持普通页面简洁；不展示含secret的原始堆栈。审核revision与generation传后端，成功后refresh，不本地伪存；confirmation稿仅针对该建议，原文/模型保持各自记录。保持已审核浅色布局、焦点可见、抽屉Esc/焦点圈定/关闭后焦点恢复，增加reduced-motion规则，不另做风格重设计。
- [ ] **Step 4 — Green。** 重跑Step2，PASS；`npm run typecheck && npm run build`；浏览器检查四项详情、重复片段、长证据、失败时原文可读。
- [ ] **Step 5 — 提交。** `git add frontend/src/api/results.ts frontend/src/api/reviews.ts frontend/src/domain/spans.ts frontend/src/components/EvidenceDrawer.tsx frontend/src/components/MarkedText.tsx frontend/src/components/CheckResult.tsx frontend/src/components/Overlays.tsx frontend/src/pages/ReportDetail.tsx frontend/src/pages/Review.tsx frontend/src/App.tsx frontend/src/styles.css frontend/tests/source-spans.test.tsx frontend/tests/result-details.test.tsx frontend/tests/evidence.test.tsx frontend/tests/reviews.test.tsx`；`git commit -m "feat: show original spans retrieved reports and persistent review"`。

### D5：无Docker部署、预检、恢复和日常操作

**Files:** Create `backend/ops/scripts/{check_deployment,render_units,prune_logs}.py`、`backend/ops/systemd/{medical-qc-api,medical-qc-worker,medical-qc-gpu,medical-qc-retrieval}.service.in`、`backend/ops/nginx/medical-qc.conf.example`、`backend/tests/unit/test_deployment_checks.py`、`backend/tests/unit/test_log_retention.py`、`docs/operations.md`；Modify recovery单位、`backend/.env.example`、`backend/README.md`、`frontend/README.md`、根 `README.md`、`.gitignore`。

**Interfaces:** `check_deployment(config:DeploymentConfig)->DeploymentReport`；`render_units(config:DeploymentConfig,output_dir:Path)->list[Path]`；`prune_logs(log_root:Path,older_than_days:int=30,dry_run:bool=True)->PruneSummary`，PruneSummary含deleted/skipped/errors；CLI默认dry-run、显式--apply才清理，作用域仅日志根目录。命令 `python ops/scripts/check_deployment.py --config configs/deployment.local.yaml`，DeploymentReport有ok/errors/warnings/port_owners/envs/asset_identities。配置文件含env解释器路径、run user、项目根路径、端口、schema/Redis命名空间；真实本机配置不入Git，提供deployment.example.yaml。

- [ ] **Step 1 — 写失败测试。** 用临时socket占5100/8101/8102/5174，检查只报冲突、不kill、不改旧端口；日志units包含TZ=Asia/Shanghai、绝对APP_LOG_DIR和独立instance_id，清理测试含旧PID目录/活动日志/符号链接路径逃逸，只清理30天前关闭文件和ZIP，绝不删活跃日志或审计/业务数据；schema与旧库相同、Redis占用未确认、GPU units workers>1/reload、密钥出现在前端env都不通过。unit模板渲染包含GPU单worker、worker `--pool=threads --concurrency=4 --prefetch-multiplier=1`、单独CPUenv、recovery每60s；check/render命令始终只读检查或写指定输出目录，不提供自动安装/启动系统服务的副作用。
核心断言（`test_port_conflict_never_terminates_existing_service`，变量由上一步的安排/fixture取得）：

```python
assert deployment.ok is False
assert occupied_port_owner_alive is True
assert subprocess_kill_calls == []
assert gpu_worker_count == 1
```

- [ ] **Step 2 — Red。** `cd backend && python -m pytest tests/unit/test_deployment_checks.py tests/unit/test_log_retention.py -q`；预期check/render未实现失败。
- [ ] **Step 3 — 实现脚本与操作手册。** check只读，不默认装系统/安装unit/更改防火墙；render写指定临时输出，不覆盖系统配置。文档给出创建三个独立env、业务DB最小权限/迁移、Redis隔离、模型路径、供应商环境变量、启动/停止/日志、恢复、导出/备份及回滚命令。单位User=dell或部署配置指定低权限用户，var目录600/700，模型/索引只读；不能root运行全部服务。GPU/CPU和online凭据仅后端，反向代理只暴露静态Web及业务API，内部端口不转发。配置日志轮转/保留：普通日志30天（按Loguru每天00:00切分、ZIP压缩）、raw审计默认30天可配置，业务结果/证据不自动删除；审计清理不得删活跃attempt引用。log_root按service/instance/PID隔离；prune_logs.py提供--dry-run和--older-than-days 30选项，运维每日执行清理旧进程目录并监控磁盘。部署确认stdout INFO/文件DEBUG、不重handler、不可写fallback和时区；同步sink首版不引入日志异步队列。Git忽略playwright/test输出和本地部署env/数据，不忽略方法manifest/lock。
- [ ] **Step 4 — Green。** 重跑Step2 PASS；对渲染到临时目录的units运行 `systemd-analyze verify <rendered paths>`，无语法错误。实际服务启动放D6；写明“已渲染/验证”和“已安装/启动”的差别。查看文档启动命令不能引用旧5000/8003/5173，不需要Docker/MinIO/Neo4j。
- [ ] **Step 5 — 提交。** `git add backend/ops backend/configs/deployment.example.yaml backend/tests/unit/test_deployment_checks.py backend/tests/unit/test_log_retention.py backend/.env.example backend/README.md frontend/README.md docs/operations.md README.md .gitignore`；`git commit -m "ops: document isolated services preflight recovery and deployment"`。

### D6：桌面端到端、故障恢复及真实四项验收

**Files:** Create `frontend/playwright.config.ts`、`frontend/e2e/{single,batch,reviews,evidence,recovery,desktop-layout}.spec.ts`、`backend/tests/smoke/{conftest,test_real_four_checks}.py`、`backend/ops/scripts/run_synthetic_acceptance.py`、`backend/tests/fixtures/synthetic_reports.json`、`docs/acceptance/README.md`；Modify `frontend/package.json`/lock、`docs/operations.md`。

**Interfaces:** CLI `python ops/scripts/run_synthetic_acceptance.py --api http://127.0.0.1:5100 --output <outside-git-dir>` 只读预检后提交明确fixture报告并查询结果/导出；返回码0=全部必需验收通过，2=配置/资源未就绪，1=实际失败。生成manifest.json包含真实身份、配置指纹、执行次数、peak显存/RAM、失败与未验证项，不含secret/患者文本。

- [ ] **Step 1 — 写失败测试和验收矩阵。** 测试API使用独立DB/Redis+注入ports，绝不在生产启用MOCK环境开关。Playwright实际上传CSV/XLSX→映射→后台任务→刷新→4项详情→Top10→accept/reject/edit/defer→下载并由openpyxl检查xlsx。6份合成报告覆盖正常、字符错误、语法错误、重复片段、非BMP、>128字；故障注入分别放首/中/末行、teacher invalid3次、第三方429、HTTP超时、二轮失败、empty证据、worker重启、Redis消息丢失。断言其他报告继续，成功stage不重跑、无假正常、pending/poll终态一致。注入API RuntimeError和内部200/error：浏览器展示detail和request_id，无成功toast、不存伪结果；按request_id/task_id可在脱敏日志中追到提交→执行→最终状态及原始异常链，两个并发任务不串号，最终堆栈不重复、计数互斥且无正文/密钥；模拟JSON下载错误不保存xlsx。1280/1440/1920与80px侧栏截图无横向溢出；键盘与reduced-motion可操作；定位证据至少一条可核对完整报告来源，chunk-only不能通过全文验收。
核心断言（`recovery.spec.ts / test_real_four_checks`，变量由上一步的安排/fixture取得）：

```python
assert real_branch_statuses == {branch: "succeeded" for branch in ["diagnosis", "csc", "cgec", "rag"]}
assert production_mock_calls == 0
assert downloaded_workbook.sheetnames[-1] == "处理汇总"
assert submitted_report_sha == persisted_report_sha
```

- [ ] **Step 2 — Red。** `cd frontend && npm run test:e2e`；新增场景在尚未接通真实页面/测试server时失败，不能以全skip通过。真实smoke必须受 `MEDICAL_QC_REAL_SMOKE=1` 显式开关，缺开关不加载模型/不发在线请求；缺凭据报告blocked，不能falsepass。
- [ ] **Step 3 — 补齐测试启动器与真实验收脚本。** testserver只在tests/smoke中创建应用，固定syntheticfixtures明确标记合成；Playwright连真实测试HTTP API，不拦截浏览器REST来伪装全链成功。真实验收在用户确认可信/重建的主机上，先check部署与预检→B4三骨干同时常驻容量probe→B5索引/CPU重排→合成单条四项→6行batch→取消/失败重试→重启API/worker后查询→真xlsx。受控故障注入只用于测试env，不在真实在线供应商人为重复付费请求；真实矩阵与fake故障覆盖分开报告。运维验收使用隔离日志目录验证日期切分、30天保留、ZIP及旧PID清理，不调整主机时钟；控制台/文件等级与调用点实际可见。检查实际teacher/diagnosis/RAG供应商角色，模型不可用不自动替换；每个branch至少一次实际成功判断，RAG第二轮若未自然触发标“合成真实输入未覆盖，已离线验证”，不能伪造。7B512输出预算、CGEC2048输入容量真实probe不满足则停止放行，不以同机历史容量值冒充本轮。
- [ ] **Step 4 — Green / 分层验收。** 业务env `cd backend && python -m pytest tests/unit tests/integration -q`；前端 `npm run test && npm run typecheck && npm run build && npm run test:e2e` 全部PASS。GPU env执行B4 smoke、CPU env执行B5 smoke，最后业务env显式真实脚本；只在全部必需角色实际可用并完成四项后写“四项真实联调通过”。记录每份报告/分支状态、证据数量和正文溯源、实际耗时/资源、调用identity；质量分布不是论文指标，CSC128边界效果人工核对另列，不以测试全绿宣称临床可用或论文复现。缺配置/证据全文映射/容量通过记录则列未完成项，禁止删除验收项以凑全绿。
- [ ] **Step 5 — 提交可复现测试与验收说明。** `git add frontend/playwright.config.ts frontend/e2e frontend/package.json frontend/package-lock.json backend/tests/smoke backend/tests/fixtures/synthetic_reports.json backend/ops/scripts/run_synthetic_acceptance.py docs/acceptance/README.md docs/operations.md`；`git commit -m "test: verify desktop qc workflows and real synthetic inference"`。运行产物/原始响应留var或外部审计目录，只提交脱敏摘要与可复现命令，不提交模型/大文件/密钥。
