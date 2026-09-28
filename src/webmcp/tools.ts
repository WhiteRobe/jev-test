import {
  POINTS_PER_QUESTION,
  QUIZ_SIZE,
  type Question,
  type QuestionOption,
} from "../questions";

// WebMCP 模式下向 AI 智能体开放的结构化工具。
// 设计约束：
// - 工具只能操作「当前题」，要答别的题必须先 go_to_question，与 GUI 促动赛道的操作路径一致；
// - 交卷前任何返回都不包含 answer / explanation，避免泄露答案；
// - execute 只能返回字符串，统一返回 JSON.stringify(...)，错误直接 throw（Inspector 可见）。

export type QuizPhase = "intro" | "quiz" | "result";

export interface ReviewItem {
  question: Question;
  chosen?: QuestionOption;
  correct?: QuestionOption;
  chosenNum?: number;
  /** 拼图题的落点（归一化坐标） */
  point?: { x: number; y: number };
  isRight: boolean;
}

export interface QuizResultSnapshot {
  percent: number;
  score: number;
  rightCount: number;
  gradeTitle: string;
  detail: ReviewItem[];
}

/** 工具执行期间读取的页面快照（通过 getter 访问，永远拿到最新 React 状态） */
export interface QuizSnapshot {
  phase: QuizPhase;
  /** 0-based 当前题下标 */
  current: number;
  questions: Question[];
  /** 每题按展示顺序排列的选项（抽题时已随机打乱） */
  optionsOrder: QuestionOption[][];
  answers: Record<number, string>;
  result?: QuizResultSnapshot;
}

/** 长按题的命令式驱动：由 LongPressAnswer 组件注册上来，工具通过它触发真实按压 */
export interface LongPressDriver {
  /**
   * 在指定选项上发起一次真实按压（含 3 秒倒计时动画），按压完成（答案被记录）后 resolve；
   * 中途 signal abort 或按压被取消则 reject，且不记录答案。
   */
  press(optionId: string, signal?: AbortSignal): Promise<void>;
}

/** 拼图题的命令式驱动：由 PuzzleAnswer 组件注册上来，工具通过它触发一次真实拖动 */
export interface PuzzleDriver {
  /**
   * 把拼图块从托盘拖到归一化坐标 (x, y)（0–1 的图内比例）并松手，落点被记录后 resolve；
   * 中途 signal abort 则取消拖动、reject，且不记录答案。
   */
  drop(x: number, y: number, signal?: AbortSignal): Promise<void>;
}

export interface QuizActions {
  startQuiz(seed?: string): void;
  answerCurrent(input: { optionId?: string; value?: number }): void;
  /** 跳到 1-based 题号 */
  goToQuestion(number1: number): void;
  submit(): void;
  longPress(optionId: string, signal?: AbortSignal): Promise<void>;
  puzzleDrop(x: number, y: number, signal?: AbortSignal): Promise<void>;
  /** 让被工具操作的元素短暂高亮，保证工具调用在页面上可见 */
  flash(target: string): void;
}

const ok = (data: Record<string, unknown>): string => JSON.stringify({ ok: true, ...data });

const optionView = (option: QuestionOption) => ({ id: option.id, label: option.label });

/** 当前题的对外视图：只包含页面上本来就可见的信息，绝不含正确答案 */
function currentQuestionView(snap: QuizSnapshot) {
  const q = snap.questions[snap.current];
  const view: Record<string, unknown> = {
    number: snap.current + 1,
    type: q.type,
    section: q.section,
    prompt: q.prompt,
    answered: snap.answers[q.id] !== undefined,
  };
  if (q.type === "slider" && q.slider) {
    view.slider = {
      min: q.slider.min,
      max: q.slider.max,
      step: q.slider.step,
      unit: q.slider.unit ?? "",
    };
  } else if (q.type === "puzzle" && q.puzzle) {
    view.puzzle = {
      gapX: q.puzzle.gapX,
      gapY: q.puzzle.gapY,
      tolerance: q.puzzle.tolerance,
      hint:
        "Drag the puzzle piece so its center lands on the hole (gapX / gapY, 0-1 of the image box). Dropping further than tolerance away is judged wrong.",
    };
  } else if (q.type === "longpress") {
    view.holdDurationSeconds = (q.holdDuration ?? 3000) / 1000;
    view.options = snap.optionsOrder[snap.current].map(optionView);
  } else {
    view.options = snap.optionsOrder[snap.current].map(optionView);
  }
  return view;
}

/** 结果页逐题解析视图（此时才包含正确答案与解析） */
function reviewView(item: ReviewItem, number: number) {
  const q = item.question;
  if (q.type === "slider" && q.slider) {
    return {
      number,
      type: q.type,
      section: q.section,
      prompt: q.prompt,
      isRight: item.isRight,
      yourValue: item.chosenNum === undefined ? null : item.chosenNum,
      correctValue: q.slider.target,
      unit: q.slider.unit ?? "",
      explanation: q.explanation,
    };
  }
  if (q.type === "puzzle" && q.puzzle) {
    return {
      number,
      type: q.type,
      section: q.section,
      prompt: q.prompt,
      isRight: item.isRight,
      yourPoint: item.point ?? null,
      correctPoint: { x: q.puzzle.gapX, y: q.puzzle.gapY },
      tolerance: q.puzzle.tolerance,
      explanation: q.explanation,
    };
  }
  return {
    number,
    type: q.type,
    section: q.section,
    prompt: q.prompt,
    isRight: item.isRight,
    yourAnswer: item.chosen ? item.chosen.label : null,
    correctAnswer: item.correct ? item.correct.label : null,
    explanation: q.explanation,
  };
}

/**
 * 按当前页面阶段构建工具集；snap / act 都是 getter，闭包不会捕获过期状态。
 */
export function buildTools(
  phase: QuizPhase,
  getSnapshot: () => QuizSnapshot,
  getActions: () => QuizActions,
): ModelContextTool[] {
  // ---------- 全局：get_app_state ----------
  const getAppState: ModelContextTool = {
    name: "get_app_state",
    description:
      "Get the current state of the quiz app: which page (intro / quiz / result) it is on, and progress counters. Call this first to decide the next tool.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const snap = getSnapshot();
      const data: Record<string, unknown> = { mode: "webmcp", phase: snap.phase };
      if (snap.phase === "intro") {
        data.quizLength = QUIZ_SIZE;
        data.hint = "Call start_quiz to begin (an optional seed reproduces the same question set).";
      } else if (snap.phase === "quiz") {
        data.totalQuestions = snap.questions.length;
        data.currentQuestion = snap.current + 1;
        data.answeredCount = Object.keys(snap.answers).length;
        data.hint =
          "Call get_current_question, then answer_current_question. You can only answer the current question; use go_to_question to move.";
      } else {
        data.percent = snap.result?.percent;
        data.hint =
          "Call get_result_summary / get_question_review for details, or start_quiz to take a new quiz.";
      }
      return JSON.stringify({ ok: true, ...data });
    },
  };

  // ---------- 介绍页 / 结果页：start_quiz ----------
  const startQuiz: ModelContextTool = {
    name: "start_quiz",
    description:
      "Start a brand-new quiz with freshly randomized questions and enter the quiz page. On the result page this starts another attempt ('retry').",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        seed: {
          type: "string",
          description:
            "Optional random seed. The same seed always draws the same questions in the same order; omit it for a fully random draw.",
        },
      },
    },
    execute: async (input) => {
      const seed = (input as { seed?: unknown }).seed;
      getActions().startQuiz(typeof seed === "string" && seed.trim() ? seed : undefined);
      return ok({ started: true, totalQuestions: QUIZ_SIZE });
    },
  };

  // ---------- 答题页：get_current_question ----------
  const getCurrentQuestion: ModelContextTool = {
    name: "get_current_question",
    description:
      "Get the current question: its number, type, section, prompt, selectable options (id + human-readable label), and slider / long-press parameters when applicable. No answer key is exposed before submission.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const snap = getSnapshot();
      if (snap.phase !== "quiz") throw new Error("当前不在答题阶段，可先调用 start_quiz 开始测验");
      return JSON.stringify({ ok: true, question: currentQuestionView(snap) });
    },
  };

  // ---------- 答题页：answer_current_question ----------
  const answerCurrent: ModelContextTool = {
    name: "answer_current_question",
    description:
      "Answer the CURRENT question and record the answer. For truefalse / single / graphic / longpress questions pass optionId (use an id returned by get_current_question). For slider questions pass the exact numeric value. For puzzle questions pass x and y, the normalized 0-1 coordinates inside the image box where the piece is dropped. Pass nothing else. For longpress questions the call holds the target button visibly for the required duration (default 3s) and only resolves after the press completes; if it is aborted the question stays unanswered. Puzzle questions are dragged visibly to (x, y) and released there; if the call is aborted the question stays unanswered.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        optionId: {
          type: "string",
          description:
            "Option id to select for choice questions (truefalse, single, graphic, longpress).",
        },
        value: {
          type: "number",
          description: "Exact numeric value to move the slider to (slider questions only).",
        },
        x: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description:
            "Horizontal drop position of the puzzle piece, 0-1 of the image width (puzzle questions only).",
        },
        y: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description:
            "Vertical drop position of the puzzle piece, 0-1 of the image height (puzzle questions only).",
        },
      },
    },
    execute: async (input, ctx) => {
      const snap = getSnapshot();
      if (snap.phase !== "quiz") throw new Error("当前不在答题阶段，可先调用 start_quiz 开始测验");
      const q = snap.questions[snap.current];
      if (snap.answers[q.id] !== undefined) {
        throw new Error(`第 ${snap.current + 1} 题已作答，可用 go_to_question 切换题目检查`);
      }
      const { optionId, value, x, y } = (input ?? {}) as {
        optionId?: unknown;
        value?: unknown;
        x?: unknown;
        y?: unknown;
      };
      const actions = getActions();

      if (q.type === "slider") {
        if (typeof optionId !== "undefined") throw new Error("本题为滑块题，请只传入数值参数 value");
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new Error("本题为滑块题，请传入数值参数 value");
        }
        const spec = q.slider!;
        if (value < spec.min || value > spec.max) {
          throw new Error(`value 超出量程：必须在 ${spec.min} 到 ${spec.max}${spec.unit ?? ""} 之间`);
        }
        const steps = (value - spec.min) / spec.step;
        if (Math.abs(steps - Math.round(steps)) > 1e-9) {
          throw new Error(`value 必须对齐最小刻度 ${spec.step}${spec.unit ?? ""}`);
        }
        actions.answerCurrent({ value });
        actions.flash("slider");
        return ok({ recorded: true, number: snap.current + 1, value });
      }

      if (q.type === "puzzle") {
        if (typeof optionId !== "undefined" || typeof value !== "undefined") {
          throw new Error("本题为拼图题，请只传入归一化坐标 x 与 y");
        }
        if (
          typeof x !== "number" ||
          typeof y !== "number" ||
          !Number.isFinite(x) ||
          !Number.isFinite(y)
        ) {
          throw new Error("本题为拼图题，请同时传入数值参数 x 与 y（图片内 0–1 的比例坐标）");
        }
        if (x < 0 || x > 1 || y < 0 || y > 1) {
          throw new Error("x / y 必须落在 0 到 1 之间（图片内比例坐标）");
        }
        // 忠实模拟：真实拖动到 (x, y) 松手，中途取消则不记录（与人类操作同规则）
        await actions.puzzleDrop(x, y, ctx.signal);
        return ok({ recorded: true, number: snap.current + 1, x, y });
      }

      if (typeof value !== "undefined") throw new Error("本题为选择题，请只传入 optionId");
      if (typeof optionId !== "string" || !optionId) {
        throw new Error("请传入 get_current_question 返回的选项 id（optionId）");
      }
      if (!q.options.some((option) => option.id === optionId)) {
        throw new Error(`optionId「${optionId}」无效，请使用 get_current_question 返回的选项 id`);
      }

      if (q.type === "longpress") {
        // 忠实模拟：真实按压 N 秒，中途取消则不记录（与人类操作同规则）
        await actions.longPress(optionId, ctx.signal);
        return ok({ recorded: true, number: snap.current + 1, optionId });
      }

      actions.answerCurrent({ optionId });
      actions.flash(`option:${optionId}`);
      return ok({ recorded: true, number: snap.current + 1, optionId });
    },
  };

  // ---------- 答题页：go_to_question ----------
  const goToQuestion: ModelContextTool = {
    name: "go_to_question",
    description:
      "Jump to a question by its 1-based number so it becomes the current question (answers are preserved). Use this to review or answer earlier/later questions.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["number"],
      properties: {
        number: { type: "integer", minimum: 1, description: "1-based question number" },
      },
    },
    execute: async (input) => {
      const snap = getSnapshot();
      const number = (input as { number?: unknown }).number;
      if (typeof number !== "number" || !Number.isInteger(number)) {
        throw new Error("number 必须是从 1 开始的整数题号");
      }
      if (number < 1 || number > snap.questions.length) {
        throw new Error(`题号超出范围：只到第 ${snap.questions.length} 题`);
      }
      getActions().goToQuestion(number);
      return ok({ currentQuestion: number });
    },
  };

  // ---------- 答题页：get_progress ----------
  const getProgress: ModelContextTool = {
    name: "get_progress",
    description:
      "Get the answer progress: which number is current, how many questions are answered, and the answered / unanswered status of every question (without revealing answers).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const snap = getSnapshot();
      if (snap.phase !== "quiz") throw new Error("当前不在答题阶段");
      return JSON.stringify({
        ok: true,
        currentQuestion: snap.current + 1,
        answeredCount: Object.keys(snap.answers).length,
        totalQuestions: snap.questions.length,
        questions: snap.questions.map((q, index) => ({
          number: index + 1,
          section: q.section,
          type: q.type,
          answered: snap.answers[q.id] !== undefined,
          current: index === snap.current,
        })),
      });
    },
  };

  // ---------- 答题页：submit_quiz ----------
  const submitQuiz: ModelContextTool = {
    name: "submit_quiz",
    description:
      "Submit the quiz and move to the result page. Only allowed when every question is answered; otherwise the tool reports how many remain.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => {
      const snap = getSnapshot();
      if (snap.phase !== "quiz") throw new Error("当前不在答题阶段，无法交卷");
      const unanswered = snap.questions.length - Object.keys(snap.answers).length;
      if (unanswered > 0) {
        throw new Error(`还有 ${unanswered} 题未作答，全部作答后才能交卷（可用 get_progress 查看）`);
      }
      getActions().submit();
      return ok({ submitted: true, hint: "已交卷，可调用 get_result_summary 查看成绩" });
    },
  };

  // ---------- 结果页：get_result_summary ----------
  const getResultSummary: ModelContextTool = {
    name: "get_result_summary",
    description:
      "Get the overall result after submission: percentage score, raw score, correct / wrong counts and grade title.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const result = getSnapshot().result;
      if (!result) throw new Error("尚未交卷，没有成绩可查看");
      return JSON.stringify({
        ok: true,
        percent: result.percent,
        rawScore: result.score,
        fullScore: result.detail.length * POINTS_PER_QUESTION,
        rightCount: result.rightCount,
        wrongCount: result.detail.length - result.rightCount,
        grade: result.gradeTitle,
      });
    },
  };

  // ---------- 结果页：get_question_review ----------
  const getQuestionReview: ModelContextTool = {
    name: "get_question_review",
    description:
      "Get the per-question review with the prompt, your answer, the correct answer and the explanation. Pass a number to review one question; omit it to get all reviews.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        number: { type: "integer", minimum: 1, description: "1-based question number; omit for all" },
      },
    },
    annotations: { readOnlyHint: true },
    execute: async (input) => {
      const result = getSnapshot().result;
      if (!result) throw new Error("尚未交卷，没有解析可查看");
      const number = (input as { number?: unknown }).number;
      if (number !== undefined) {
        if (typeof number !== "number" || !Number.isInteger(number)) {
          throw new Error("number 必须是整数题号");
        }
        if (number < 1 || number > result.detail.length) {
          throw new Error(`题号超出范围：只到第 ${result.detail.length} 题`);
        }
        return JSON.stringify({ ok: true, reviews: [reviewView(result.detail[number - 1], number)] });
      }
      return JSON.stringify({
        ok: true,
        reviews: result.detail.map((item, index) => reviewView(item, index + 1)),
      });
    },
  };

  switch (phase) {
    case "intro":
      return [getAppState, startQuiz];
    case "quiz":
      return [
        getAppState,
        getCurrentQuestion,
        answerCurrent,
        goToQuestion,
        getProgress,
        submitQuiz,
      ];
    case "result":
      return [getAppState, startQuiz, getResultSummary, getQuestionReview];
  }
}
