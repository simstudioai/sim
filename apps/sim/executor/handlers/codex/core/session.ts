/** Execution-scoped Codex agent instances and turn serialization. */

import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { CODEX_AGENT_ID_PATTERN } from '@/lib/codex/config'
import {
  createCodexSandbox,
  type ManagedCodingAgentSandboxRunner,
} from '@/lib/execution/remote-sandbox'
import { resolveCodexRunLifetimeMs } from '@/lib/execution/remote-sandbox/codex-lifetime'
import type { ExecutionContext } from '@/executor/types'
import type { CodexModel } from '@/providers/codex'

const logger = createLogger('CodexAgentSessions')
const CODEX_AGENT_POOL_RESOURCE_KEY = 'codex-agent-sessions'

export interface CodexAgentSessionSpec {
  agentId: string
  mode: 'cloud_plan' | 'cloud'
  model: CodexModel
  owner: string
  repo: string
  baseBranch?: string
}

export interface CodexAuthoringSessionState {
  initialized: boolean
  branch?: string
  baseSha?: string
  headSha?: string
  pushedHeadSha?: string
  detectedBase?: string
  gitConfigDigest?: string
  prUrl?: string
}

/** Mutable state retained with one live sandbox and one local Codex rollout. */
export interface CodexAgentSession {
  readonly spec: CodexAgentSessionSpec
  readonly runner: ManagedCodingAgentSandboxRunner
  threadId?: string
  turnCount: number
  planInitialized: boolean
  authoring: CodexAuthoringSessionState
}

export interface CodexAgentTurn {
  session: CodexAgentSession
  sessionReused: boolean
  turnNumber: number
}

interface CodexAgentSessionEntry {
  spec: CodexAgentSessionSpec
  ready: Promise<CodexAgentSession>
  tail: Promise<void>
}

interface CodexAgentSessionPool {
  sessions: Map<string, CodexAgentSessionEntry>
  closed: boolean
}

/** Uses the block id when no shared logical agent id was configured. */
export function parseCodexAgentId(value: unknown, blockId: string): string {
  const configured = typeof value === 'string' ? value.trim() : ''
  const agentId = configured || blockId
  if (!CODEX_AGENT_ID_PATTERN.test(agentId)) {
    throw new Error(
      'Agent ID must be 1-64 characters and contain only letters, numbers, dots, underscores, or hyphens.'
    )
  }
  return agentId
}

function normalizedSpec(spec: CodexAgentSessionSpec): CodexAgentSessionSpec {
  return {
    ...spec,
    ...(spec.baseBranch?.trim()
      ? { baseBranch: spec.baseBranch.trim() }
      : { baseBranch: undefined }),
  }
}

function assertCompatibleSession(
  existing: CodexAgentSessionSpec,
  requested: CodexAgentSessionSpec
): void {
  const fields = ['mode', 'model', 'owner', 'repo', 'baseBranch'] as const
  const mismatch = fields.find((field) => existing[field] !== requested[field])
  if (!mismatch) return
  throw new Error(
    `Codex Agent "${requested.agentId}" is already running with a different ${mismatch}. Use another Agent ID for a separate instance.`
  )
}

function ensureRuntimeResources(ctx: ExecutionContext) {
  if (!ctx.runtimeResources) {
    ctx.runtimeResources = { values: new Map(), cleanupCallbacks: new Set() }
  }
  return ctx.runtimeResources
}

async function closePool(pool: CodexAgentSessionPool): Promise<void> {
  if (pool.closed) return
  pool.closed = true
  const results = await Promise.allSettled(
    [...pool.sessions.values()].map(async (entry) => {
      const session = await entry.ready
      await session.runner.close()
    })
  )
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.warn('Failed to close Codex agent sandbox', {
        error: getErrorMessage(result.reason),
      })
    }
  }
  pool.sessions.clear()
}

function getPool(ctx: ExecutionContext): CodexAgentSessionPool {
  const resources = ensureRuntimeResources(ctx)
  const current = resources.values.get(CODEX_AGENT_POOL_RESOURCE_KEY)
  if (current) return current as CodexAgentSessionPool

  const pool: CodexAgentSessionPool = { sessions: new Map(), closed: false }
  resources.values.set(CODEX_AGENT_POOL_RESOURCE_KEY, pool)
  resources.cleanupCallbacks.add(() => closePool(pool))
  return pool
}

function createSessionEntry(
  ctx: ExecutionContext,
  spec: CodexAgentSessionSpec
): CodexAgentSessionEntry {
  const ready = createCodexSandbox({
    lifetimeMs: resolveCodexRunLifetimeMs(ctx.abortSignal),
  }).then((runner) => ({
    spec,
    runner,
    turnCount: 0,
    planInitialized: false,
    authoring: { initialized: false },
  }))
  return { spec, ready, tail: Promise.resolve() }
}

/**
 * Runs one turn against a named agent instance.
 *
 * Different agent ids own different sandboxes and can run concurrently. Turns
 * targeting the same id queue behind each other so a repository and its Codex
 * rollout can never be mutated concurrently.
 */
export async function withCodexAgentTurn<T>(
  ctx: ExecutionContext,
  requestedSpec: CodexAgentSessionSpec,
  callback: (turn: CodexAgentTurn) => Promise<T>
): Promise<T> {
  const spec = normalizedSpec(requestedSpec)
  const pool = getPool(ctx)
  if (pool.closed) throw new Error('Codex agent sessions are already closed for this execution')

  let entry = pool.sessions.get(spec.agentId)
  if (entry) {
    assertCompatibleSession(entry.spec, spec)
  } else {
    entry = createSessionEntry(ctx, spec)
    pool.sessions.set(spec.agentId, entry)
  }

  const prior = entry.tail.catch(() => {})
  let release = () => {}
  const occupied = new Promise<void>((resolve) => {
    release = resolve
  })
  entry.tail = prior.then(() => occupied)

  await prior
  try {
    const session = await entry.ready
    const turnNumber = session.turnCount + 1
    session.turnCount = turnNumber
    return await callback({ session, sessionReused: turnNumber > 1, turnNumber })
  } finally {
    release()
  }
}
