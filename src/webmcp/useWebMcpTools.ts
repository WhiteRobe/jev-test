import { useEffect, useRef } from "react";
import {
  buildTools,
  type QuizActions,
  type QuizPhase,
  type QuizSnapshot,
} from "./tools";

/**
 * WebMCP 模式开关打开时，按页面阶段把工具注册到 document.modelContext；
 * 关闭模式或切换阶段时，通过 AbortController 注销上一组工具。
 *
 * - 不支持 WebMCP 的浏览器直接 no-op（UI 侧开关会锁定）；
 * - snap / actions 用 ref 透传，工具只在 mode/phase 变化时注册，但 execute 永远读到最新状态；
 * - cancelled 守卫防止 StrictMode 双挂载 / 快速切阶段时的重复注册。
 */
export function useWebMcpTools(
  enabled: boolean,
  phase: QuizPhase,
  getSnapshot: () => QuizSnapshot,
  actions: QuizActions,
) {
  const snapshotRef = useRef(getSnapshot);
  const actionsRef = useRef(actions);
  snapshotRef.current = getSnapshot;
  actionsRef.current = actions;

  useEffect(() => {
    if (!enabled) return;
    const modelContext = document.modelContext;
    if (!modelContext) return;

    const controller = new AbortController();
    let cancelled = false;
    const tools = buildTools(
      phase,
      () => snapshotRef.current(),
      () => actionsRef.current,
    );

    void (async () => {
      for (const tool of tools) {
        if (cancelled) return;
        try {
          await modelContext.registerTool(tool, { signal: controller.signal });
        } catch (error) {
          // 注册失败不影响页面本身可用性，仅在控制台留痕
          if (!cancelled) console.warn(`[webmcp] 工具 ${tool.name} 注册失败:`, error);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, phase]);
}
