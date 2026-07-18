import { isLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import type { OutputConfig } from '@/lib/interfaces/spec/validate'

const MAX_OUTPUT_BYTES = 64_000

function getPathValue(root: unknown, path: string): unknown {
  if (!path) return root
  const parts = path.split('.')
  let current: unknown = root
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Strip LargeValueRef pointers (including nested) from selected values.
 * Shared by Interface and Full-stack Apps public execute surfaces.
 */
export function sanitizePublicValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (isLargeValueRef(value)) {
    if (typeof value.preview === 'string') return value.preview
    if (value.preview !== undefined && value.preview !== null) {
      return sanitizePublicValue(value.preview, seen)
    }
    return '[Output too large]'
  }

  if (value == null || typeof value !== 'object') {
    return value
  }

  if (seen.has(value)) {
    return '[Circular]'
  }
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => sanitizePublicValue(item, seen))
  }

  const out: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = sanitizePublicValue(nested, seen)
  }
  return out
}

function truncateJson(value: unknown): unknown {
  try {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) return value
    if (encoded.length <= MAX_OUTPUT_BYTES) return value
    return {
      truncated: true,
      preview: `${encoded.slice(0, MAX_OUTPUT_BYTES)}…`,
    }
  } catch {
    return { error: 'Output could not be serialized' }
  }
}

export interface InterfaceExecuteResponse {
  success: boolean
  output?: unknown
  error?: string
}

/**
 * Build the public execute response. Empty outputConfigs ⇒ `{ success: true }` only.
 *
 * Selected outputs are returned as opaque ordered values (no `blockId.path` keys):
 * - one config → the value itself (strings can render as markdown)
 * - many configs → `{ values: [...] }`
 */
export function buildInterfaceExecuteResponse(params: {
  success: boolean
  error?: string
  resultOutput?: unknown
  blockOutputs?: Record<string, unknown>
  outputConfigs?: OutputConfig[] | null
}): InterfaceExecuteResponse {
  if (!params.success) {
    return {
      success: false,
      error: params.error || 'Workflow execution failed',
    }
  }

  const configs = params.outputConfigs || []
  if (configs.length === 0) {
    return { success: true }
  }

  const values = configs.map((config) => {
    const blockData = params.blockOutputs?.[config.blockId]
    const raw =
      blockData !== undefined
        ? getPathValue(blockData, config.path)
        : getPathValue(params.resultOutput, `${config.blockId}.${config.path}`)
    return sanitizePublicValue(raw)
  })

  const output = values.length === 1 ? values[0] : { values }

  return {
    success: true,
    output: truncateJson(output),
  }
}

export const PUBLIC_SAFE_ERRORS = new Set([
  'Interface needs republishing',
  'Unknown action',
  'Workflow execution failed',
  'This interface is not available',
  'Human-in-the-loop workflows are not supported for interfaces',
  'Request timed out',
  'Too many requests',
])

/**
 * Allowlist for public responses. Exact matches only — never pass through
 * prefix-matched execution errors (e.g. "Invalid API key…").
 */
export function toPublicSafeError(message: string, fallback = 'Something went wrong'): string {
  if (PUBLIC_SAFE_ERRORS.has(message)) return message
  return fallback
}

/**
 * Allowlist for client input / payload-builder validation errors only.
 * Do not use for workflow `result.error` strings.
 */
export function toPublicSafeInputError(message: string, fallback = 'Something went wrong'): string {
  if (PUBLIC_SAFE_ERRORS.has(message)) return message
  if (message.startsWith('Missing required field')) return message
  if (message.startsWith('Invalid ')) return message
  if (message.startsWith('Unknown control')) return message
  if (message.startsWith('Invalid option')) return message
  return fallback
}
