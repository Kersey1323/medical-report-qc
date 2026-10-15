# 桌面 Web 离线审核原型

直接打开 `index.html`；无需服务或联网。由 React + TypeScript + Vite + Tailwind CSS 源码构建，复用现有 Studio 视觉风格。

本次只设计桌面 Web。所有数据与结果均为合成示例，未连接模型或后台服务。源码与操作说明见 `../README.md`，桌面截图在 `previews/`。

2026-10-15 初版：TypeScript 检查与 Vite 构建通过；桌面 Chrome 59 项检查通过，覆盖 1280 / 1440 / 1920px 页面、导航、检查选择、失败重试、人工复核、证据面板、批量演示和 CSV 导出。无浏览器运行错误或外部 HTTP 请求。详细检查记录见 `verification.json`。

验证限于交互原型，不包含真实后端、模型推理、XLSX 导出或算法效果。

2026-10-15 RAG 溯源修改：按排名展开十份合成参考报告全文，显示报告 ID、来源文件和记录位置；入口关联当前待检报告，桌面抽屉加宽。类型检查与构建通过；新增 15 项针对性浏览器检查通过，无运行错误及外部请求。记录见 `rag-references-verification.json`，截图见 `previews/rag-references.png`。
