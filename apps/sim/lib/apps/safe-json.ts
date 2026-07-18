/**
 * Serialize JSON for embedding inside a <script> tag.
 * Escapes `<`, U+2028, U+2029 so `</script>` and line separators cannot break out.
 */
export function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

export type SimAppConfig = {
  publicId: string
  slug: string
  releaseId: string
  gatewayOrigin: string
}

export function renderSimAppConfigScript(config: SimAppConfig, nonce: string): string {
  const json = safeJsonForScript(config)
  return `<script nonce="${nonce}">window.__SIM_APP_CONFIG=${json};</script>`
}
