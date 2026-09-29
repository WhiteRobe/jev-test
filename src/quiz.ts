// 抽题与题目槽位：抽题只依赖题库索引（id / type / section），
// 题目正文什么时候到由拉题模式决定（批量 = 开始答题时一次拉齐；单次 = 翻到哪题拉哪题）。

import {
  PER_SECTION_MIN,
  QUIZ_SIZE,
  type BankEntry,
  type Question,
  type QuestionOption,
  type QuestionType,
} from "./questionTypes";

/** 拉题模式：batch = 批量一次性拉题（默认）；single = 单次按需拉题 */
export type LoadMode = "batch" | "single";

/** 一次测验里的一个题位：题号固定，题目正文可能还没到 */
export interface QuizSlot {
  /** 会话内题号（1..N），也是 answers 的 key */
  number: number;
  /** 题库原始 id：单次拉题时用它请求 /api/questions/:id */
  bankId: number;
  type: QuestionType;
  section: string;
  /** 完整题目：批量模式开局就有；单次拉题模式翻到该题时才到位 */
  question?: Question;
  /** 该题展示用的选项顺序（题目到位时按本次抽题的随机序列打乱） */
  options?: QuestionOption[];
}

export function shuffle<T>(items: T[], rand: () => number = Math.random): T[] {
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

/** 板块顺序按题库里首次出现的先后（题库本身是按板块顺序写的） */
export function sectionOrderOf(entries: BankEntry[]): string[] {
  const order: string[] = [];
  for (const entry of entries) {
    if (!order.includes(entry.section)) order.push(entry.section);
  }
  return order;
}

/**
 * 从题库索引随机抽 QUIZ_SIZE 个题位：
 * 每个板块先保底抽 PER_SECTION_MIN 题，剩余名额在全题库范围内随机补齐，最后打乱顺序并重新编号。
 * 这里只决定「抽哪几题、什么顺序」，不碰题目正文——正文由批量 / 单次拉题接口下发。
 * rand 可注入：默认 Math.random（每次不同），传入种子 PRNG 时结果可复现。
 */
export function pickSlots(entries: BankEntry[], rand: () => number = Math.random): QuizSlot[] {
  const sections = sectionOrderOf(entries);
  const picked: BankEntry[] = [];
  for (const section of sections) {
    const pool = shuffle(
      entries.filter((entry) => entry.section === section),
      rand,
    );
    picked.push(...pool.slice(0, PER_SECTION_MIN));
  }
  const restPool = shuffle(
    entries.filter((entry) => !picked.includes(entry)),
    rand,
  );
  picked.push(...restPool.slice(0, QUIZ_SIZE - PER_SECTION_MIN * sections.length));
  return shuffle(picked, rand).map((entry, index) => ({
    number: index + 1,
    bankId: entry.id,
    type: entry.type,
    section: entry.section,
  }));
}
