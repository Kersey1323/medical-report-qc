# 医学影像报告质控系统

React＋TypeScript＋Vite＋Tailwind桌面Web，FastAPI＋MySQL持久业务，Celery后台任务。默认独立执行诊断一致性、字符纠错、语法纠错、检索增强定位；原始报告、模型建议与人工意见分别保存，支持批量无效行保留、失败继续/重试、Top10原报告溯源及7工作表XLSX。

- [运行、环境、配置与维护](docs/operations.md)
- [后端](backend/README.md) · [前端](frontend/README.md) · [分层验收及限制](docs/acceptance/README.md)
- [离线审核原型（合成示例）](frontend/prototype/index.html)
- [设计与方法spec](docs/superpowers/specs/) · [实施计划](docs/superpowers/plans/2026-10-15-medical-qc-implementation.md)
- [日志规范原文](docs/通用项目日志规范.md) · [本项目约定](docs/日志落地约定.md)

业务API5100，Web5174，CPU检索8102；模型部署复用独立项目 `/mnt/mydrive/project/medicalReportModelService` 的5555。模型、语料、索引只经配置引用，不复制入Git，无需Docker或Milvus。在线教师/定位当前为gpt-5.6-sol，诊断判别为deepseek-flash；角色不可用显式报错，无静默切换。

```text
backend/app/           # API、数据库、任务编排、四项pipeline与HTTP客户端
backend/contracts/     # 推理/检索/错误契约
backend/retrieval_runtime/ # 只读既有索引与CPU重排编排，独立环境
backend/research_adapters/ # 实验方法常量、提示词来源哈希
backend/ops/           # 只读预检、unit模板、恢复/合成验收工具
frontend/src/          # 生产Web；prototype子目录隔离原型
var/                   # 本地上传、导出、验收产物、日志（忽略Git）
```

内部异常统一HTTP200/status=error/detail，成功查询到failed任务仍为success.data.status=failed。历史索引缺少embedding摘要；本机抽样高度相似仅支持工程兼容性判断，不等于历史身份核验。全文展示需经过文档来源核验，不能验证则明确显示检索片段。
