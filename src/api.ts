// 前端拉题接口封装：题库在服务端，前端只通过 /api/questions 拿题。
// 批量拉题与单次拉题用的是同一组接口，区别只在调用时机（见 App.tsx 的 loadMode）。

import {
  type BankEntry,
  type Question,
  type QuestionPayload,
} from "./questionTypes";

export interface BankIndex {
  bankSize: number;
  quizSize: number;
  pointsPerQuestion: number;
  questions: BankEntry[];
}

const errorText = (payload: unknown, fallback: string): string =>
  typeof payload === "object" && payload !== null && "error" in payload
    ? String((payload as { error: unknown }).error)
    : fallback;

async function getJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { accept: "application/json" } });
  } catch {
    throw new Error("题目接口请求失败，请检查网络后重试");
  }
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`题目接口返回了非 JSON 内容（HTTP ${response.status}）`);
  }
  if (typeof payload === "object" && payload !== null && "ok" in payload && payload.ok !== true) {
    throw new Error(errorText(payload, `题目接口报错（HTTP ${response.status}）`));
  }
  if (!response.ok) throw new Error(`题目接口报错（HTTP ${response.status}）`);
  return payload as T;
}

/** 接口拿到的是「不含答案」的题目，只有交卷判分时才是完整题目 */
export const asQuestion = (payload: QuestionPayload): Question => {
  if (payload.answer === undefined || payload.explanation === undefined) {
    throw new Error("题目接口未返回答案与解析，无法判分");
  }
  return payload as Question;
};

/** 题库索引：只有 id / type / section，前端据此抽题 */
export const fetchBankIndex = () => getJson<BankIndex & { ok: true }>("/api/questions?meta=1");

/** 单次拉题：只取这一道题 */
export const fetchQuestion = (bankId: number) =>
  getJson<{ question: QuestionPayload }>(`/api/questions/${bankId}`);

/**
 * 批量取题：抽题后一次拿回全部（reveal=false），
 * 或交卷时按 ids 取回带答案的完整题目（reveal=true）用于判分与解析。
 */
export const fetchQuestions = (bankIds: number[], reveal = false) =>
  getJson<{ questions: QuestionPayload[] }>(
    `/api/questions?ids=${bankIds.join(",")}${reveal ? "&reveal=1" : ""}`,
  );
