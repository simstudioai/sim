import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits'

export { DEFAULT_EXECUTION_TIMEOUT_MS }

/**
 * Maximum inline source size accepted by document preview endpoints.
 *
 * This is intentionally much lower than Next.js's default 10MB proxy body cap:
 * preview requests send user-authored source code, not binary uploads. Keeping
 * the limit at 1MB gives generous headroom for real PPTX/PDF generator scripts
 * while reducing memory pressure and abuse potential from oversized payloads.
 */
export const MAX_DOCUMENT_PREVIEW_CODE_BYTES = 1 * 1024 * 1024
