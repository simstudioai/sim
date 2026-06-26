import { functionExecuteTool } from '@/tools/function'
import { httpRequestTool } from '@/tools/http'
import type { ToolConfig } from '@/tools/types'

/**
 * Dev-only minimal tool registry. Swapped in for `@/tools/registry` via a
 * Turbopack/webpack resolve-alias when `SIM_DEV_MINIMAL_REGISTRY=1` (see
 * next.config.ts) so the local dev server never compiles the full ~247-tool
 * graph (~2,074 modules) that the shared workspace layout otherwise drags into
 * every route. Only these tools execute in minimal mode; unset the flag for the
 * full set. NEVER aliased in production.
 */
export const tools: Record<string, ToolConfig> = {
  http_request: httpRequestTool,
  function_execute: functionExecuteTool,
}
