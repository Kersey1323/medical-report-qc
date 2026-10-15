# 医学报告质控 Web 原型

技术栈：React + TypeScript + Vite + Tailwind CSS，图标使用 Lucide React。只设计桌面 Web，不制作移动端或其他客户端。没有 Vue 依赖，面向桌面 Web；没有运行旧服务。

直接双击 `prototype/index.html` 即可离线审核；JS、CSS、React 运行时均在 HTML 内，无 CDN、字体下载或 API 调用。

## 开发与构建

需要 Node.js 22.12+（本机已验证 22.23.3）。

```bash
cd /mnt/mydrive/project/medical-report-qc/frontend
npm ci
npm run dev
```

开发地址以 Vite 输出为准。重新生成离线文件：

```bash
npm run build
```

`build` 先做 TypeScript 检查，再构建 Vite 产物，最后运行无额外依赖的内联脚本，生成 `prototype/index.html`。`dist/` 可用于常规静态部署；本次交付仅供审核，不部署服务。

## 审核页面

- 工作台：报告完整性、异常与待复核统计，最近报告。
- 单份质控：输入与校验，默认四项检查，可切换选择；打开内置示例结果。
- 批量任务：导入弹窗、列映射、预览、模拟进度、取消、筛选、失败分支模拟重试。
- 报告详情：原文只读、四项结果、片段对照、RAG Top-10 参考报告全文与来源记录、折叠审计记录。
- 人工复核：接受、驳回、编辑确认、暂缓；独立保存人工选择。
- 运行配置：默认检查、在线模型配置与本地模型部署方案。

所有数据、知识条目、模型结果和进度均为内置合成示例，未连接真实后端。输入的文本不用于生成结果；上传文件只显示文件名，不读取内容。演示创建的批次预览固定的四项全选结果，并非所上传文件的实际质控结果。

状态只保存在浏览器内存，刷新重置。可下载真实 CSV 格式的示例和模板；正式系统的 XLSX 导出、持久化、模型预检、队列与推理均尚未实现。没有创建登录或密码界面，没有收集或存储 API 密钥。

## 视觉复用来源

从 `/mnt/mydrive/project/llama_med_webui/frontend/src/studio/` 的既有 Vue 界面中提取视觉规则，以 React 重新实现：

- `StudioShell.vue` / `studio.css`：CDU-MED 品牌、浅色 256px 固定侧栏、80px 折叠侧栏、顶部工具栏、字体及颜色间距。
- `Dashboard.vue`：白色面板、状态标签、指标与报告表格。
- `Batch.vue`：文件导入区域、任务表格与进度展示。
- `Annotation.vue`：原文与建议对照、人工复核交互层级。

组件路径为 `src/components/`，基础 UI 在 `src/components/ui/`；页面在 `src/pages/`，合成数据在 `src/data/demo.ts`，共享 TypeScript 契约在 `src/types.ts`。`src/styles.css` 保留已确定的 Studio 视觉 token，并结合 Tailwind utility。复用的是样式和交互语言，不是旧 Vue 实现、模型链路或同步请求逻辑。

RAG 参考报告抽屉按排名直接展示完整正文、报告编号、来源文件及记录位置，关联当前待检报告；原型内置十份合成报告用于审核，不代表已经运行真实检索。
