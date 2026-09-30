# jev-test

一个基于 React + Vite 的综合测验 Web 应用：Cloudflare Worker 提供题目接口 + 静态资源。

## 技术栈与目录

- React 19 + TypeScript + Vite；Cloudflare Wrangler 部署为「Worker + 静态资源」（Worker 只处理 `/api/questions*`，其余交给 assets）。
- **题库只在服务端**：前端不再打包题库，所有题干 / 选项 / 答案都通过 `/api/questions` 拉取（批量或单次，见下）。

| 路径 | 说明 |
| --- | --- |
| `src/questions.ts` | 题库数据（175 题，判断 / 单选 / 图形 / 滑块 / 长按 / 拼图六种题型），**只被服务端引用** |
| `src/questionTypes.ts` | 题目类型定义、抽题常量（题量 / 每题分值等）与纯函数工具 |
| `src/quiz.ts` | 抽题（`pickSlots`）、题位类型 `QuizSlot`、种子 PRNG |
| `src/api.ts` | 前端拉题接口封装（`fetchBankIndex` / `fetchQuestion` / `fetchQuestions`） |
| `src/App.tsx` | 介绍页、答题页（三栏布局）、评分页；拉题模式与抽题 / 判分逻辑 |
| `src/webmcp/` | WebMCP 工具定义与注册生命周期 |
| `src/styles.css` | 全部样式，响应式并适配深色模式 |
| `server/questionApi.ts` | 题目接口处理逻辑（纯函数，Node / Workers 通用） |
| `worker/index.ts` | Cloudflare Worker 入口：`/api/questions*` 走接口，其余走 `env.ASSETS` |
| `vite.config.ts` | Vite 配置 + 本地开发用的 `/api` 中间件（复用 `server/questionApi.ts`） |
| `wrangler.jsonc` | Worker 入口 + 静态资源目录配置（不含任何密钥） |
| `wrangler.publish.example.jsonc` | 自定义域名发布配置模板（复制为 `wrangler.publish.jsonc` 后使用） |

## 题目接口

| 请求 | 返回 | 用途 |
| --- | --- | --- |
| `GET /api/questions?meta=1` | `{ bankSize, quizSize, pointsPerQuestion, questions: [{id,type,section}] }` | 题库索引：只有定位信息，前端据此抽题（不含任何题干） |
| `GET /api/questions` | `{ questions: [Question] }` | 整库题目（调试 / 人工查看用） |
| `GET /api/questions?ids=1,2,3` | `{ questions: [Question] }` | 批量取题 |
| `GET /api/questions/42` | `{ question: Question }` | 单次取题 |
| `?reveal=1` | 额外带上 `answer` / `explanation` | 交卷判分时才用 |

约束：

- 默认**不下发答案与解析**，只有交卷那一刻的 `reveal=1` 请求才带；前端 bundle 里因此完全没有题库和答案。
- 响应 `Cache-Control: no-store`，单次拉题时每次翻页都真的打一次接口，方便观察。
- 出错返回 `{ ok: false, error }` 与对应的 4xx / 405 状态码（题号不存在、ids 非法等）。
- 本地开发时 `npm run dev` 由 Vite 中间件提供同一套接口，`npm run preview`（`wrangler dev`）走真实 Worker。

## 拉题模式：批量拉题（默认）/ 单次拉题

介绍页和答题页顶部都有「拉题模式」开关，选择持久化在 `localStorage`（默认批量）：

也可以通过 URL 参数直接指定，URL 中的有效值优先于 `localStorage`：

- `loadMode=batch`：批量拉题
- `loadMode=single`：单次拉题

| 模式 | 什么时候请求题目 | 一次测验的请求数 |
| --- | --- | --- |
| **批量拉题**（默认） | 点「开始答题」时 `GET /api/questions?ids=<30 个 id>` 一次拿回本次全部题目 | 1 次 + 交卷 1 次（reveal） |
| **单次拉题** | 点题号 / 点「下一题」时才 `GET /api/questions/:id` 请求**这一题** | 每题 1 次（共 30 次）+ 交卷 1 次（reveal） |

单次拉题模式的细节：

- 拉题请求串行排队：连点「下一题」也按顺序一题一题拉，同一题不会重复请求，已拉过的题直接命中本地。
- 题目在路上时题目卡片显示「正在拉取第 N 题…」占位，交互控件不渲染（避免对着一道还没到的题作答）；拉取失败会给出重试按钮。
- 顶部实时显示「已拉取 k/30」。
- 交卷时统一用 `?ids=…&reveal=1` 取回答案与解析再判分（答案本来就不在客户端，只有判分这一刻需要）。
- 注意：单次拉题约束的是**应用自己的请求节奏**，接口本身不鉴权 —— 有心的调用方仍可自己请求整库或指定题号。

## 题目构成（题库 175 题，每次随机抽 30 题，每题 5 分，满分 150 / 折合百分制）

题库共 175 题，分四个板块；每次开始答题时随机抽取 30 题（**每个板块保底至少 4 题**，剩余 14 题全库随机），会话内重新顺序编号：

1. **判断对错**（50 题）：技术常识、简单数学、文字与成语、古诗词、综合常识判断题。
2. **单项选择**（50 题）：四选一，含工程情景判断、简单数学、文字成语、古诗词与百科常识。
3. **图形点选**（50 题）：点选指定的纯色按钮、emoji 按钮或 CSS 几何形状（颜色 + 形状 / 大小组合）。
4. **人机交互检测**（25 题）：
   - 滑块移动（10 题）：把滑块精确拖动（或用方向键微调）到题干指定数值；
   - 长按检测（10 题）：在指定颜色的按钮上连续长按 3 秒（Pointer Events，支持触屏 / 鼠标 / 空格回车，中途松开或按错颜色判错）；
   - 拼图验证码（5 题）：图片中央留一块虚线缺口，把托盘里的缺图块拖到缺口位置松手判定（Pointer Events 拖拽，也可用方向键移动 + 回车 / 空格确认；落点与缺口中心的归一化距离超出容差即判错）。图片为纯 CSS 渐变渲染，拼图块与整图共用同一份渐变、按缺口位置偏移取色，拖到位才接得上。**没拖对会自动复原回托盘、不记录答案，可以一直重拖，拖到对准为止。**

### 「我不知道」按钮

右侧栏在「提交并查看成绩」下方有「我不知道」按钮，任何题型都可用：点击后本题记为已作答（可以交卷、计入进度），
但判分时一定算错，题目卡片上会锁定所有交互控件并提示「本题已按「我不知道」记为答错」；结果页该题显示「你的回答：我不知道」并附上正确答案 / 正确位置 / 缺口位置与解析。

每次开始都重新随机抽题，且每题选项顺序随机打乱；交卷后展示百分制得分、评级、对错统计以及逐题解析（滑块题显示"你的位置 / 正确位置"，拼图题显示"你的落点 / 缺口位置"，长按题标注长按的颜色）。题库定义见 `src/questions.ts`，抽题逻辑见 `src/quiz.ts` 的 `pickSlots()`。
随机种子只影响「抽哪几题、什么顺序」：同一个种子在两种拉题模式下抽到的题目集合与顺序完全一致；选项顺序的随机序列在批量 / 单次模式下消耗时机不同，因此选项排列可能不同。

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

部署为「Worker + 静态资源」：`worker/index.ts` 处理 `/api/questions*`，其余请求由 `assets.directory = ./dist` 的静态资源兜底（SPA fallback）。
生产环境的自定义域名配置放在未入库的 `wrangler.publish.jsonc`（已加入 `.gitignore`），
需要发布到自定义域名时使用 `npm run deploy:prod`。

## WebMCP 模式（实验）

页面右上角有「普通模式 / WebMCP 模式」开关，选择持久化在 `localStorage`（默认普通模式）。
也可以通过 URL 参数直接指定：`mode=normal` 或 `mode=webmcp`。两个模式开关在页面内发生变化时，地址栏参数会同步更新，复制 URL 即可复现当前组合。
WebMCP 模式下通过命令式 API（`document.modelContext.registerTool`）按页面阶段向 AI 智能体注册结构化答题工具，与"模拟点击"的 GUI 促动赛道对应：

- 介绍页：`get_app_state`、`start_quiz`（支持随机种子）
- 答题页：`get_current_question`、`answer_current_question`、`go_to_question`、`get_progress`、`submit_quiz`
- 结果页：`get_result_summary`、`get_question_review`

约束：工具只能作答当前题（须先 `go_to_question` 跳转）；交卷前任何工具返回都不含正确答案与解析；
`start_quiz` / `go_to_question` / `submit_quiz` 都会**等到题目拉取完成才 resolve**（单次拉题模式下 `go_to_question` 即触发该题的接口请求），
因此单次拉题时智能体也必须一题一题地走；当前题还没拉到时，工具会返回「第 N 题正在从 /api/questions 拉取中，稍后重试」；
`get_app_state` 会带上 `loadMode` 与 `currentQuestionLoading`；
长按题由工具驱动一次真实的 3 秒按压（界面上可见倒计时，中途取消则不记录答案）；
拼图题传 `x` / `y`（图片内 0–1 的比例坐标），由工具把拼图块真实拖到该点松手；没对准缺口则图块复原、工具报错且不记录答案（可重试），
中途取消同样不记录答案；任何题都可传 `optionId: "unknown"` 记录「我不知道」（视同已作答但判错）；
工具操作会在页面上高亮反馈。开关关闭或浏览器不支持时，应用行为与普通模式完全一致，不注册任何工具。

本地调试（Chrome 149+，API 处于 Origin Trial）：

1. 打开 `chrome://flags/#enable-webmcp-testing` 启用并**完全重启 Chrome**（`Cmd+Q`，只刷新页面不生效）；
2. `npm run dev` 后在页面右上角切到 WebMCP 模式；
3. 安装 Model Context Tool Inspector 扩展，查看注册的工具、校验 JSON Schema 并手动调用。

开关不可用时把鼠标悬停在「WebMCP 模式」上会给出具体原因（非安全上下文 / 非 Chrome / 未开 flag）；
页面在打开 flag 之前就已加载的话，切回标签页时会自动重新探测，也可以直接刷新。

自检一行命令：`typeof document.modelContext` 返回 `"object"` 才说明当前文档拿到了 API。
注意这行必须在 **jev-test 这个标签页**的控制台里执行（其它站点的结果不作数），且要带 `https://` 或 `localhost`。

工具定义见 `src/webmcp/tools.ts`，注册 / 注销生命周期见 `src/webmcp/useWebMcpTools.ts`。
将来正式部署时还需在 `index.html` 配置 Origin Trial token（本次未包含）。

