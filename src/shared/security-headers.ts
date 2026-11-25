// Security headers added to every response from both Workers.

export function securityHeaders(opts: { csp: string }): Record<string, string> {
  return {
    "Content-Security-Policy": opts.csp,
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), payment=(), usb=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}

/**
 * Staff app: only our own scripts, styles, fonts and images. No outside sites at all.
 * 'wasm-unsafe-eval' lets the catalog import turn STEP files into 3D models in the browser
 * (occt-import-js is WebAssembly, served from our own site). It does not allow eval() of text.
 */
export const PORTAL_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/** Customer parts site: the staff rules, without WebAssembly (customers only view finished models). */
export const PARTS_CSP = PORTAL_CSP.replace(" 'wasm-unsafe-eval'", "");

/** Help center: server-rendered HTML with one inline stylesheet (hash-free, so 'unsafe-inline' for styles only). */
export const HELP_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");

export function withHeaders(res: Response, headers: Record<string, string>): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}
