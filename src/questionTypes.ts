// 题目的类型定义、抽题配置常量与纯函数工具。
// 这里刻意不包含题库数据：题库（questions.ts）只由服务端（Worker / Vite dev 中间件）引用，
// 前端一律通过 /api/questions 拉题，保证「批量 / 单次拉题」两种模式走的都是真实接口。

export type QuestionType =
  | "truefalse"
  | "single"
  | "graphic"
  | "slider"
  | "longpress"
  | "puzzle";

export interface GraphicVisual {
  kind: "color" | "emoji" | "shape";
  /** color / shape 使用的颜色 */
  color?: string;
  /** emoji 图案 */
  emoji?: string;
  /** shape 的几何形状 */
  shape?: "circle" | "square" | "triangle" | "star" | "pentagon" | "hexagon";
  /** shape 的边长（px） */
  size?: number;
}

/** 滑块题：把滑块移动到 target（允许误差 tolerance，默认 0） */
export interface SliderSpec {
  min: number;
  max: number;
  step: number;
  target: number;
  unit?: string;
  tolerance?: number;
}

/** 拼图验证码的图像场景（纯 CSS 渐变渲染，不依赖任何外部图片资源） */
export interface PuzzleScene {
  /** 背景渐变起始色（上） */
  from: string;
  /** 背景渐变结束色（下） */
  to: string;
  /** 高光圆形（太阳 / 光斑）颜色 */
  accent: string;
  /** 高光中心（相对图宽 / 图高比例，0–1） */
  accentX: number;
  accentY: number;
  /** 高光半径（相对图宽比例） */
  accentR: number;
}

/** 拼图验证码题参数：把缺图块拖动到图片中缺口的位置 */
export interface PuzzleSpec {
  scene: PuzzleScene;
  /** 缺口中心（相对图宽 / 图高比例，0–1） */
  gapX: number;
  gapY: number;
  /** 判定容差：落点与缺口的归一化距离不超过该值即算正确 */
  tolerance: number;
}

export interface QuestionOption {
  id: string;
  /** 文字选项内容（判断题 / 单选题） */
  text?: string;
  /** 图形选项的渲染描述（图形题） */
  visual?: GraphicVisual;
  /** 该选项的文字描述，用于结果页回看 */
  label: string;
}

export interface Question {
  id: number;
  type: QuestionType;
  section: string;
  prompt: string;
  options: QuestionOption[];
  /** 正确选项的 id（判断 / 单选 / 图形题） */
  answer: string;
  explanation: string;
  /** 滑块题参数 */
  slider?: SliderSpec;
  /** 长按题：需要持续按住的毫秒数 */
  holdDuration?: number;
  /** 拼图验证码题参数 */
  puzzle?: PuzzleSpec;
}

/**
 * 题目接口下发的题目：默认不带 answer / explanation（题目本身不该泄题），
 * 交卷判分时用 `reveal=1` 再取一次完整题目。
 */
export type QuestionPayload = Omit<Question, "answer" | "explanation"> &
  Partial<Pick<Question, "answer" | "explanation">>;

/** 题库索引条目：只有定位信息，没有题干 / 选项 / 答案 */
export interface BankEntry {
  id: number;
  type: QuestionType;
  section: string;
}

export const POINTS_PER_QUESTION = 5;
/** 「我不知道」按钮记入 answers 的哨兵值：视同已作答，但判为错误 */
export const UNKNOWN_ANSWER = "unknown";
/** 每次测验抽题数量 */
export const QUIZ_SIZE = 30;
/** 每个板块保底出现的题数（其余名额全库随机） */
export const PER_SECTION_MIN = 4;

/** 拼图题落点的记录格式：归一化坐标 "x,y"（图内比例，0–1） */
export const formatPuzzlePoint = (x: number, y: number): string =>
  `${Math.round(x * 1000) / 1000},${Math.round(y * 1000) / 1000}`;

/** 解析拼图题记录的落点，格式非法时返回 undefined */
export const parsePuzzlePoint = (raw: string): { x: number; y: number } | undefined => {
  const [x, y] = raw.split(",").map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
};

/** 拼图落点是否在缺口容差内 */
export const puzzleHit = (spec: PuzzleSpec, point: { x: number; y: number }): boolean =>
  Math.hypot(point.x - spec.gapX, point.y - spec.gapY) <= spec.tolerance;
