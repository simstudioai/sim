import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import type { BrowserUseRunV4Params, BrowserUseRunV4Response } from '@/tools/browser_use/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const logger = createLogger('BrowserUseV4Tool')

const API_BASE = 'https://api.browser-use.com/api/v4'
const POLL_INTERVAL_MS = 2000
const MAX_POLL_TIME_MS = getMaxExecutionTimeout()
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])

interface V4RunCreateResponse {
  id: string
  status: string
  model: string
  sessionId: string
  workspaceId: string
}

interface V4RunSummary extends V4RunCreateResponse {
  result: string | null
  error: string | null
  totalCostUsd: string
  totalInputTokens: number
  totalOutputTokens: number
}

interface SecretBindingRow {
  cells?: Record<string, unknown>
  [key: string]: unknown
}

interface V4SecretBinding {
  alias: string
  source: { type: 'inline'; value: string }
  allowedDomains: string[]
}

function readCell(row: SecretBindingRow, key: string): string {
  const value = row.cells?.[key] ?? row[key]
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeSecretBindings(input: unknown): V4SecretBinding[] {
  if (!Array.isArray(input)) return []

  const bindings: V4SecretBinding[] = []
  for (const rawRow of input) {
    if (!rawRow || typeof rawRow !== 'object') continue
    const row = rawRow as SecretBindingRow
    const alias = readCell(row, 'Alias')
    const value = readCell(row, 'Value')
    const allowedDomains = readCell(row, 'Allowed Domains')
      .split(',')
      .map((domain) => domain.trim())
      .filter(Boolean)

    if (alias && value && allowedDomains.length > 0) {
      bindings.push({ alias, source: { type: 'inline', value }, allowedDomains })
    }
  }
  return bindings
}

function emptyOutput(created?: V4RunCreateResponse): BrowserUseRunV4Response['output'] {
  return {
    id: created?.id ?? '',
    status: created?.status ?? 'failed',
    result: null,
    error: null,
    model: created?.model ?? '',
    sessionId: created?.sessionId ?? '',
    workspaceId: created?.workspaceId ?? null,
    totalCostUsd: '0',
    totalInputTokens: 0,
    totalOutputTokens: 0,
  }
}

async function readError(response: Response): Promise<string> {
  const text = await response.text()
  return text || response.statusText || `HTTP ${response.status}`
}

async function pollForCompletion(
  runId: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<{ summary?: V4RunSummary; error?: string }> {
  const deadline = Date.now() + MAX_POLL_TIME_MS

  for (;;) {
    signal?.throwIfAborted()
    const statusResponse = await fetch(`${API_BASE}/runs/${runId}/status`, {
      method: 'GET',
      headers: { 'X-Browser-Use-API-Key': apiKey },
      signal,
    })
    if (!statusResponse.ok) {
      return { error: `Failed to read run status: ${await readError(statusResponse)}` }
    }

    const { status } = (await statusResponse.json()) as { status: string }
    if (TERMINAL_STATUSES.has(status)) {
      const runResponse = await fetch(`${API_BASE}/runs/${runId}`, {
        method: 'GET',
        headers: { 'X-Browser-Use-API-Key': apiKey },
        signal,
      })
      if (!runResponse.ok) {
        return { error: `Failed to read completed run: ${await readError(runResponse)}` }
      }
      return { summary: (await runResponse.json()) as V4RunSummary }
    }

    if (Date.now() >= deadline) {
      return { error: `Run did not complete within ${MAX_POLL_TIME_MS / 1000}s` }
    }
    signal?.throwIfAborted()
    await sleep(POLL_INTERVAL_MS)
  }
}

export const runV4Tool: ToolConfig<BrowserUseRunV4Params, BrowserUseRunV4Response> = {
  id: 'browser_use_run_v4',
  name: 'Browser Use V4',
  description: 'Runs a Browser Use Cloud agent through the V4 run API',
  version: '1.0.0',

  params: {
    task: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'What the browser agent should do',
    },
    model: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'V4 model identifier',
    },
    sessionId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Existing V4 session ID for a follow-up turn',
    },
    workspaceId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Existing V4 workspace ID whose files should be restored',
    },
    profileId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Browser profile ID for stored cookies and browser state',
    },
    record: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Record the newly provisioned browser session',
    },
    agentmail: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Give the run a temporary AgentMail inbox',
    },
    maxCostUsd: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum run cost in US dollars',
    },
    secretBindings: {
      type: 'json',
      required: false,
      visibility: 'user-only',
      description: 'Run-scoped secrets with the domains where each may be typed',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Browser Use API key',
    },
  },

  request: {
    url: `${API_BASE}/runs`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'X-Browser-Use-API-Key': params.apiKey,
    }),
    modelInput: {
      mode: 'project',
      select: (params) => ({ task: params.task }),
    },
  },

  directExecution: async (
    params: BrowserUseRunV4Params,
    signal?: AbortSignal
  ): Promise<ToolResponse> => {
    const body: Record<string, unknown> = { task: params.task }
    if (params.model) body.model = params.model
    if (params.sessionId) body.sessionId = params.sessionId
    if (params.workspaceId) body.workspaceId = params.workspaceId
    if (typeof params.agentmail === 'boolean') body.agentmail = params.agentmail
    if (typeof params.maxCostUsd === 'number') body.maxCostUsd = params.maxCostUsd

    const secretBindings = normalizeSecretBindings(params.secretBindings)
    if (secretBindings.length > 0) body.secretBindings = secretBindings
    if (params.profileId || typeof params.record === 'boolean') {
      body.browserSettings = {
        ...(params.profileId ? { profileId: params.profileId } : {}),
        ...(typeof params.record === 'boolean' ? { record: params.record } : {}),
      }
    }

    try {
      const response = await fetch(`${API_BASE}/runs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Browser-Use-API-Key': params.apiKey,
        },
        body: JSON.stringify(body),
        signal,
      })
      if (!response.ok) {
        return {
          success: false,
          output: emptyOutput(),
          error: `Failed to create V4 run: ${await readError(response)}`,
        }
      }

      const created = (await response.json()) as V4RunCreateResponse
      logger.info(`Created Browser Use V4 run ${created.id}`)
      const completed = await pollForCompletion(created.id, params.apiKey, signal)
      if (!completed.summary) {
        return { success: false, output: emptyOutput(created), error: completed.error }
      }

      const run = completed.summary
      return {
        success: run.status === 'completed' && !run.error,
        output: {
          id: run.id,
          status: run.status,
          result: run.result ?? null,
          error: run.error ?? null,
          model: run.model,
          sessionId: run.sessionId,
          workspaceId: run.workspaceId ?? null,
          totalCostUsd: run.totalCostUsd,
          totalInputTokens: run.totalInputTokens,
          totalOutputTokens: run.totalOutputTokens,
        },
        error: run.error ?? undefined,
      }
    } catch (error: unknown) {
      logger.error('Error running Browser Use V4 agent:', error)
      return {
        success: false,
        output: emptyOutput(),
        error: `Error running V4 agent: ${getErrorMessage(error, 'Unknown error')}`,
      }
    }
  },

  outputs: {
    id: { type: 'string', description: 'V4 run identifier' },
    status: { type: 'string', description: 'Run status' },
    result: { type: 'string', description: 'Final agent result' },
    error: { type: 'string', description: 'Run error' },
    model: { type: 'string', description: 'Model used by the run' },
    sessionId: { type: 'string', description: 'V4 conversation session identifier' },
    workspaceId: { type: 'string', description: 'Persistent workspace identifier' },
    totalCostUsd: { type: 'string', description: 'Total run cost in US dollars' },
    totalInputTokens: { type: 'number', description: 'Total input tokens used' },
    totalOutputTokens: { type: 'number', description: 'Total output tokens used' },
  },
}
