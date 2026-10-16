# 医学报告质控 Web

React + TypeScript + Vite + Tailwind CSS，桌面Web，保留浅色256/80px固定侧栏和已批准布局，无登录页。

```bash
cd /mnt/mydrive/project/medical-report-qc/frontend
npm ci
npm run dev       # http://127.0.0.1:5174；/api代理至5100
npm run test
npm run build     # 生产dist，不生成或加载示例结果
npm run test:e2e  # 独立测试API/MySQL + Chrome；需5100/5174空闲
```

生产入口`src/App.tsx`连接真实报告、上传、任务、证据、人工复核及异步XLSX API。任务URL保存run/report/branch标识；刷新从后端恢复。HTTP200/error显示detail，无样例降级。除侧栏偏好与上次导入ID，浏览器不存业务事实或API密钥。

API类型：`src/api/generated.ts`来自后端OpenAPI，`types.ts`别名复用生成DTO并定义展示结构。后端变更后先导出schema，再 `npm run generate:api`；生成器使用隔离固定版本工具（兼容工具依赖TS5，不改变项目TS7）。

离线审核原型独立保存在`src/prototype/`；`npm run build:prototype`生成 `prototype/index.html`（内置合成数据），与生产dist隔离。原型不得当作实际模型输出。`src/data/`旧演示文件未进入生产依赖图，有自动化测试验证。

[后端与部署说明](../docs/operations.md) · [验收说明](../docs/acceptance/README.md)
