# 医学影像报告质控系统

项目位置：`/mnt/mydrive/project/medical-report-qc`。

当前已按审核后的架构建立目录，并迁入本次系统重建的三份 spec。已创建 React 交互原型供页面审核；后端与真实模型接入尚未实施。

前端技术栈：React＋TypeScript＋Vite＋Tailwind CSS。

## 前端原型

- [直接打开离线 HTML](frontend/prototype/index.html)
- [前端源码与使用说明](frontend/README.md)

原型采用 React＋TypeScript＋Vite＋Tailwind CSS，所有结果为合成示例，未连接模型与后台服务。

## 设计文档

- [系统重建 spec](docs/superpowers/specs/2026-10-15-medical-report-qc-rebuild-design.md)
- [CGEC 实验逻辑与工程接入契约](docs/superpowers/specs/2026-10-15-medical-cgec-experiment-contract.md)
- [后端目录与架构](docs/superpowers/specs/2026-10-15-medical-qc-backend-architecture.md)

## 项目规范

- [通用项目日志规范（用户提供原文）](docs/通用项目日志规范.md)
- [本项目日志落地约定](docs/日志落地约定.md)

## 实施计划

- [实施总计划与四阶段索引](docs/superpowers/plans/2026-10-15-medical-qc-implementation.md)

桌面 Web 原型已审核通过。计划包含 25 个可测试任务；尚未开始业务实现或真实四项联调。

## 目录

```text
medical-report-qc/
├── backend/                  # 业务后端、后台任务、GPU 与 CPU 服务
├── frontend/                 # Web 前端
├── docs/
│   ├── 通用项目日志规范.md     # 用户提供的规范原文
│   ├── 日志落地约定.md         # 本项目路径、字段和验收要求
│   └── superpowers/
│       ├── specs/            # 设计和方法契约
│       └── plans/            # 实施计划
└── var/                      # 上传、导出、审计及日志；不纳入 Git
```

已创建后端架构中的各级目录，具体文件在实施时按计划添加。

模型、研究代码和检索索引通过配置引用既有位置，未复制到新项目。本机算力实测与方法核查证据保留在 `/mnt/mydrive/LLM/rag-optimizer/output/compute-feasibility-20261015/`。

## 医学知识库配置

[backend/configs/retrieval.yaml](backend/configs/retrieval.yaml) 配置既有医学向量缓存路径、1024维 BGE 身份、5555 模型服务和召回/过滤参数。
`index.cache_dir` 指向现有 `QcRAG_dev_gold_span` 目录，`index.data_file` 为 `original.json`；仅恢复既有数据，不自动重建或安装 Milvus。
默认向量与关键词混合召回20条，全量重排并过滤后，CGEC使用最多5条、定位使用最多10条。
该文件已添加；业务后端的配置读取、索引恢复和实际检索接口仍待实施。旧缓存未内嵌模型digest，首次接入需核验历史embedding身份，不能只凭维度判断兼容。
