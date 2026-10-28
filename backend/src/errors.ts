/**
 * RFC 9457 Problem Details for HTTP APIs
 * https://www.rfc-editor.org/rfc/rfc9457
 */

import type { ProblemDetails } from './types.ts';

export function createProblemDetails(
  status: number,
  code: string,
  title: string,
  detail: string,
  requestId: string
): ProblemDetails {
  return {
    type: `https://api.docmac.app/problems/${code.toLowerCase().replace(/_/g, '-')}`,
    title,
    status,
    code,
    detail,
    requestId,
  };
}

export function problemResponse(
  status: number,
  code: string,
  title: string,
  detail: string,
  requestId: string,
  extraHeaders: Record<string, string> = {}
): Response {
  const body = createProblemDetails(status, code, title, detail, requestId);
  return new Response(JSON.stringify(body, null, 2) + '\n', {
    status,
    headers: {
      'Content-Type': 'application/problem+json; charset=utf-8',
      'X-Request-Id': requestId,
      ...extraHeaders,
    },
  });
}

