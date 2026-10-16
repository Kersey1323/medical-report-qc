# 医学报告质控运行手册

## 服务与配置

业务API `0.0.0.0:5100`，React开发服务 `0.0.0.0:5174`，独立CPU检索 `127.0.0.1:8102`；已有模型项目 `medicalReportModelService` 在5555提供三个GPU角色以及CPU embedding/rerank。不要再次加载GPU或停止旧服务。业务环境不加载Torch、Transformers或LlamaIndex；LlamaIndex仅在检索环境恢复既有向量，禁止自动重建。无需Docker/Milvus/Neo4j/MinIO。

所有命令均以普通用户dell执行。环境文件 `backend/.env` 权限600，var及日志目录700；上传/导出文件600。模型与索引按只读资产处理。免登录版只应暴露在受控网络；API、worker、内部模型接口不直接发布到公网。

## 首次环境

需要Python3.11+、Node22.12+、MySQL8兼容数据库、Redis。

```bash
cd /mnt/mydrive/project/medical-report-qc
python3.11 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock.txt
.venv/bin/python -m pip install --no-deps -e backend
python3.11 -m venv backend/.venv-retrieval
backend/.venv-retrieval/bin/python -m pip install -r backend/requirements-retrieval.lock.txt
backend/.venv-retrieval/bin/python -m pip install --no-deps -e backend
cp backend/.env.example backend/.env
chmod 600 backend/.env
cd frontend
npm ci
```

已存在环境时不要重复覆盖。管理员预先创建独立schema `medical_report_qc`，并为专用账户授予该schema内权限；测试使用另一个 `medical_qc_test_*` schema。把URL写入本机.env，不把管理员账户放入项目。测试禁止操作业务库；业务事实只在MySQL，不依赖Celery结果存储。

Redis broker DB8，限流DB9，前缀 `medical_qc:`。部署前确认没有其他业务使用这些DB/前缀；恢复操作只处理自身outbox及自身键，绝不执行FLUSHDB或FLUSHALL。

```bash
cd /mnt/mydrive/project/medical-report-qc/backend
../.venv/bin/python -m alembic upgrade head
```

在线模型位于 `configs/profiles.yaml`：判别、教师与定位均为 `gpt-5.6-sol`（Responses，reasoning low）。2026-10-16 工程配置已将判别切换至同一兼容网关，不冒充历史实验配置。分别填写JUDGE_API_KEY、TEACHER_API_KEY、LOCALIZER_API_KEY；三者均需使用该网关的有效密钥，禁止沿用其他供应商的密钥。无自动降级模型。目录预检通过不代表实际推理授权、额度及协议必然可用，真实测试另行记录。

索引位置在 `configs/retrieval.yaml`；历史digest未知，默认拒绝加载。已在本机对三个节点做查询embedding对比，余弦均>0.99996；本机明确开启 `ALLOW_UNKNOWN_EMBEDDING_PROVENANCE=true`，就绪信息仍公开unknown，不能当作历史模型身份证明。全文只来自配置allowlist，经文档ID、历史MD5与文本核验；无法验证时展示片段。

## 启动与停止

分别在终端执行（以下均需长驻）：

```bash
# 终端1：CPU检索；首次加载约30秒，可能需要数GiB RAM
cd /mnt/mydrive/project/medical-report-qc/backend
INSTANCE_ID=retrieval .venv-retrieval/bin/python -m uvicorn retrieval_runtime.main:app --host 127.0.0.1 --port 8102 --workers 1
```

```bash
# 终端2：业务API
cd /mnt/mydrive/project/medical-report-qc/backend
INSTANCE_ID=api ../.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 5100 --workers 1
```

```bash
# 终端3：后台任务，不启动多个GPU进程
cd /mnt/mydrive/project/medical-report-qc/backend
INSTANCE_ID=worker ../.venv/bin/python -m celery -A app.tasks.celery_app:celery_app worker --pool=threads --concurrency=4 --prefetch-multiplier=1 --loglevel=INFO
```

```bash
# 终端4：Web开发服务
cd /mnt/mydrive/project/medical-report-qc/frontend
npm run dev
```

本机浏览器打开 `http://127.0.0.1:5174`，局域网其他设备打开 `http://<服务器局域网IP>:5174`；API 地址为 `http://<服务器局域网IP>:5100`。`0.0.0.0` 是监听地址，浏览器访问时应使用实际 IP。按Ctrl+C仅停止当前终端拥有的服务。worker优先温和停止等待在途任务；强制终止后通过恢复程序以原请求ID核对，不重复提交不确定请求。

API提交事务后尝试发布outbox，API启动也尝试恢复；正式部署必须启用每60秒的恢复任务，或临时手动执行：

```bash
cd /mnt/mydrive/project/medical-report-qc/backend
../.venv/bin/python -m app.tasks.recovery --once
```

恢复会续查5555原请求ID，已运行的不重发；结果未知显式失败并保留attempt。出现remote_state_unknown/lease_lost时按请求ID查模型服务和日志，禁止靠反复重试制造重复推理。成功stage和候选可复用，失败重试生成新generation，人工意见不自动套用新代际。取消仅阻止未开始阶段，不杀共享模型。

## systemd与反向代理

```bash
cd /mnt/mydrive/project/medical-report-qc/backend
cp configs/deployment.example.yaml configs/deployment.local.yaml
../.venv/bin/python ops/scripts/check_deployment.py --config configs/deployment.local.yaml
../.venv/bin/python ops/scripts/render_units.py --config configs/deployment.local.yaml --output ../var/rendered-units
systemd-analyze verify ../var/rendered-units/*.service ../var/rendered-units/*.timer
```

check只读：已运行的自有端口同样显示占用，不自动杀进程。render仅写输出目录，**不安装、不启用系统服务**。模板包含API、threads4 worker、独立CPUenv检索和60秒恢复timer，TZ=Asia/Shanghai、umask0077。GPU由既有5555项目管理，本项目不生成第二份GPU unit。管理员审核后再手动安装这些unit。反向代理示例 `ops/nginx/medical-qc.conf.example` 只转发 `/api/v1` 和静态dist，不转发内部端口。生产执行 `npm run build`，开发Vite不替代生产静态服务器。

## 日志、错误与存储

遵循 `docs/通用项目日志规范.md` 与 `docs/日志落地约定.md`。stdout INFO，文件DEBUG；Loguru本地午夜轮转、ZIP、30天保留，路径 `var/logs/{service}/{instance_id}/pid-{pid}/app/`。request_id / task_id / item_id / stage / attempt串联调用，异常链不记录局部变量，正文和注册密钥脱敏。内部错误HTTP200，读取 `status=error` 与detail；查询成功但task.failed属于成功查询，不能误报成功处理。

旧进程日志需另做保留检查；默认dry-run：

```bash
cd /mnt/mydrive/project/medical-report-qc/backend
../.venv/bin/python ops/scripts/prune_logs.py --log-root ../var/logs --older-than-days 30
# 确认范围后显式添加 --apply；不跟随符号链接，不删除活跃PID日志。
```

原始模型响应、结果、证据及人工意见位于MySQL；上传与XLSX在var。**当前不自动删除审计响应**，避免破坏在途/历史引用；30天审计归档需先备份并制定独立审批策略，普通日志清理不碰审计/业务数据。运维监控DB/var磁盘，按要求另做加密备份；备份数据库、上传/导出及配置版本应一致，不包含公开密钥副本。

回滚：温和停当前业务API/worker/retrieval，切换审核后的代码版本和锁文件，再启动；数据库迁移先评估数据兼容。初始迁移的downgrade会删表，生产**不执行降级删表**，通过备份恢复到独立schema验证。5555与旧业务不受回滚影响。

## 测试与真实验收

```bash
cd /mnt/mydrive/project/medical-report-qc/backend
../.venv/bin/python -m pytest tests/unit tests/integration -q
../.venv/bin/python ops/scripts/export_openapi.py
cd ../frontend
npm run generate:api
npm run test
npm run build
npm run test:e2e
npm run build:prototype
```

测试使用独立MySQL，Playwright自建测试API5100与Web5174，先停本项目占这两个端口的开发服务；不会停止已有进程。浏览器使用本机 `/usr/bin/google-chrome`，其他机器通过修改Playwright配置选择已安装Chrome。测试server在tests目录，仅注入可控合成executor，无生产MOCK开关；不把该测试通过视为真实模型通过。

真实联调需先正常启动业务服务，脚本只读明确合成fixture，然后发送线上模型请求，可能产生费用：

```bash
cd /mnt/mydrive/project/medical-report-qc/backend
MEDICAL_QC_REAL_SMOKE=1 ../.venv/bin/python ops/scripts/run_synthetic_acceptance.py --api http://127.0.0.1:5100 --output ../var/acceptance/live-single
# 六份合成报告批量（仍非患者数据）
MEDICAL_QC_REAL_SMOKE=1 ../.venv/bin/python ops/scripts/run_synthetic_acceptance.py --api http://127.0.0.1:5100 --output ../var/acceptance/live-six --batch
```

manifest含配置/身份、原文SHA、attempt、证据数、错误与未验证项；只有所有分支succeeded且真实7sheet XLSX可读才返回0。返回2=未配置或未就绪，1=实际失败。不要把missing/blocked记为通过。临床质量、论文指标、2048输入/512输出边界容量及故障重启覆盖见验收文档，不能以本机历史记录替代本轮实测。


## 本机文件权限补充

当前 `/mnt/mydrive` 挂载对chmod显示为777，不能依赖其中的600/700实现访问隔离。已把新业务.env实际内容放在 `/home/dell/.config/medical-report-qc/backend.env`（目录700、文件600），项目.env仅为忽略Git的符号链接；systemd EnvironmentFile可沿该链接读取。本机验收输入全为合成文本。处理真实报告前，应将VAR_DIR和APP_LOG_DIR配置到支持Unix权限的私有文件系统，或先修正挂载访问控制；文档中的chmod在正常Unix文件系统上有效。

## 最终修复后的运行说明

迁移执行 `../.venv/bin/python -m alembic upgrade head`，当前head为0002（导入/导出租约归属）。导入/导出处理时每30秒续租120秒，只有当前归属可提交成功、失败或发布文件。未确认GPU请求不会用新ID重发，恢复器按原ID核对。生产应按上面的模板启用60秒恢复timer；本次仅渲染模板，尚未安装，开发需要时可手动执行 `../.venv/bin/python -m app.tasks.recovery --once`。

检索配置、索引、embedding、CPU配置和重排身份均冻结进新任务预检快照；服务资产变化时拒绝旧配置，需核对配置后创建新任务。升级前缺少这些身份字段的旧任务不会自动推断身份，已保存结果仍可查看/导出。

导出是点击时的不可变快照，界面显示快照时间。重试或复核后点击“重新生成XLSX”，不会用旧快照冒充更新后的内容。
