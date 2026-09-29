// Cloudflare Worker 入口：只接管 /api/questions*，其余请求全部交给静态资源（SPA）。
// 手写最小环境类型，避免为运行时引入 @cloudflare/workers-types 依赖。
import { handleQuestionApi } from "../server/questionApi";

interface Env {
  /** wrangler.jsonc 中 assets 注入的静态资源绑定 */
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const api = handleQuestionApi(request);
    if (api) return api;
    // 非题目接口交给静态资源（SPA fallback）；绑定缺失时给明确报错，别让整个 Worker 崩掉
    if (!env.ASSETS) return new Response("静态资源绑定 ASSETS 缺失", { status: 500 });
    return env.ASSETS.fetch(request);
  },
};
