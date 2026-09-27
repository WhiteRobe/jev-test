# jev-test

一个基于 React + Vite 的综合测验 Web 应用，使用 Cloudflare Wrangler 部署为纯静态站点。

## 技术栈与目录

- React 19 + TypeScript + Vite，纯前端实现；Cloudflare Wrangler 以静态资源（assets-only）部署，无 Worker 后端。

| 路径 | 说明 |
| --- | --- |
| `src/questions.ts` | 题库（判断 / 单选 / 图形 / 滑块 / 长按五种题型）与题型类型定义 |
| `src/App.tsx` | 介绍页、答题页（三栏布局）、评分页；抽题与判分逻辑 |
| `src/styles.css` | 全部样式，响应式并适配深色模式 |
| `wrangler.jsonc` | 静态资源目录配置（不含任何密钥） |
| `wrangler.publish.example.jsonc` | 自定义域名发布配置模板（复制为 `wrangler.publish.jsonc` 后使用） |


## 题目构成（题库 170 题，每次随机抽 30 题，每题 5 分，满分 150 / 折合百分制）

题库共 170 题，分四个板块；每次开始答题时随机抽取 30 题（**每个板块保底至少 3 题**，剩余 18 题全库随机），会话内重新顺序编号：

1. **判断对错**（50 题）：技术常识、简单数学、文字与成语、古诗词、综合常识判断题。
2. **单项选择**（50 题）：四选一，含工程情景判断、简单数学、文字成语、古诗词与百科常识。
3. **图形点选**（50 题）：点选指定的纯色按钮、emoji 按钮或 CSS 几何形状（颜色 + 形状 / 大小组合）。
4. **人机交互检测**（20 题）：
   - 滑块移动（10 题）：把滑块精确拖动（或用方向键微调）到题干指定数值；
   - 长按检测（10 题）：在指定颜色的按钮上连续长按 3 秒（Pointer Events，支持触屏 / 鼠标 / 空格回车，中途松开或按错颜色判错）。

每次开始都重新随机抽题，且每题选项顺序随机打乱；交卷后展示百分制得分、评级、对错统计以及逐题解析（滑块题显示"你的位置 / 正确位置"，长按题标注长按的颜色）。题库定义见 `src/questions.ts`，抽题逻辑见 `src/App.tsx` 的 `pickQuestions()`。

## 本地开发

```bash
npm install
npm run dev        # Vite 开发服务器
npm run typecheck  # 类型检查
npm run build      # 产出 dist/
npm run preview    # 用 wrangler dev 在本地模拟生产环境
```

## 部署

```bash
npm run deploy     # = vite build && wrangler deploy
```

纯静态资源（`wrangler.jsonc` 中 `assets.directory = ./dist`），不需要 Worker 后端。
生产环境的自定义域名配置放在未入库的 `wrangler.publish.jsonc`（已加入 `.gitignore`），
需要发布到自定义域名时使用 `npm run deploy:prod`。
