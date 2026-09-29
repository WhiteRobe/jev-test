import { useLayoutEffect, useEffect, useMemo, useRef, useState } from "react";
import {
  BANK_SIZE,
  POINTS_PER_QUESTION,
  QUESTIONS,
  QUIZ_SIZE,
  UNKNOWN_ANSWER,
  formatPuzzlePoint,
  parsePuzzlePoint,
  puzzleHit,
  type GraphicVisual,
  type PuzzleScene,
  type PuzzleSpec,
  type Question,
  type QuestionOption,
  type SliderSpec,
} from "./questions";
import {
  type LongPressDriver,
  type PuzzleDriver,
  type QuizActions,
  type QuizSnapshot,
} from "./webmcp/tools";
import { useWebMcpTools } from "./webmcp/useWebMcpTools";

type Phase = "intro" | "quiz" | "result";

/** WebMCP 模式开关的 localStorage key */
const WEBMCP_STORAGE_KEY = "jev-test:webmcp-mode";

const SECTION_ORDER = ["判断对错", "单项选择", "图形点选", "人机交互检测"];
/** 每次测验每个题型保底出现的题数（4 × 4 = 16，其余 14 题全库随机） */
const PER_SECTION_MIN = 4;

const CLIP_PATHS: Record<string, string> = {
  triangle: "polygon(50% 0%, 100% 100%, 0% 100%)",
  pentagon: "polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)",
  hexagon: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
  star: "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
};

/** 拼图场景 → CSS 背景：整张"图片"与拼图块共用同一份渐变，拼图块靠 background 偏移取到缺口的像素 */
const puzzleBackground = (scene: PuzzleScene) =>
  `radial-gradient(circle at ${scene.accentX * 100}% ${scene.accentY * 100}%, ${scene.accent} 0%, transparent ${scene.accentR * 100}%), ` +
  `linear-gradient(160deg, ${scene.from} 0%, ${scene.to} 100%)`;

/** 拼图块 / 缺口边长（px） */
const PUZZLE_TILE = 46;
/** 托盘与图片的间距、托盘高度（px），两者共同决定拼图块的静止位置 */
const TRAY_MARGIN = 18;
const TRAY_HEIGHT = 72;
/** 键盘微调的步长（小步精调 / Shift 大步） */
const KEY_STEP = 0.02;
const KEY_STEP_BIG = 0.1;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * 探测浏览器是否暴露 WebMCP API。
 * 两种常见拿不到的情况：非 Chrome 149+ / 未开 chrome://flags/#enable-webmcp-testing；
 * 以及用 http:// 访问（WebMCP 只在安全上下文暴露，Chrome 会把 http 自动升级为 https，
 * 但若升级失败或被策略拦截，document 上就没有这个属性）。
 */
function detectWebMcpSupport(): boolean {
  return typeof document !== "undefined" && "modelContext" in document;
}

/** 拼图落点的文字描述（结果页回看用） */
const puzzlePointText = (point: { x: number; y: number }) =>
  `横向 ${(point.x * 100).toFixed(1)}% / 纵向 ${(point.y * 100).toFixed(1)}%`;

function shuffle<T>(items: T[], rand: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** 字符串种子 → 32 位无符号整数（FNV-1a） */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 确定性伪随机数生成器：同一种子永远产生同一序列 */
export function mulberry32(seedNum: number): () => number {
  let a = seedNum;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 从总题库随机抽 QUIZ_SIZE 题：
 * 每个板块先保底抽 PER_SECTION_MIN 题，剩余名额在全题库范围内随机补齐，最后打乱顺序并重新编号。
 * rand 可注入：默认 Math.random（每次不同），传入种子 PRNG 时结果可复现。
 */
export function pickQuestions(rand: () => number = Math.random): Question[] {
  const picked: Question[] = [];
  for (const section of SECTION_ORDER) {
    const pool = shuffle(QUESTIONS.filter((q) => q.section === section), rand);
    picked.push(...pool.slice(0, PER_SECTION_MIN));
  }
  const restPool = shuffle(QUESTIONS.filter((q) => !picked.includes(q)), rand);
  picked.push(...restPool.slice(0, QUIZ_SIZE - PER_SECTION_MIN * SECTION_ORDER.length));
  return shuffle(picked, rand).map((q, index) => ({ ...q, id: index + 1 }));
}

function Shape({ visual, small = false }: { visual: GraphicVisual; small?: boolean }) {
  const size = small ? 22 : visual.size ?? 56;
  const base: React.CSSProperties = {
    width: size,
    height: size,
    background: visual.color ?? "#6366f1",
    display: "inline-block",
  };
  if (visual.kind === "color") {
    return <span className={`visual-color${small ? " small" : ""}`} style={{ background: visual.color }} />;
  }
  if (visual.kind === "emoji") {
    return <span className={`visual-emoji${small ? " small" : ""}`}>{visual.emoji}</span>;
  }
  if (visual.shape === "circle") {
    return <span className="visual-shape" style={{ ...base, borderRadius: "50%" }} />;
  }
  if (visual.shape === "square") {
    return <span className="visual-shape" style={{ ...base, borderRadius: 6 }} />;
  }
  return <span className="visual-shape" style={{ ...base, clipPath: CLIP_PATHS[visual.shape ?? "triangle"] }} />;
}

function gradeOf(percent: number) {
  if (percent >= 90) return { title: "优秀 🏆", note: "掌握得非常扎实，继续保持！" };
  if (percent >= 75) return { title: "良好 👍", note: "整体不错，少量知识点再巩固一下。" };
  if (percent >= 60) return { title: "及格 🙂", note: "基础尚可，建议回顾答错的题目。" };
  return { title: "继续加油 💪", note: "别灰心，对照解析再来一次吧。" };
}

export function App() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [current, setCurrent] = useState(0);
  // 主界面上的随机种子输入（留空 = 每次真随机；填写后同一抽题结果可复现）
  const [seedInput, setSeedInput] = useState("");
  // 本次测验的题目：进入页面时先抽一套，点击“开始答题 / 再测一次”会重新随机抽取
  const [quizQuestions, setQuizQuestions] = useState<Question[]>(() => pickQuestions());

  // 每次开始答题时随机打乱每题的选项顺序，防止背位置
  const [optionsOrder, setOptionsOrder] = useState<QuestionOption[][]>(() =>
    quizQuestions.map((q) => shuffle(q.options)),
  );

  // WebMCP（结构化工具）模式开关；持久化到 localStorage，默认关闭
  const [webmcpMode, setWebmcpMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(WEBMCP_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  // 不支持 document.modelContext 的浏览器（非 Chrome 149+ / 未开 flag）开关会锁定
  // 注意：WebMCP 只在安全上下文（https / localhost）暴露，http 访问会被浏览器自动判为不支持
  const [webmcpSupported, setWebmcpSupported] = useState(() => detectWebMcpSupport());
  // 页面可能是在打开 flag 之前加载的，切回前台时重新探测一次，避免必须手动刷新
  useEffect(() => {
    const recheck = () => setWebmcpSupported(detectWebMcpSupport());
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, []);

  // 工具调用时被操作元素的短暂高亮目标（"slider" / "option:<id>"），让工具执行可见
  const [flashTarget, setFlashTarget] = useState<string | null>(null);
  const flashTimerRef = useRef<number | undefined>(undefined);
  // 长按题组件注册上来的命令式驱动（仅当前题为长按题时非空）
  const lpDriverRef = useRef<LongPressDriver | null>(null);
  // 拼图题组件注册上来的命令式驱动（仅当前题为拼图题时非空）
  const pzDriverRef = useRef<PuzzleDriver | null>(null);

  const question = quizQuestions[current];
  const answeredCount = Object.keys(answers).length;
  const totalScore = quizQuestions.length * POINTS_PER_QUESTION;
  const allAnswered = answeredCount === quizQuestions.length;

  const startQuiz = (seed?: string) => {
    // 种子为空时真随机；非空时同一种子 → 同一随机序列（题目与选项顺序都可复现）
    const trimmed = (seed ?? "").trim();
    const rand = trimmed ? mulberry32(hashSeed(trimmed)) : Math.random;
    const picked = pickQuestions(rand);
    setQuizQuestions(picked);
    setOptionsOrder(picked.map((q) => shuffle(q.options, rand)));
    setAnswers({});
    setCurrent(0);
    setPhase("quiz");
    window.scrollTo(0, 0);
  };

  const choose = (optionId: string) => {
    setAnswers((prev) => ({ ...prev, [question.id]: optionId }));
  };

  /** 「我不知道」：记入哨兵答案，视同已作答但判错 */
  const giveUp = () => {
    if (answers[question.id] !== undefined) return;
    choose(UNKNOWN_ANSWER);
    flash("giveup");
  };

  const goTo = (index: number) => {
    setCurrent(index);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const result = useMemo(() => {
    const detail = quizQuestions.map((q) => {
      const chosenId = answers[q.id];
      // 「我不知道」：视同已作答，但一定判错
      if (chosenId === UNKNOWN_ANSWER) {
        const correct = q.options.find((o) => o.id === q.answer);
        return { question: q, chosen: undefined, correct, unknown: true, isRight: false };
      }
      if (q.type === "slider" && q.slider) {
        const chosenNum = chosenId === undefined ? undefined : Number(chosenId);
        const tolerance = q.slider.tolerance ?? 0;
        const isRight =
          chosenNum !== undefined && Math.abs(chosenNum - q.slider.target) <= tolerance;
        return { question: q, chosen: undefined, correct: undefined, chosenNum, isRight };
      }
      if (q.type === "puzzle" && q.puzzle) {
        const point = chosenId === undefined ? undefined : parsePuzzlePoint(chosenId);
        const isRight = point !== undefined && puzzleHit(q.puzzle, point);
        return { question: q, chosen: undefined, correct: undefined, point, isRight };
      }
      const chosen = q.options.find((o) => o.id === chosenId);
      const correct = q.options.find((o) => o.id === q.answer)!;
      return { question: q, chosen, correct, chosenNum: undefined, isRight: chosenId === q.answer };
    });
    const rightCount = detail.filter((d) => d.isRight).length;
    const score = rightCount * POINTS_PER_QUESTION;
    const percent = Math.round((score / totalScore) * 100);
    return { detail, rightCount, score, percent };
  }, [answers, quizQuestions, totalScore]);

  // ---------- WebMCP 模式：快照 / 动作桥 / 工具注册 ----------
  const toggleWebMcp = (on: boolean) => {
    setWebmcpMode(on);
    try {
      localStorage.setItem(WEBMCP_STORAGE_KEY, on ? "1" : "0");
    } catch {
      /* localStorage 不可用时仅本次会话生效 */
    }
  };

  const flash = (target: string) => {
    setFlashTarget(target);
    if (flashTimerRef.current !== undefined) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setFlashTarget(null), 800);
  };

  const getSnapshot = (): QuizSnapshot => ({
    phase,
    current,
    questions: quizQuestions,
    optionsOrder,
    answers,
    result:
      phase === "result"
        ? {
            percent: result.percent,
            score: result.score,
            rightCount: result.rightCount,
            gradeTitle: gradeOf(result.percent).title,
            detail: result.detail,
          }
        : undefined,
  });

  const actions: QuizActions = {
    startQuiz: (seed) => startQuiz(seed),
    answerCurrent: ({ optionId, value }) => {
      if (optionId !== undefined) choose(optionId);
      else if (value !== undefined) choose(String(value));
    },
    goToQuestion: (number1) => goTo(number1 - 1),
    submit: () => setPhase("result"),
    giveUp: () => giveUp(),
    longPress: (optionId, signal) => {
      const driver = lpDriverRef.current;
      if (!driver) return Promise.reject(new Error("当前题不支持长按操作"));
      return driver.press(optionId, signal).then(() => {
        // 按压走完（答案已记录），给目标按钮补一个可见高亮
        flash(`option:${optionId}`);
      });
    },
    puzzleDrop: (x, y, signal) => {
      const driver = pzDriverRef.current;
      if (!driver) return Promise.reject(new Error("当前题不支持拼图拖动"));
      return driver.drop(x, y, signal).then(() => {
        // 拖动落点已记录，给拼图区补一个可见高亮
        flash("puzzle");
      });
    },
    flash,
  };

  useWebMcpTools(webmcpMode, phase, getSnapshot, actions);

  // ---------- 介绍页 ----------
  let content: React.ReactNode;
  if (phase === "intro") {
    content = (
      <div className="page">
        <div className="card intro-card">
          <div className="badge">jev-test</div>
          {webmcpMode && (
            <div className="mode-banner">
              WebMCP 模式已开启：本页面向 AI 智能体注册了结构化答题工具，可用 Model Context Tool
              Inspector 扩展查看与调试。
            </div>
          )}
          <h1>综合知识小测验</h1>
          <p className="intro-desc">
            题库共 {BANK_SIZE} 题 · 每次随机抽取 {QUIZ_SIZE} 题 · 满分 {totalScore} 分（折合百分制）· 每题{" "}
            {POINTS_PER_QUESTION} 分
          </p>
          <div className="section-grid">
            {SECTION_ORDER.map((name, idx) => {
              const count = quizQuestions.filter((q) => q.section === name).length;
              return (
                <div className="section-item" key={name}>
                  <span className="section-index">{idx + 1}</span>
                  <div>
                    <div className="section-name">{name}</div>
                    <div className="section-count">{count} 题</div>
                  </div>
                </div>
              );
            })}
          </div>
          <ul className="intro-tips">
            <li>判断题与单选题点击文字选项，图形题点击对应图案。</li>
            <li>人机交互检测题：把滑块精确移动到指定数值，或在指定颜色按钮上连续长按 3 秒（中途松开 / 按错判错）。</li>
            <li>拼图验证码：把托盘里的缺图块拖到图片中的虚线缺口位置，松手即判定（偏出缺口太多算没对齐）。</li>
            <li>
              拼图没拖对会自动复原、可以反复重拖，只有拖到缺口才算作答。
            </li>
            <li>
              任何题都可以点右侧的「我不知道」直接作答：视同已作答（能交卷），但本题计为错误。
            </li>
            <li>
              每次开始都从 {BANK_SIZE} 题题库中随机抽 {QUIZ_SIZE} 题，{SECTION_ORDER.length}{" "}
              类题型每类至少出现 {PER_SECTION_MIN} 题，每题选项顺序也随机生成。
            </li>
            <li>答完可前后翻页检查，全部作答后即可提交，查看总分、评级和逐题解析。</li>
          </ul>
          <div className="seed-box">
            <label htmlFor="seed-input" className="seed-label">
              随机种子（选填）
            </label>
            <input
              id="seed-input"
              type="text"
              className="seed-input"
              value={seedInput}
              onChange={(event) => setSeedInput(event.target.value)}
              placeholder="留空每次完全随机；填写相同种子会抽到同一套题"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <button type="button" className="btn primary large" onClick={() => startQuiz(seedInput)}>
            开始答题
          </button>
        </div>
      </div>
    );
  } else if (phase === "result") {
    const grade = gradeOf(result.percent);
    content = (
      <div className="page">
        <div className="card result-card">
          <div className="score-ring" style={{ "--percent": `${result.percent}%` } as React.CSSProperties}>
            <div className="score-num">{result.percent}</div>
            <div className="score-unit">分（百分制）</div>
          </div>
          <h2>{grade.title}</h2>
          <p className="result-summary">
            原始得分 <strong>{result.score}</strong> / {totalScore} · 答对{" "}
            <strong>{result.rightCount}</strong> 题 · 答错{" "}
            <strong>{quizQuestions.length - result.rightCount}</strong> 题
          </p>
          <p className="result-note">{grade.note}</p>

          <div className="review-list">
            {result.detail.map(
              ({ question: q, chosen, correct, chosenNum, point, unknown, isRight }, idx) => (
              <div className={`review-item ${isRight ? "right" : "wrong"}`} key={q.id}>
                <div className="review-head">
                  <span className="review-no">{idx + 1}</span>
                  <span className="review-tag">{q.section}</span>
                  <span className={`review-status ${isRight ? "right" : "wrong"}`}>
                    {isRight ? "✓ 正确" : "✗ 错误"}
                  </span>
                </div>
                <div className="review-prompt">{q.prompt}</div>
                {unknown ? (
                  <>
                    <div className="review-answer">
                      <span className="answer-label">你的回答：</span>
                      <span className="text-wrong">我不知道</span>
                    </div>
                    {q.type === "slider" && q.slider && (
                      <div className="review-answer">
                        <span className="answer-label">正确位置：</span>
                        <span className="text-right">
                          {q.slider.target}
                          {q.slider.unit ?? ""}
                        </span>
                      </div>
                    )}
                    {q.type === "puzzle" && q.puzzle && (
                      <div className="review-answer">
                        <span className="answer-label">缺口位置：</span>
                        <span className="text-right">
                          {puzzlePointText({ x: q.puzzle.gapX, y: q.puzzle.gapY })}
                        </span>
                      </div>
                    )}
                    {q.type !== "slider" && q.type !== "puzzle" && correct && (
                      <div className="review-answer">
                        <span className="answer-label">正确答案：</span>
                        <span className="text-right">
                          <AnswerVisual option={correct} />
                        </span>
                      </div>
                    )}
                  </>
                ) : q.type === "puzzle" && q.puzzle ? (
                  <>
                    <div className="review-answer">
                      <span className="answer-label">你的落点：</span>
                      <span className={isRight ? "text-right" : "text-wrong"}>
                        {point === undefined ? "未作答" : puzzlePointText(point)}
                      </span>
                    </div>
                    {!isRight && (
                      <div className="review-answer">
                        <span className="answer-label">缺口位置：</span>
                        <span className="text-right">
                          {puzzlePointText({ x: q.puzzle.gapX, y: q.puzzle.gapY })}
                        </span>
                      </div>
                    )}
                  </>
                ) : q.type === "slider" && q.slider ? (
                  <>
                    <div className="review-answer">
                      <span className="answer-label">你的位置：</span>
                      <span className={isRight ? "text-right" : "text-wrong"}>
                        {chosenNum === undefined ? "未作答" : `${chosenNum}${q.slider.unit ?? ""}`}
                      </span>
                    </div>
                    {!isRight && (
                      <div className="review-answer">
                        <span className="answer-label">正确位置：</span>
                        <span className="text-right">
                          {q.slider.target}
                          {q.slider.unit ?? ""}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="review-answer">
                      <span className="answer-label">你的回答：</span>
                      <span className={isRight ? "text-right" : "text-wrong"}>
                        {chosen ? <AnswerVisual option={chosen} /> : "未作答"}
                      </span>
                    </div>
                    {!isRight && correct && (
                      <div className="review-answer">
                        <span className="answer-label">正确答案：</span>
                        <span className="text-right">
                          <AnswerVisual option={correct} />
                        </span>
                      </div>
                    )}
                  </>
                )}
                <div className="review-explanation">💡 {q.explanation}</div>
              </div>
              ),
            )}
          </div>

          <button type="button" className="btn primary large" onClick={() => startQuiz()}>
            再测一次（重新抽题）
          </button>
        </div>
      </div>
    );
  } else {
    // ---------- 答题页 ----------
    const sectionIndex = SECTION_ORDER.indexOf(question.section);
    const isLast = current === quizQuestions.length - 1;
    const selected = answers[question.id];
    // 点了「我不知道」：本题按答错锁定，交互控件不再改动答案
    const gaveUp = selected === UNKNOWN_ANSWER;

    content = (
    <div className="page">
      <div className="quiz-top">
        <div className="progress-meta">
          <span>
            第 <strong>{current + 1}</strong> / {quizQuestions.length} 题
          </span>
          <span className="progress-count">已答 {answeredCount} 题</span>
        </div>
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: `${((current + 1) / quizQuestions.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="quiz-shell">
        {/* 左侧：题号导航（两列） */}
        <aside className="rail rail-left card">
          <div className="pager pager-cols">
            {quizQuestions.map((q: Question, idx) => {
              const state =
                answers[q.id] === undefined ? "unanswered" : idx === current ? "current" : "done";
              return (
                <button
                  type="button"
                  key={q.id}
                  className={`pager-dot ${state}`}
                  onClick={() => goTo(idx)}
                  title={`第 ${idx + 1} 题`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
        </aside>

        {/* 中间：题目卡片 */}
        <div className="card question-card">
          <div className="question-head">
            <span className={`question-section section-color-${sectionIndex}`}>
              {sectionIndex + 1}. {question.section}
            </span>
          </div>
          <h2 className="question-prompt">{question.prompt}</h2>

          {question.type === "slider" && question.slider ? (
            <SliderAnswer
              spec={question.slider}
              value={selected === undefined || gaveUp ? undefined : Number(selected)}
              onChange={(value) => choose(String(value))}
              disabled={gaveUp}
              agentFlash={flashTarget === "slider"}
            />
          ) : question.type === "puzzle" && question.puzzle ? (
            <PuzzleAnswer
              spec={question.puzzle}
              value={gaveUp ? undefined : selected}
              onChange={choose}
              disabled={gaveUp}
              registerDriver={(driver) => {
                pzDriverRef.current = driver;
              }}
              agentFlash={flashTarget === "puzzle"}
            />
          ) : question.type === "longpress" ? (
            <LongPressAnswer
              options={optionsOrder[current]}
              duration={question.holdDuration ?? 3000}
              targetId={question.answer}
              value={gaveUp ? undefined : selected}
              onChange={choose}
              disabled={gaveUp}
              registerDriver={(driver) => {
                lpDriverRef.current = driver;
              }}
            />
          ) : (
            <div
              className={
                question.type === "graphic"
                  ? "options options-graphic"
                  : question.type === "truefalse"
                    ? "options options-tf"
                    : "options"
              }
            >
              {optionsOrder[current].map((option) => {
                const active = selected === option.id;
                return (
                  <button
                    type="button"
                    key={option.id}
                    className={`option ${active ? "selected" : ""} ${
                      question.type === "graphic" ? "option-graphic" : ""
                    } ${flashTarget === `option:${option.id}` ? "agent-flash" : ""}`}
                    onClick={() => choose(option.id)}
                    disabled={gaveUp}
                    aria-pressed={active}
                  >
                    {question.type !== "graphic" && (
                      <span className={`option-key ${active ? "selected" : ""}`}>
                        {question.type === "single"
                          ? option.id
                          : option.id === "T"
                            ? "✓"
                            : "✗"}
                      </span>
                    )}
                    {question.type === "graphic" ? (
                      <Shape visual={option.visual!} />
                    ) : (
                      <span className="option-text">{option.text}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {gaveUp && (
            <div className="giveup-note">本题已按「我不知道」记为答错，可翻页继续。</div>
          )}
        </div>

        {/* 右侧：翻页 + 交卷 */}
        <aside className="rail rail-right">
          <button
            type="button"
            className="btn ghost rail-btn"
            onClick={() => goTo(current - 1)}
            disabled={current === 0}
          >
            ↑ 上一题
          </button>
          <button
            type="button"
            className="btn primary rail-btn"
            onClick={() => goTo(current + 1)}
            disabled={isLast}
          >
            下一题 ↓
          </button>
          <button
            type="button"
            className="btn primary rail-btn submit-btn"
            onClick={() => setPhase("result")}
            disabled={!allAnswered}
            title={allAnswered ? "提交并查看成绩" : `还有 ${quizQuestions.length - answeredCount} 题未作答`}
          >
            {allAnswered ? "提交并查看成绩" : `还差 ${quizQuestions.length - answeredCount} 题`}
          </button>
          <button
            type="button"
            className={`btn ghost rail-btn giveup-btn ${
              flashTarget === "giveup" ? "agent-flash" : ""
            }`}
            onClick={giveUp}
            disabled={selected !== undefined}
            title="不会做也可以作答：视同已作答，但本题计为错误"
          >
            我不知道
          </button>
        </aside>
      </div>
    </div>
    );
  }

  return (
    <>
      {content}
      <ModeToggle supported={webmcpSupported} mode={webmcpMode} onChange={toggleWebMcp} />
    </>
  );
}

/** 按钮不可用时，把「为什么」讲清楚（省得只能靠猜） */
function supportHint(): string {
  if (!isSecureContext) return "当前不是安全上下文，请用 https:// 或 localhost 访问";
  if (!/Chrome|Edg\//.test(navigator.userAgent)) {
    return "需要 Chrome 149+（含 Chromium 内核）";
  }
  return "需要 Chrome 149+ 并在 chrome://flags/#enable-webmcp-testing 开启后重启浏览器";
}

/** 右上角固定的普通 / WebMCP 模式分段开关 */
function ModeToggle({
  mode,
  supported,
  onChange,
}: {
  mode: boolean;
  supported: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className={`mode-switch${mode ? " on" : ""}`} role="group" aria-label="答题模式切换">
      <button
        type="button"
        className={!mode ? "active" : ""}
        onClick={() => onChange(false)}
        aria-pressed={!mode}
      >
        普通模式
      </button>
      <button
        type="button"
        className={mode ? "active" : ""}
        disabled={!supported}
        aria-pressed={mode}
        title={
          supported
            ? "切换到 WebMCP 模式：向 AI 智能体开放结构化答题工具"
            : `当前浏览器未暴露 WebMCP API（${supportHint()}）`
        }
        onClick={() => onChange(true)}
      >
        WebMCP 模式
        {mode && supported && <span className="mode-live-dot" aria-hidden="true" />}
      </button>
    </div>
  );
}

function AnswerVisual({ option }: { option: QuestionOption }) {
  if (!option.visual) return <>{option.label}</>;
  return (
    <span className="answer-visual">
      <Shape visual={option.visual} small />
      {option.visual.kind === "emoji" ? "" : option.label}
    </span>
  );
}

function SliderAnswer({
  spec,
  value,
  onChange,
  disabled = false,
  agentFlash = false,
}: {
  spec: SliderSpec;
  value: number | undefined;
  onChange: (value: number) => void;
  /** 点了「我不知道」时锁定，不再改动答案 */
  disabled?: boolean;
  /** 由 WebMCP 工具设值时短暂高亮 */
  agentFlash?: boolean;
}) {
  // 未作答时滑块停在量程中点，仅作为展示位置，不计答案
  const display = value ?? Math.round((spec.min + spec.max) / 2);
  const percent = ((display - spec.min) / (spec.max - spec.min)) * 100;
  const unit = spec.unit ?? "";
  return (
    <div className={`slider-block${agentFlash ? " agent-flash" : ""}`}>
      <div className="slider-readout">
        {disabled ? "本题已放弃" : value === undefined ? "未作答" : `${display}${unit}`}
      </div>
      <input
        type="range"
        className="slider-input"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={display}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ "--fill": `${percent}%` } as React.CSSProperties}
        disabled={disabled}
        aria-label="滑块作答"
      />
      <div className="slider-scale">
        <span>
          {spec.min}
          {unit}
        </span>
        <span>
          {spec.max}
          {unit}
        </span>
      </div>
      <div className="slider-hint">
        {disabled ? "本题已按「我不知道」记为答错" : "拖动滑块，或点击后用键盘 ← → 方向键微调"}
      </div>
    </div>
  );
}

function LongPressAnswer({
  options,
  duration,
  targetId,
  value,
  onChange,
  disabled = false,
  registerDriver,
}: {
  options: QuestionOption[];
  duration: number;
  targetId: string;
  value: string | undefined;
  onChange: (optionId: string) => void;
  /** 点了「我不知道」时锁定，不再改动答案 */
  disabled?: boolean;
  /** 注册命令式驱动，供 WebMCP 工具发起真实按压 */
  registerDriver?: (driver: LongPressDriver | null) => void;
}) {
  const [heldId, setHeldId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);
  const startRef = useRef(0);
  const heldRef = useRef<string | null>(null);
  // 工具发起按压时，用这对 ref 把按压结果回传给 promise
  const resolveRef = useRef<(() => void) | null>(null);
  const rejectRef = useRef<((error: Error) => void) | null>(null);
  // locked：本题不能再交互（已作答或点了「我不知道」）；
  // 只有真正作答过（value 有值）时才在界面上标出对错与正确答案
  const locked = value !== undefined || disabled;

  const cancelRaf = () => {
    if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    rafRef.current = undefined;
  };

  const tick = () => {
    const id = heldRef.current;
    if (!id) return;
    const ratio = Math.min(1, (performance.now() - startRef.current) / duration);
    setProgress(ratio);
    if (ratio >= 1) {
      cancelRaf();
      heldRef.current = null;
      setHeldId(null);
      onChange(id);
      resolveRef.current?.();
      resolveRef.current = null;
      rejectRef.current = null;
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  const startHold = (id: string) => {
    if (locked || heldRef.current) return;
    heldRef.current = id;
    startRef.current = performance.now();
    setHeldId(id);
    setProgress(0);
    cancelRaf();
    rafRef.current = requestAnimationFrame(tick);
  };

  const cancelHold = () => {
    if (!heldRef.current) return;
    cancelRaf();
    heldRef.current = null;
    setHeldId(null);
    setProgress(0);
    // 若本次按压由工具发起，按“中途松开”处理：不记录答案并让工具调用失败
    rejectRef.current?.(new Error("长按在完成前被松开（或被取消），本次未记录答案"));
    resolveRef.current = null;
    rejectRef.current = null;
  };

  // 向 App 注册工具驱动（每次渲染重注册，保证 locked / options 等闭包新鲜）；卸载时清空。
  // 用 layout effect 在浏览器绘制前完成注册，避免工具在切题后早于 effect 执行。
  useLayoutEffect(() => {
    if (!registerDriver) return;
    registerDriver({
      press: (optionId: string, signal?: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          if (locked) {
            reject(new Error("本题已作答，无法再次按压"));
            return;
          }
          if (!options.some((option) => option.id === optionId)) {
            reject(new Error(`选项「${optionId}」不存在`));
            return;
          }
          if (heldRef.current) {
            reject(new Error("已有按压进行中"));
            return;
          }
          if (signal?.aborted) {
            reject(new Error("按压已被取消"));
            return;
          }
          resolveRef.current = resolve;
          rejectRef.current = reject;
          // AbortSignal 取消 = 中途松开
          signal?.addEventListener("abort", cancelHold, { once: true });
          startHold(optionId);
        }),
    });
    return () => registerDriver(null);
  });

  useEffect(
    () => () => {
      cancelRaf();
      rejectRef.current?.(new Error("已离开本题，按压取消"));
      resolveRef.current = null;
      rejectRef.current = null;
    },
    [],
  );

  return (
    <div className="options options-graphic options-longpress">
      {options.map((option) => {
        const isHeld = heldId === option.id;
        const isTarget = option.id === targetId;
        let stateClass = "";
        if (value !== undefined) {
          if (option.id === value) stateClass = isTarget ? "lp-correct" : "lp-wrong";
          else if (isTarget) stateClass = "lp-answer";
        }
        return (
          <button
            type="button"
            key={option.id}
            className={`option option-graphic lp-btn ${stateClass} ${isHeld ? "holding" : ""}`}
            disabled={locked}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture?.(event.pointerId);
              startHold(option.id);
            }}
            onPointerUp={cancelHold}
            onPointerCancel={cancelHold}
            onLostPointerCapture={cancelHold}
            onContextMenu={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if ((event.key === " " || event.key === "Enter") && !event.repeat) {
                event.preventDefault();
                startHold(option.id);
              }
            }}
            onKeyUp={(event) => {
              if (event.key === " " || event.key === "Enter") cancelHold();
            }}
            aria-label={`长按 ${option.label} ${duration / 1000} 秒`}
          >
            <Shape visual={option.visual!} />
            {isHeld && (
              <>
                <span className="lp-progress" style={{ width: `${progress * 100}%` }} />
                <span className="lp-countdown">{(duration * (1 - progress)) / 1000 < 0.1
                  ? "✓"
                  : `${(duration * (1 - progress) / 1000).toFixed(1)}s`}</span>
              </>
            )}
            {value !== undefined && option.id === value && (
              <span className="lp-badge">{isTarget ? "✓" : "✗"}</span>
            )}
            {value !== undefined && isTarget && option.id !== value && (
              <span className="lp-badge">✓</span>
            )}
          </button>
        );
      })}
      <div className="lp-hint">
        {disabled
          ? "本题已按「我不知道」记为答错，可翻页继续"
          : locked
            ? "本题已作答，可翻页继续"
            : `用手指或鼠标在正确颜色上连续按住 ${duration / 1000} 秒（也可聚焦按钮后长按空格/回车）`}
      </div>
    </div>
  );
}

/**
 * 拼图验证码题：图片中央留一块虚线缺口，托盘里的拼图块是缺口原本的那一格。
 * 把拼图块拖到缺口位置松手即判分（落点与缺口中心的归一化距离 ≤ tolerance 算对）。
 * 支持 Pointer Events（鼠标 / 触屏拖拽），也支持键盘：方向键移动、回车 / 空格确认落点。
 */
function PuzzleAnswer({
  spec,
  value,
  onChange,
  disabled = false,
  registerDriver,
  agentFlash = false,
}: {
  spec: PuzzleSpec;
  /** 已记录的落点，格式 "x,y" */
  value: string | undefined;
  onChange: (value: string) => void;
  /** 点了「我不知道」时锁定，不再改动答案 */
  disabled?: boolean;
  /** 注册命令式驱动，供 WebMCP 工具发起真实拖动 */
  registerDriver?: (driver: PuzzleDriver | null) => void;
  /** 由 WebMCP 工具拖动时短暂高亮 */
  agentFlash?: boolean;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  /** 拖动中的拼图块位置（null = 静止在托盘里）；作答后由 value 决定展示位置 */
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  /** 键盘微调模式：加一点过渡动画，鼠标 / 触屏拖动时必须关掉 */
  const [keyboardMode, setKeyboardMode] = useState(false);
  /** 复原动画：拖错时让图块平滑滑回托盘 */
  const [settling, setSettling] = useState(false);
  /** 未对准次数（用于提示文案）与缺口的高亮提示 */
  const [missCount, setMissCount] = useState(0);
  const [gapMiss, setGapMiss] = useState(false);
  const settleTimerRef = useRef<number | undefined>(undefined);
  const gapTimerRef = useRef<number | undefined>(undefined);
  // 拖动 / 动画过程中用 ref 跟随最新位置，避免 pointermove 读到过期闭包
  const posRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const locked = value !== undefined || disabled;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const drop = value === undefined ? undefined : parsePuzzlePoint(value);
  const isRight = drop !== undefined && puzzleHit(spec, drop);

  const moveTo = (next: { x: number; y: number } | null) => {
    posRef.current = next;
    setPos(next);
  };

  /** 图块滑回托盘（带一点过渡），不记录答案 */
  const backToTray = () => {
    moveTo(null);
    setSettling(true);
    if (settleTimerRef.current !== undefined) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => setSettling(false), 240);
  };

  /**
   * 落点提交：对准缺口才记录答案；没对准则自动复原回托盘，可以继续重拖（不记录答案）。
   * 返回是否对准，供工具驱动的 promise 决定 resolve / reject。
   */
  const commit = (point: { x: number; y: number }) => {
    if (puzzleHit(spec, point)) {
      moveTo(null);
      onChange(formatPuzzlePoint(point.x, point.y));
      return true;
    }
    setMissCount((count) => count + 1);
    setGapMiss(true);
    if (gapTimerRef.current !== undefined) window.clearTimeout(gapTimerRef.current);
    gapTimerRef.current = window.setTimeout(() => setGapMiss(false), 700);
    backToTray();
    return false;
  };

  // 拼图块要按整图缩放取色，必须先量出图片实际像素
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 拼图块在托盘里的静止位置（相对图片区域的比例坐标：y > 1 即图片下方）
  const idle = { x: 0.5, y: 1 + (TRAY_MARGIN + TRAY_HEIGHT / 2) / (stage.h || 200) };
  const shown = pos ?? drop ?? idle;

  const pointFromEvent = (event: React.PointerEvent) => {
    const rect = stageRef.current!.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  };

  // 必须从拼图块本体起拖（而不是点一下图片就落块），保证题目的"拖动"语义
  const startDrag = (event: React.PointerEvent) => {
    if (locked || stage.w === 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setKeyboardMode(false);
    setSettling(false);
    moveTo(pointFromEvent(event));
  };

  const dragMove = (event: React.PointerEvent) => {
    if (locked || posRef.current === null) return;
    moveTo(pointFromEvent(event));
  };

  const dropHere = (event: React.PointerEvent) => {
    const current = posRef.current;
    if (locked || current === null) return;
    event.preventDefault();
    commit(current);
  };

  // 拖动被系统打断（来电、切后台、pointercancel）时收回托盘，不记答案
  const abortDrag = () => {
    if (posRef.current === null) return;
    backToTray();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (locked) return;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (event.repeat) return;
      const current = posRef.current;
      if (current === null) return;
      commit(current);
      return;
    }
    const step = event.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    // 还没用键盘移动过时，先把拼图块放到图片中央，方便精确微调
    const base = posRef.current ?? { x: 0.5, y: 0.5 };
    let next: { x: number; y: number } | null = null;
    if (event.key === "ArrowLeft") next = { x: base.x - step, y: base.y };
    else if (event.key === "ArrowRight") next = { x: base.x + step, y: base.y };
    else if (event.key === "ArrowUp") next = { x: base.x, y: base.y - step };
    else if (event.key === "ArrowDown") next = { x: base.x, y: base.y + step };
    if (!next) return;
    event.preventDefault();
    setKeyboardMode(true);
    setSettling(false);
    moveTo({ x: clamp01(next.x), y: clamp01(next.y) });
  };

  // 向 App 注册工具驱动（每次渲染重注册，保证 locked / spec 等闭包新鲜）
  useLayoutEffect(() => {
    if (!registerDriver) return;
    registerDriver({
      drop: (x: number, y: number, signal?: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          if (lockedRef.current) {
            reject(new Error("本题已作答，无法再次拖动"));
            return;
          }
          if (signal?.aborted) {
            reject(new Error("拖动已被取消"));
            return;
          }
          const from = posRef.current ?? idle;
          const start = performance.now();
          const duration = 700;
          const cancel = () => {
            if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
            rafRef.current = undefined;
            moveTo(null);
            reject(new Error("拖动在落点前被取消，本次未记录答案"));
          };
          signal?.addEventListener("abort", cancel, { once: true });
          const step = () => {
            const ratio = Math.min(1, (performance.now() - start) / duration);
            const eased =
              ratio < 0.5 ? 2 * ratio * ratio : 1 - ((-2 * ratio + 2) ** 2) / 2;
            moveTo({
              x: from.x + (x - from.x) * eased,
              y: from.y + (y - from.y) * eased,
            });
            if (ratio < 1) {
              rafRef.current = requestAnimationFrame(step);
              return;
            }
            if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
            rafRef.current = undefined;
            signal?.removeEventListener("abort", cancel);
            // 与人类操作同规则：拖歪了图块复原、不记答案，工具侧按失败处理以便重试
            if (!commit({ x, y })) {
              reject(new Error("落点没有对齐缺口，拼图块已复原，请重试"));
              return;
            }
            resolve();
          };
          rafRef.current = requestAnimationFrame(step);
        }),
    });
    return () => registerDriver(null);
  });

  // 离开本题时停掉工具发起的拖动动画与复原 / 提示定时器
  useEffect(
    () => () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
      if (settleTimerRef.current !== undefined) window.clearTimeout(settleTimerRef.current);
      if (gapTimerRef.current !== undefined) window.clearTimeout(gapTimerRef.current);
    },
    [],
  );

  const measured = stage.w > 0 && stage.h > 0;
  const pieceClass = [
    "puzzle-piece",
    pos !== null ? "dragging" : "",
    (keyboardMode || settling) && pos !== null ? "keyboard" : "",
    settling ? "settling" : "",
    drop !== undefined ? (isRight ? "pz-right" : "pz-wrong") : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`puzzle-block${agentFlash ? " agent-flash" : ""}`}>
      <div
        className="puzzle-stage"
        ref={stageRef}
        style={{
          backgroundImage: puzzleBackground(spec.scene),
          backgroundSize: "100% 100%",
          backgroundRepeat: "no-repeat",
        }}
      >
        <span
          className={`puzzle-gap${
            drop !== undefined ? (isRight ? " filled" : " missed") : gapMiss ? " missed" : ""
          }`}
          style={{
            left: `${spec.gapX * 100}%`,
            top: `${spec.gapY * 100}%`,
            width: PUZZLE_TILE,
            height: PUZZLE_TILE,
          }}
        />
        <button
          type="button"
          className={pieceClass}
          style={{
            left: `${shown.x * 100}%`,
            top: `${shown.y * 100}%`,
            width: PUZZLE_TILE,
            height: PUZZLE_TILE,
            // 与整图同一份渐变，按缺口位置偏移取色：拖到位才接得上
            // （负偏移：让图块自身的 0,0 对齐整图里缺口的左上角）
            backgroundImage: puzzleBackground(spec.scene),
            backgroundSize: measured ? `${stage.w}px ${stage.h}px` : undefined,
            backgroundPosition: measured
              ? `${PUZZLE_TILE / 2 - spec.gapX * stage.w}px ${PUZZLE_TILE / 2 - spec.gapY * stage.h}px`
              : undefined,
            backgroundRepeat: "no-repeat",
          }}
          disabled={locked}
          onPointerDown={startDrag}
          onPointerMove={dragMove}
          onPointerUp={dropHere}
          onPointerCancel={abortDrag}
          onLostPointerCapture={abortDrag}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={onKeyDown}
          aria-label="拼图块：按住拖到图片里的虚线缺口，或用方向键移动后按回车确认落点"
        >
          {drop !== undefined && <span className="pz-badge">{isRight ? "✓" : "✗"}</span>}
        </button>
      </div>
      <div className="puzzle-tray" style={{ marginTop: TRAY_MARGIN, height: TRAY_HEIGHT }} />
      <div className="puzzle-hint">
        {disabled
          ? "本题已按「我不知道」记为答错，可翻页继续"
          : drop !== undefined
            ? isRight
              ? "拼图已对齐，图片补全成功"
              : "落点没有对齐缺口"
            : missCount > 0
              ? `没有对齐缺口，拼图块已复原，请再拖一次（已尝试 ${missCount} 次）`
              : "按住拼图块拖到图片中的虚线缺口，松手即判定；也可聚焦后用 ← → ↑ ↓ 微调、Shift + 方向键大步移动、回车 / 空格确认"}
      </div>
    </div>
  );
}
