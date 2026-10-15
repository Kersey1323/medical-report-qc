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

## 目录

```text
medical-report-qc/
├── backend/                  # 业务后端、后台任务、GPU 与 CPU 服务
├── frontend/                 # Web 前端
├── docs/superpowers/
│   ├── specs/                # 设计和方法契约
│   └── plans/                # 后续实施计划
└── var/                      # 上传、导出、审计及日志；不纳入 Git
```

已创建后端架构中的各级目录，具体文件在实施时按计划添加。

模型、研究代码和检索索引通过配置引用既有位置，未复制到新项目。本机算力实测与方法核查证据保留在 `/mnt/mydrive/LLM/rag-optimizer/output/compute-feasibility-20261015/`。
