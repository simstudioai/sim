import type {
  MintlifyAgentJobOutput,
  MintlifyTrafficRow,
  MintlifyTrafficTotals,
} from '@/tools/mintlify/types'
import type { ToolOutputProperty } from '@/tools/types'

/** Single origin for the platform REST, admin, analytics, and discovery APIs. */
export const MINTLIFY_API_BASE = 'https://api.mintlify.com'

/**
 * Encodes an identifier for use in a URL path, trimming the whitespace a
 * copy-pasted project ID, domain, or job ID commonly carries.
 */
export function pathSegment(value: string): string {
  return encodeURIComponent(value.trim())
}

/**
 * Builds the bearer auth headers every Mintlify endpoint expects. Admin
 * (`mint_`) and assistant (`mint_dsc_`) keys use the same header shape.
 */
export function mintlifyHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
}

/**
 * Reads a Mintlify JSON body, throwing a descriptive error for non-2xx
 * responses. Tolerates an empty body (204) and the `text/plain` body the
 * rate-limit responses return.
 */
export async function readMintlifyJson(
  response: Response,
  fallbackMessage: string
): Promise<Record<string, unknown>> {
  const text = await response.text()

  if (!response.ok) {
    let message = text.trim()
    try {
      const parsed = JSON.parse(text)
      message = parsed?.error || parsed?.message || message
    } catch {
      // Non-JSON error bodies (for example the plain-text 429) are used verbatim.
    }
    throw new Error(message || `${fallbackMessage} (HTTP ${response.status})`)
  }

  if (!text.trim()) return {}
  return JSON.parse(text)
}

/**
 * Normalizes a `json`-typed tool param that may arrive as a parsed array (from
 * a block-to-block reference) or as a JSON string (from a long-input field or
 * an LLM tool call). Also accepts a comma-separated list of plain strings.
 */
export function toStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item)).filter((item) => item.length > 0)
    return items.length > 0 ? items : undefined
  }
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) {
      throw new Error('Expected a JSON array of strings')
    }
    return toStringArray(parsed)
  }

  const items = trimmed
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return items.length > 0 ? items : undefined
}

/**
 * Normalizes a `json`-typed tool param holding an array of objects, parsing it
 * first when the executor delivered it as a JSON string.
 */
export function toObjectArray(value: unknown): Record<string, unknown>[] | undefined {
  if (value === undefined || value === null || value === '') return undefined

  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  if (!Array.isArray(parsed)) {
    throw new Error('Expected a JSON array')
  }
  return parsed.length > 0 ? (parsed as Record<string, unknown>[]) : undefined
}

/** Appends a query parameter only when the value is present and non-empty. */
export function appendParam(url: URL, key: string, value: string | number | undefined): void {
  if (value === undefined || value === null || value === '') return
  url.searchParams.set(key, String(value))
}

/** Normalizes a nullable number field from a Mintlify response. */
export function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Normalizes a nullable string field from a Mintlify response. */
export function toNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Maps the `AgentJob` payload returned identically by create-job, get-job, and
 * send-message.
 */
export function toAgentJobOutput(data: Record<string, unknown>): MintlifyAgentJobOutput {
  const source = data.source as Record<string, unknown> | undefined

  return {
    id: toNullableString(data.id),
    status: toNullableString(data.status),
    source: source
      ? {
          repository: toNullableString(source.repository),
          ref: toNullableString(source.ref),
        }
      : null,
    model: toNullableString(data.model),
    prLink: toNullableString(data.prLink),
    createdAt: toNullableString(data.createdAt),
    archivedAt: toNullableString(data.archivedAt),
  }
}

/** Maps the site-wide human/AI totals shared by the views and visitors endpoints. */
export function toTrafficTotals(value: unknown): MintlifyTrafficTotals | null {
  if (!value || typeof value !== 'object') return null
  const totals = value as Record<string, unknown>
  return {
    human: toNullableNumber(totals.human),
    ai: toNullableNumber(totals.ai),
    total: toNullableNumber(totals.total),
  }
}

/** Maps the per-path human/AI rows shared by the views and visitors endpoints. */
export function toTrafficRows(value: unknown): MintlifyTrafficRow[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>
    return {
      path: toNullableString(row.path),
      human: toNullableNumber(row.human),
      ai: toNullableNumber(row.ai),
      total: toNullableNumber(row.total),
    }
  })
}

/** Output schema for the site-wide totals object. */
export const TRAFFIC_TOTALS_OUTPUT: ToolOutputProperty = {
  type: 'object',
  description: 'Site-wide totals for the date range',
  nullable: true,
  properties: {
    human: { type: 'number', description: 'Site-wide human traffic', nullable: true },
    ai: { type: 'number', description: 'Site-wide AI bot traffic', nullable: true },
    total: { type: 'number', description: 'Site-wide total', nullable: true },
  },
}

/** Output schema shared by the three agent-job tools. */
export const AGENT_JOB_OUTPUTS: Record<string, ToolOutputProperty> = {
  id: { type: 'string', description: 'Unique identifier for the agent job', nullable: true },
  status: {
    type: 'string',
    description: 'Current job status: active, completed, archived, or failed',
    nullable: true,
  },
  source: {
    type: 'object',
    description: 'Source repository information',
    nullable: true,
    properties: {
      repository: { type: 'string', description: 'Full GitHub repository URL', nullable: true },
      ref: { type: 'string', description: 'Git branch the agent is working on', nullable: true },
    },
  },
  model: { type: 'string', description: 'AI model used for this job', nullable: true },
  prLink: {
    type: 'string',
    description:
      'GitHub pull request URL created by the agent. Null while the job is active or if no files changed.',
    nullable: true,
  },
  createdAt: { type: 'string', description: 'Timestamp when the job was created', nullable: true },
  archivedAt: {
    type: 'string',
    description: 'Timestamp when the job was archived',
    nullable: true,
  },
}
