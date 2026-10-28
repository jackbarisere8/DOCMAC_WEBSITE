/**
 * Docmac Release Service — Cloudflare Workers Entrypoint
 */

import type { Env } from './types.ts';
import { handleRequest } from './router.ts';

export default {
  async fetch(request: Request, env: Env, ctx?: unknown): Promise<Response> {
    return handleRequest(request, env);
  },
};

