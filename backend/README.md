# 医学报告质控后端

Python3.11、FastAPI、SQLAlchemy/MySQL、Celery线程池4、Redis。默认四条独立流程：诊断一致性、全文CSC128字分块、RAG教师+CGEC学生、RAG两轮条件定位。原有三专家串联流程已取消。

服务入口：`app.main:app`（5100）、`app.tasks.celery_app:celery_app`、`retrieval_runtime.main:app`（8102，独立环境）。三个GPU角色和CPU embedding/rerank经现有5555 HTTP调用；业务进程不加载模型。

[完整启动、配置与维护命令](../docs/operations.md)。配置示例 `.env.example`；在线角色 `configs/profiles.yaml`；只读索引位置 `configs/retrieval.yaml`。不得将本机.env纳入Git。

内部错误统一HTTP200、status=error、detail；成功创建/启动保留201/202，查询200。任务失败在success.data中呈现，所有列表/详情可按持久ID恢复。原文、结果、建议和append-only人工意见独立记录。`openapi.json`为生成契约。
