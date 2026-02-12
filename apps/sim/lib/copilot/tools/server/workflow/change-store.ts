import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { getRedisClient } from '@/lib/core/config/redis'

type StoreEntry<T> = {
  value: T
  expiresAt: number
}

const DEFAULT_TTL_MS = 30 * 60 * 1000
const MAX_ENTRIES = 500
const DEFAULT_TTL_SECONDS = Math.floor(DEFAULT_TTL_MS / 1000)
const CONTEXT_PREFIX = 'copilot:workflow_change:context'
const PROPOSAL_PREFIX = 'copilot:workflow_change:proposal'

const logger = createLogger('WorkflowChangeStore')

class TTLStore<T> {
  private readonly data = new Map<string, StoreEntry<T>>()

  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {}

  set(value: T): string {
    this.gc()
    if (this.data.size >= MAX_ENTRIES) {
      const firstKey = this.data.keys().next().value as string | undefined
      if (firstKey) {
        this.data.delete(firstKey)
      }
    }
    const id = crypto.randomUUID()
    this.data.set(id, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    })
    return id
  }

  get(id: string): T | null {
    const entry = this.data.get(id)
    if (!entry) return null
    if (entry.expiresAt <= Date.now()) {
      this.data.delete(id)
      return null
    }
    return entry.value
  }

  private gc(): void {
    const now = Date.now()
    for (const [key, entry] of this.data.entries()) {
      if (entry.expiresAt <= now) {
        this.data.delete(key)
      }
    }
  }
}

export type WorkflowContextPack = {
  workflowId: string
  snapshotHash: string
  workflowState: {
    blocks: Record<string, any>
    edges: Array<Record<string, any>>
    loops: Record<string, any>
    parallels: Record<string, any>
  }
  schemasByType: Record<string, any>
  schemaRefsByType: Record<string, string>
  summary: Record<string, any>
}

export type WorkflowChangeProposal = {
  workflowId: string
  baseSnapshotHash: string
  compiledOperations: Array<Record<string, any>>
  diffSummary: Record<string, any>
  warnings: string[]
  diagnostics: string[]
  touchedBlocks: string[]
  resolvedIds?: Record<string, string>
  acceptanceAssertions: string[]
  postApply?: {
    verify?: boolean
    run?: Record<string, any>
    evaluator?: Record<string, any>
  }
  handoff?: {
    objective?: string
    constraints?: string[]
    resolvedIds?: Record<string, string>
    assumptions?: string[]
    unresolvedRisks?: string[]
  }
}

const contextPackStore = new TTLStore<WorkflowContextPack>()
const proposalStore = new TTLStore<WorkflowChangeProposal>()

function getContextRedisKey(id: string): string {
  return `${CONTEXT_PREFIX}:${id}`
}

function getProposalRedisKey(id: string): string {
  return `${PROPOSAL_PREFIX}:${id}`
}

async function writeRedisJson(key: string, value: unknown): Promise<void> {
  const redis = getRedisClient()!
  await redis.set(key, JSON.stringify(value), 'EX', DEFAULT_TTL_SECONDS)
}

async function readRedisJson<T>(key: string): Promise<T | null> {
  const redis = getRedisClient()!

  const raw = await redis.get(key)
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as T
  } catch (error) {
    logger.warn('Failed parsing workflow change store JSON payload', { key, error })
    await redis.del(key).catch(() => {})
    return null
  }
}

export async function saveContextPack(pack: WorkflowContextPack): Promise<string> {
  if (!getRedisClient()) {
    return contextPackStore.set(pack)
  }
  const id = crypto.randomUUID()
  try {
    await writeRedisJson(getContextRedisKey(id), pack)
    return id
  } catch (error) {
    logger.warn('Redis write failed for workflow context pack, using memory fallback', { error })
    return contextPackStore.set(pack)
  }
}

export async function getContextPack(id: string): Promise<WorkflowContextPack | null> {
  if (!getRedisClient()) {
    return contextPackStore.get(id)
  }
  try {
    const redisPayload = await readRedisJson<WorkflowContextPack>(getContextRedisKey(id))
    if (redisPayload) {
      return redisPayload
    }
  } catch (error) {
    logger.warn('Redis read failed for workflow context pack, using memory fallback', { error })
  }
  return contextPackStore.get(id)
}

export async function saveProposal(proposal: WorkflowChangeProposal): Promise<string> {
  if (!getRedisClient()) {
    return proposalStore.set(proposal)
  }
  const id = crypto.randomUUID()
  try {
    await writeRedisJson(getProposalRedisKey(id), proposal)
    return id
  } catch (error) {
    logger.warn('Redis write failed for workflow proposal, using memory fallback', { error })
    return proposalStore.set(proposal)
  }
}

export async function getProposal(id: string): Promise<WorkflowChangeProposal | null> {
  if (!getRedisClient()) {
    return proposalStore.get(id)
  }
  try {
    const redisPayload = await readRedisJson<WorkflowChangeProposal>(getProposalRedisKey(id))
    if (redisPayload) {
      return redisPayload
    }
  } catch (error) {
    logger.warn('Redis read failed for workflow proposal, using memory fallback', { error })
  }
  return proposalStore.get(id)
}
