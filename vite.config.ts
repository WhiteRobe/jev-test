import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { handleQuestionApi } from "./server/questionApi";

/** Vite 内置的 connect 类型把 IncomingMessage 裁剪过，这里按实际用到的字段取 */
type RawRequest = {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
};

/**
 * 本地开发时把题目接口挂到 Vite 上：复用 Worker 里的同一份处理逻辑，
 * 这样 `npm run dev` 与 `wrangler dev` 的接口行为完全一致。
 */
function questionApiPlugin(): Plugin {
  const middleware: Connect.NextHandleFunction = (rawReq, res, next) => {
    const req = rawReq as unknown as RawRequest;
    if (!req.url?.startsWith("/api/")) {
      next();
      return;
    }
    const host = (typeof req.headers.host === "string" ? req.headers.host : "localhost");
    const response = handleQuestionApi(
      new Request(new URL(req.url, `http://${host}`), { method: req.method ?? "GET" }),
    );
    if (!response) {
      next();
      return;
    }
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    void response.text().then((body) => res.end(body));
  };
  return {
    name: "jev-test:question-api",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  plugins: [react(), questionApiPlugin()],
});
