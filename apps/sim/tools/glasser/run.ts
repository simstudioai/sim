import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import type { GlasserResponse, GlasserRun, GlasserRunOutput } from '@/tools/glasser/types'
import type { OutputProperty, ToolConfig } from '@/tools/types'

export const GLASSER_API_BASE = 'https://api.glasser.ai'

/** RFC 9110 product token; Glasser reads the first token as the client name and version. */
const USER_AGENT = 'sim-glasser/1.0.0 (+https://github.com/simstudioai/sim)'

const POLL_INTERVAL_MS = 2000
const MAX_POLL_TIME_MS = 180000
/** Tolerate brief outages while polling before giving up on a run that is already started. */
const MAX_CONSECUTIVE_POLL_ERRORS = 3

const TERMINAL_STATUSES = new Set<GlasserRun['status']>(['COMPLETED', 'FAILED', 'STOPPED'])

export function solutionUrl(capability: string): string {
  return `${GLASSER_API_BASE}/v1/solutions/gtm/${capability}`
}

/**
 * Every call carries a fresh Idempotency-Key. One key binds to one run, so a
 * transport retry of the same request reads the original run instead of paying twice.
 */
export function glasserHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': generateId(),
    'User-Agent': USER_AGENT,
  }
}

/** Comma-separated text, or an array already, into the list the API takes. */
export function toList(value: unknown): string[] | undefined {
  const parts = Array.isArray(value)
    ? value.map((item) => String(item).trim())
    : typeof value === 'string'
      ? value.split(',').map((item) => item.trim())
      : []
  const list = parts.filter((item) => item.length > 0)
  return list.length > 0 ? list : undefined
}

/**
 * Drop blank values so the API sees only what the user set. Validation stays on
 * the API side, so its own message about a missing or conflicting field reaches the user.
 */
export function compactBody(body: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length === 0) continue
      result[key] = trimmed
      continue
    }
    if (Array.isArray(value) && value.length === 0) continue
    result[key] = value
  }
  return result
}

export function mapRun(run: GlasserRun): GlasserRunOutput {
  return {
    id: run.id,
    run_url: run.run_url,
    status: run.status,
    provider: run.provider,
    endpoint: run.endpoint,
    output: run.output ?? null,
    charge_usd: run.charge_usd ?? null,
    failure: run.failure ?? null,
    task_id: run.task_id ?? null,
  }
}

function runResult(run: GlasserRun): GlasserResponse {
  const output = mapRun(run)
  if (run.status === 'FAILED') {
    return {
      success: false,
      error: run.failure?.message ?? `Glasser run ${run.id} failed`,
      output,
    }
  }
  if (run.status === 'STOPPED') {
    return { success: false, error: `Glasser run ${run.id} was stopped`, output }
  }
  return { success: true, output }
}

/** The Solution answers with the Run itself, complete (200) or still in flight (202). */
export const transformRun: ToolConfig<{ apiKey: string }, GlasserResponse>['transformResponse'] =
  async (response: Response) => runResult((await response.json()) as GlasserRun)

/**
 * A run that came back QUEUED or RUNNING is read from `GET /v1/runs/{id}` until it is
 * terminal or the budget is spent. Used as every Glasser tool's `postProcess`. It never throws:
 * a thrown error would make the executor fall back to the initial in-flight result, so every
 * failure is returned as a bounded `success: false` instead.
 */
export async function pollRun(
  result: GlasserResponse,
  params: { apiKey: string }
): Promise<GlasserResponse> {
  if (!result.success || TERMINAL_STATUSES.has(result.output.status)) return result

  const runId = result.output.id
  if (!runId) {
    return { success: false, error: 'Glasser did not return a run id', output: result.output }
  }

  let elapsed = 0
  let consecutiveErrors = 0
  while (elapsed < MAX_POLL_TIME_MS) {
    await sleep(POLL_INTERVAL_MS)
    elapsed += POLL_INTERVAL_MS

    let failure: string | null = null
    try {
      const response = await fetch(`${GLASSER_API_BASE}/v1/runs/${encodeURIComponent(runId)}`, {
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          'User-Agent': USER_AGENT,
        },
      })
      if (response.ok) {
        const run = (await response.json()) as GlasserRun
        if (TERMINAL_STATUSES.has(run.status)) return runResult(run)
        consecutiveErrors = 0
        continue
      }
      const errorText = await response.text().catch(() => '')
      failure = `Glasser API error: ${response.status} - ${errorText}`
    } catch (error) {
      failure = `Glasser polling failed: ${getErrorMessage(error)}`
    }

    consecutiveErrors += 1
    if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
      return { success: false, error: failure, output: result.output }
    }
  }

  return {
    success: false,
    error: `Glasser run ${runId} did not complete within the polling window`,
    output: result.output,
  }
}

/** Shared output contract: the Run envelope plus the provider-native payload. */
export const RUN_OUTPUTS: Record<string, OutputProperty> = {
  id: { type: 'string', description: 'Run ID' },
  run_url: { type: 'string', description: 'Link to the run in the Glasser console' },
  status: { type: 'string', description: 'COMPLETED, FAILED or STOPPED once the tool returns' },
  provider: {
    type: 'string',
    description: 'Data provider that served the call (e.g. apollo, serper, ahrefs)',
  },
  endpoint: { type: 'string', description: 'Provider endpoint that served the call' },
  output: {
    type: 'json',
    description:
      'Provider-native result. Its shape depends on the provider and endpoint named in this run.',
  },
  charge_usd: {
    type: 'string',
    description: 'Exact USD charge for this run as a decimal string, e.g. "0.01"',
    optional: true,
  },
  failure: {
    type: 'json',
    description: 'Why the run failed (kind, message), null on success',
    optional: true,
  },
  task_id: {
    type: 'string',
    description: 'Task the run was filed under, when one was given',
    optional: true,
  },
}

export const COMMON_PARAMS = {
  apiKey: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Glasser API key',
  },
  provider: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Data provider: auto (default) lets Glasser pick and fall back; a named provider forces it. Name one only when the caller asks for that vendor.',
  },
  task_id: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Task this call belongs to. Reuse one value across the calls made for one piece of work so they are recorded together.',
  },
  limit: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Rows to return (1-100). Keep it small: the charge may depend on it.',
  },
} as const
