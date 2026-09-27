import { useEffect, useMemo, useRef, useState } from "react";
import {
  BANK_SIZE,
  POINTS_PER_QUESTION,
  QUESTIONS,
  QUIZ_SIZE,
  type GraphicVisual,
  type Question,
  type QuestionOption,
  type SliderSpec,
} from "./questions";

type Phase = "intro" | "quiz" | "result";

const SECTION_ORDER = ["判断对错", "单项选择", "图形点选", "人机交互检测"];
/** 每次测验每个题型保底出现的题数（4 × 3 = 12，其余 18 题全库随机） */
const PER_SECTION_MIN = 3;

const CLIP_PATHS: Record<string, string> = {
  triangle: "polygon(50% 0%, 100% 100%, 0% 100%)",
  pentagon: "polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)",
  hexagon: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
  star: "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
};

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 从总题库随机抽 QUIZ_SIZE 题：
 * 每个板块先保底抽 PER_SECTION_MIN 题，剩余名额在全题库范围内随机补齐，最后打乱顺序并重新编号。
 */
function pickQuestions(): Question[] {
  const picked: Question[] = [];
  for (const section of SECTION_ORDER) {
    const pool = shuffle(QUESTIONS.filter((q) => q.section === section));
    picked.push(...pool.slice(0, PER_SECTION_MIN));
  }
  const restPool = shuffle(QUESTIONS.filter((q) => !picked.includes(q)));
  picked.push(...restPool.slice(0, QUIZ_SIZE - PER_SECTION_MIN * SECTION_ORDER.length));
  return shuffle(picked).map((q, index) => ({ ...q, id: index + 1 }));
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
  // 本次测验的题目：进入页面时先抽一套，点击“开始答题 / 再测一次”会重新随机抽取
  const [quizQuestions, setQuizQuestions] = useState<Question[]>(() => pickQuestions());

  // 每次开始答题时随机打乱每题的选项顺序，防止背位置
  const [optionsOrder, setOptionsOrder] = useState<QuestionOption[][]>(() =>
    quizQuestions.map((q) => shuffle(q.options)),
  );

  const question = quizQuestions[current];
  const answeredCount = Object.keys(answers).length;
  const totalScore = quizQuestions.length * POINTS_PER_QUESTION;
  const allAnswered = answeredCount === quizQuestions.length;

  const startQuiz = () => {
    const picked = pickQuestions();
    setQuizQuestions(picked);
    setOptionsOrder(picked.map((q) => shuffle(q.options)));
    setAnswers({});
    setCurrent(0);
    setPhase("quiz");
    window.scrollTo(0, 0);
  };

  const choose = (optionId: string) => {
    setAnswers((prev) => ({ ...prev, [question.id]: optionId }));
  };

  const goTo = (index: number) => {
    setCurrent(index);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const result = useMemo(() => {
    const detail = quizQuestions.map((q) => {
      const chosenId = answers[q.id];
      if (q.type === "slider" && q.slider) {
        const chosenNum = chosenId === undefined ? undefined : Number(chosenId);
        const tolerance = q.slider.tolerance ?? 0;
        const isRight =
          chosenNum !== undefined && Math.abs(chosenNum - q.slider.target) <= tolerance;
        return { question: q, chosen: undefined, correct: undefined, chosenNum, isRight };
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

  // ---------- 介绍页 ----------
  if (phase === "intro") {
    return (
      <div className="page">
        <div className="card intro-card">
          <div className="badge">jev-test</div>
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
            <li>
              每次开始都从 {BANK_SIZE} 题题库中随机抽 {QUIZ_SIZE} 题，{SECTION_ORDER.length}{" "}
              类题型每类至少出现 {PER_SECTION_MIN} 题，每题选项顺序也随机生成。
            </li>
            <li>答完可前后翻页检查，全部作答后即可提交，查看总分、评级和逐题解析。</li>
          </ul>
          <button type="button" className="btn primary large" onClick={startQuiz}>
            开始答题
          </button>
        </div>
      </div>
    );
  }

  // ---------- 结果页 ----------
  if (phase === "result") {
    const grade = gradeOf(result.percent);
    return (
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
            {result.detail.map(({ question: q, chosen, correct, chosenNum, isRight }, idx) => (
              <div className={`review-item ${isRight ? "right" : "wrong"}`} key={q.id}>
                <div className="review-head">
                  <span className="review-no">{idx + 1}</span>
                  <span className="review-tag">{q.section}</span>
                  <span className={`review-status ${isRight ? "right" : "wrong"}`}>
                    {isRight ? "✓ 正确" : "✗ 错误"}
                  </span>
                </div>
                <div className="review-prompt">{q.prompt}</div>
                {q.type === "slider" && q.slider ? (
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
            ))}
          </div>

          <button type="button" className="btn primary large" onClick={startQuiz}>
            再测一次（重新抽题）
          </button>
        </div>
      </div>
    );
  }

  // ---------- 答题页 ----------
  const sectionIndex = SECTION_ORDER.indexOf(question.section);
  const isLast = current === quizQuestions.length - 1;
  const selected = answers[question.id];

  return (
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
              value={selected === undefined ? undefined : Number(selected)}
              onChange={(value) => choose(String(value))}
            />
          ) : question.type === "longpress" ? (
            <LongPressAnswer
              options={optionsOrder[current]}
              duration={question.holdDuration ?? 3000}
              targetId={question.answer}
              value={selected}
              onChange={choose}
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
                    }`}
                    onClick={() => choose(option.id)}
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
        </aside>
      </div>
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
}: {
  spec: SliderSpec;
  value: number | undefined;
  onChange: (value: number) => void;
}) {
  // 未作答时滑块停在量程中点，仅作为展示位置，不计答案
  const display = value ?? Math.round((spec.min + spec.max) / 2);
  const percent = ((display - spec.min) / (spec.max - spec.min)) * 100;
  const unit = spec.unit ?? "";
  return (
    <div className="slider-block">
      <div className="slider-readout">{value === undefined ? "未作答" : `${display}${unit}`}</div>
      <input
        type="range"
        className="slider-input"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={display}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ "--fill": `${percent}%` } as React.CSSProperties}
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
      <div className="slider-hint">拖动滑块，或点击后用键盘 ← → 方向键微调</div>
    </div>
  );
}

function LongPressAnswer({
  options,
  duration,
  targetId,
  value,
  onChange,
}: {
  options: QuestionOption[];
  duration: number;
  targetId: string;
  value: string | undefined;
  onChange: (optionId: string) => void;
}) {
  const [heldId, setHeldId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);
  const startRef = useRef(0);
  const heldRef = useRef<string | null>(null);
  const locked = value !== undefined;

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
  };

  useEffect(() => () => cancelRaf(), []);

  return (
    <div className="options options-graphic options-longpress">
      {options.map((option) => {
        const isHeld = heldId === option.id;
        const isTarget = option.id === targetId;
        let stateClass = "";
        if (locked) {
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
            {locked && option.id === value && <span className="lp-badge">{isTarget ? "✓" : "✗"}</span>}
            {locked && isTarget && option.id !== value && <span className="lp-badge">✓</span>}
          </button>
        );
      })}
      <div className="lp-hint">
        {locked
          ? "本题已作答，可翻页继续"
          : `用手指或鼠标在正确颜色上连续按住 ${duration / 1000} 秒（也可聚焦按钮后长按空格/回车）`}
      </div>
    </div>
  );
}
