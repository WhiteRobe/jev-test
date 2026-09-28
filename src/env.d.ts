/// <reference types="vite/client" />

// ---------- WebMCP（document.modelContext）最小类型声明 ----------
// API 处于 Origin Trial（Chrome 149+），官方类型包为 webmcp-types；
// 本项目只用到注册 / 注销能力，这里手写一份最小声明避免依赖网络安装。
// 文档：https://developer.chrome.com/docs/ai/webmcp/imperative-api

interface ModelContextToolAnnotations {
  /** 只读，不改变页面状态 */
  readOnlyHint?: boolean;
  /** 输出含不可信数据（如 UGC），需防间接提示注入 */
  untrustedContentHint?: boolean;
  /** 会产生重大 / 不可逆的真实世界后果，可能触发用户确认 */
  consequentialHint?: boolean;
  /** 仅用于开发 / 调试（Chrome 156+） */
  debugging?: boolean;
}

interface ModelContextTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ModelContextToolAnnotations;
  execute: (input: unknown, context: { signal: AbortSignal }) => Promise<string>;
}

interface ModelContext {
  registerTool(
    tool: ModelContextTool,
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ): Promise<void>;
  getTools(options?: { fromOrigins?: string[] }): Promise<ModelContextTool[]>;
  executeTool(
    tool: ModelContextTool,
    input?: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  addEventListener(type: string, listener: (event: Event) => void): void;
}

interface Document {
  /** 不支持 WebMCP 的浏览器上为 undefined，使用前需特性检测 */
  readonly modelContext?: ModelContext;
}
