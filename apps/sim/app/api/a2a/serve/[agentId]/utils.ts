import type {
  AgentCard,
  Artifact,
  Message,
  Task,
  TaskState,
  TaskStatus,
  TaskStatusUpdateEvent,
} from '@a2a-js/sdk'
import { db } from '@sim/db'
import { a2aAgent } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { buildAgentCard } from '@/lib/a2a/agent-card'
import type { AgentAuthentication, AgentCapabilities, AgentSkill } from '@/lib/a2a/types'
import { generateInternalToken } from '@/lib/auth/internal'
import { getRedisClient } from '@/lib/core/config/redis'
import { getBaseUrl, getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { getBrandConfig } from '@/ee/whitelabeling'

const logger = createLogger('A2AServeUtils')

const AGENT_CARD_CACHE_TTL_SECONDS = 60

export type ServedAgentCardResult =
  | { ok: true; card: AgentCard; cacheHit: boolean }
  | { ok: false; status: number; error: string }

/**
 * Load and build the public {@link AgentCard} for a published agent.
 *
 * Shared by the serve GET endpoint and the `.well-known/agent-card.json`
 * discovery endpoint. Caches the built card in Redis (best-effort).
 */
export async function getServedAgentCard(agentId: string): Promise<ServedAgentCardResult> {
  const redis = getRedisClient()
  const cacheKey = `a2a:agent:${agentId}:card`

  if (redis) {
    try {
      const cached = await redis.get(cacheKey)
      if (cached) {
        return { ok: true, card: JSON.parse(cached) as AgentCard, cacheHit: true }
      }
    } catch (err) {
      logger.warn('Redis cache read failed', { agentId, error: err })
    }
  }

  const [agent] = await db
    .select({
      id: a2aAgent.id,
      name: a2aAgent.name,
      description: a2aAgent.description,
      version: a2aAgent.version,
      capabilities: a2aAgent.capabilities,
      skills: a2aAgent.skills,
      authentication: a2aAgent.authentication,
      isPublished: a2aAgent.isPublished,
    })
    .from(a2aAgent)
    .where(and(eq(a2aAgent.id, agentId), isNull(a2aAgent.archivedAt)))
    .limit(1)

  if (!agent) {
    return { ok: false, status: 404, error: 'Agent not found' }
  }

  if (!agent.isPublished) {
    return { ok: false, status: 404, error: 'Agent not published' }
  }

  const card = buildAgentCard({
    agent: {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      version: agent.version,
      capabilities: agent.capabilities as AgentCapabilities,
      skills: agent.skills as AgentSkill[],
      authentication: agent.authentication as AgentAuthentication,
    },
    baseUrl: getBaseUrl(),
    providerOrganization: getBrandConfig().name,
  })

  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(card), 'EX', AGENT_CARD_CACHE_TTL_SECONDS)
    } catch (err) {
      logger.warn('Redis cache write failed', { agentId, error: err })
    }
  }

  return { ok: true, card, cacheHit: false }
}

export function createTaskStatus(state: TaskState): TaskStatus {
  return { state, timestamp: new Date().toISOString() }
}

export function buildTaskResponse(params: {
  taskId: string
  contextId: string
  state: TaskState
  history: Message[]
  artifacts?: Artifact[]
}): Task {
  return {
    kind: 'task',
    id: params.taskId,
    contextId: params.contextId,
    status: createTaskStatus(params.state),
    history: params.history,
    artifacts: params.artifacts || [],
  }
}

export function buildStatusUpdate(params: {
  taskId: string
  contextId: string
  state: TaskState
  final: boolean
}): TaskStatusUpdateEvent {
  return {
    kind: 'status-update',
    taskId: params.taskId,
    contextId: params.contextId,
    status: createTaskStatus(params.state),
    final: params.final,
  }
}

export function formatTaskResponse(task: Task, historyLength?: number): Task {
  if (historyLength !== undefined && task.history) {
    return {
      ...task,
      history: task.history.slice(-historyLength),
    }
  }
  return task
}

export interface ExecuteRequestConfig {
  workflowId: string
  apiKey?: string | null
  userId?: string
  stream?: boolean
}

export interface ExecuteRequestResult {
  url: string
  headers: Record<string, string>
  useInternalAuth: boolean
}

export async function buildExecuteRequest(
  config: ExecuteRequestConfig
): Promise<ExecuteRequestResult> {
  const url = `${getInternalApiBaseUrl()}/api/workflows/${config.workflowId}/execute`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  let useInternalAuth = false

  if (config.apiKey) {
    headers['X-API-Key'] = config.apiKey
  } else {
    const internalToken = await generateInternalToken(config.userId)
    headers.Authorization = `Bearer ${internalToken}`
    useInternalAuth = true
  }

  if (config.stream) {
    headers['X-Stream-Response'] = 'true'
  }

  return { url, headers, useInternalAuth }
}

export function extractAgentContent(executeResult: {
  output?: { content?: string; [key: string]: unknown }
  error?: string
}): string {
  if (executeResult.output?.content) {
    return executeResult.output.content
  }

  if (typeof executeResult.output === 'object' && executeResult.output !== null) {
    const keys = Object.keys(executeResult.output)
    if (keys.length > 0 && keys.some((k) => executeResult.output![k] !== undefined)) {
      return JSON.stringify(executeResult.output)
    }
  }

  return executeResult.error || 'Task completed'
}
