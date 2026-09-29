// 题目接口：题库只存在于服务端，前端一律通过这里拉题。
// 两种拉题模式共用同一套接口：
// - 批量拉题：GET /api/questions?ids=1,2,3…（一次拿回本次抽中的全部题目）
// - 单次拉题：GET /api/questions/:id（点题号 / 点下一题时才请求这一题）
// 另外：
// - GET /api/questions?meta=1 只返回题库索引（id / type / section），前端用它抽题，不含任何题干；
// - 默认不下发 answer / explanation，交卷判分时用 reveal=1 取完整题目，避免答案在答题阶段流到前端。
// 该模块不依赖任何运行时（Node / Workers 均可），Vite dev 中间件与 Worker 入口都直接复用。

import {
  BANK_SIZE,
  QUESTIONS,
} from "../src/questions";
import {
  POINTS_PER_QUESTION,
  QUIZ_SIZE,
  type BankEntry,
  type Question,
  type QuestionPayload,
} from "../src/questionTypes";

/** 题库索引：只含定位信息，前端据此抽题 */
const INDEX: BankEntry[] = QUESTIONS.map((q) => ({ id: q.id, type: q.type, section: q.section }));

const BY_ID = new Map<number, Question>(QUESTIONS.map((q) => [q.id, q]));

/** 去掉答案与解析：答题阶段只给题目本身 */
const withoutKey = (q: Question): QuestionPayload => ({
  id: q.id,
  type: q.type,
  section: q.section,
  prompt: q.prompt,
  options: q.options,
  slider: q.slider,
  holdDuration: q.holdDuration,
  puzzle: q.puzzle,
});

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    // 不缓存：单次拉题模式要保证每次翻页都真的打一次接口，便于观察与调试
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const fail = (error: string, status: number) => json({ ok: false, error }, status);

const parseIds = (raw: string): number[] | undefined => {
  const ids = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map(Number);
  if (ids.length === 0 || ids.some((id) => !Number.isInteger(id) || id <= 0)) return undefined;
  return ids;
};

/**
 * 处理 /api/questions* 请求；不是题目接口的路径返回 null（交给静态资源兜底）。
 * 返回的 Response 一定是 JSON，出错时带 ok:false 与中文错误说明。
 */
export function handleQuestionApi(request: Request): Response | null {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return fail("题目接口只支持 GET", 405);
  }

  const segments = url.pathname.split("/").filter(Boolean); // ["api", "questions", (id)]
  if (segments[1] !== "questions") return fail(`未知接口：${url.pathname}`, 404);
  if (segments.length > 3) return fail(`未知接口：${url.pathname}`, 404);

  const params = url.searchParams;
  const reveal = params.get("reveal") === "1";
  const meta = params.get("meta") === "1";
  const idsParam = params.get("ids");

  // 题库索引：只要 id / type / section，前端拿它抽题
  if (meta) {
    if (idsParam !== null) return fail("meta=1 不能与 ids 同时使用", 400);
    return json({
      ok: true,
      bankSize: BANK_SIZE,
      quizSize: QUIZ_SIZE,
      pointsPerQuestion: POINTS_PER_QUESTION,
      questions: INDEX,
    });
  }

  // 定位要取哪些题：路径上的单个 id，或 ids=1,2,3（都不给则整库）
  let wanted: number[] | undefined;
  if (segments.length === 3) {
    const id = Number(segments[2]);
    if (!Number.isInteger(id) || id <= 0) return fail(`题号必须是正整数，收到「${segments[2]}」`, 400);
    wanted = [id];
  } else if (idsParam !== null) {
    const ids = parseIds(idsParam);
    if (!ids) return fail("ids 必须是逗号分隔的正整数，例如 ?ids=1,2,3", 400);
    wanted = ids;
  }

  if (!wanted) {
    return json({
      ok: true,
      bankSize: BANK_SIZE,
      questions: QUESTIONS.map(reveal ? (q) => q : withoutKey),
    });
  }

  const picked: Question[] = [];
  for (const id of wanted) {
    const question = BY_ID.get(id);
    if (!question) return fail(`题号 ${id} 不存在（题库共 ${BANK_SIZE} 题）`, 404);
    picked.push(question);
  }

  // 单题路径：{ question }；批量：{ questions }
  if (segments.length === 3) {
    const question = picked[0];
    return json({ ok: true, question: reveal ? question : withoutKey(question) });
  }
  return json({ ok: true, questions: picked.map(reveal ? (q) => q : withoutKey) });
}
