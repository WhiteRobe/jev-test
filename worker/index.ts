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
    return env.ASSETS.fetch(request);
  },
};
