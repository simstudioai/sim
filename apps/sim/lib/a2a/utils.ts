/**
 * A2A Protocol Utilities
 */

import { v4 as uuidv4 } from 'uuid'
import { A2A_VALID_TRANSITIONS } from './constants'
import type { MessagePart, Task, TaskMessage, TaskState, TaskStatusObject, TextPart } from './types'

/**
 * Generate a unique task ID
 */
export function generateTaskId(): string {
  return uuidv4()
}

/**
 * Generate a unique context ID
 */
export function generateContextId(): string {
  return `ctx_${uuidv4()}`
}

/**
 * Check if a task status transition is valid
 */
export function isValidStatusTransition(from: TaskState, to: TaskState): boolean {
  const validTransitions = A2A_VALID_TRANSITIONS[from]
  return validTransitions?.includes(to) ?? false
}

/**
 * Check if a task is in a terminal state
 */
export function isTerminalState(state: TaskState): boolean {
  return state === 'completed' || state === 'failed' || state === 'canceled' || state === 'rejected'
}

/**
 * Create a TaskStatusObject from a state
 */
export function createTaskStatus(state: TaskState, message?: TaskMessage): TaskStatusObject {
  return {
    state,
    message,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Create a text message part
 */
export function createTextPart(text: string): TextPart {
  return { type: 'text', text }
}

/**
 * Create a user message
 */
export function createUserMessage(content: string | MessagePart[]): TaskMessage {
  const parts = typeof content === 'string' ? [createTextPart(content)] : content
  return { role: 'user', parts }
}

/**
 * Create an agent message
 */
export function createAgentMessage(content: string | MessagePart[]): TaskMessage {
  const parts = typeof content === 'string' ? [createTextPart(content)] : content
  return { role: 'agent', parts }
}

/**
 * Extract text content from a message
 */
export function extractTextContent(message: TaskMessage): string {
  return message.parts
    .filter((part): part is TextPart => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

/**
 * Extract text content from multiple messages
 */
export function extractConversationText(messages: TaskMessage[]): string {
  return messages.map((m) => `${m.role}: ${extractTextContent(m)}`).join('\n\n')
}

/**
 * Create an A2A tool ID from agent ID and skill ID
 */
export function createA2AToolId(agentId: string, skillId: string): string {
  return `a2a:${agentId}:${skillId}`
}

/**
 * Parse an A2A tool ID into components
 */
export function parseA2AToolId(toolId: string): { agentId: string; skillId: string } | null {
  const parts = toolId.split(':')
  if (parts.length !== 3 || parts[0] !== 'a2a') {
    return null
  }
  return { agentId: parts[1], skillId: parts[2] }
}

/**
 * Sanitize agent name for use as identifier
 */
export function sanitizeAgentName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 64)
}

/**
 * Validate task structure
 */
export function validateTask(task: unknown): task is Task {
  if (!task || typeof task !== 'object') return false
  const t = task as Record<string, unknown>

  if (typeof t.id !== 'string') return false
  if (!t.status || typeof t.status !== 'object') return false
  const status = t.status as Record<string, unknown>
  if (typeof status.state !== 'string') return false

  return true
}

/**
 * Create a minimal task object
 */
export function createTask(params: {
  id?: string
  contextId?: string
  state?: TaskState
  history?: TaskMessage[]
  metadata?: Record<string, unknown>
}): Task {
  return {
    id: params.id || generateTaskId(),
    contextId: params.contextId,
    status: createTaskStatus(params.state || 'submitted'),
    history: params.history || [],
    artifacts: [],
    metadata: params.metadata,
    kind: 'task',
  }
}

/**
 * Format task for API response (remove internal fields)
 */
export function formatTaskResponse(task: Task, historyLength?: number): Task {
  let history = task.history || []
  if (historyLength !== undefined && historyLength >= 0) {
    history = history.slice(-historyLength)
  }

  return {
    id: task.id,
    contextId: task.contextId,
    status: task.status,
    history,
    artifacts: task.artifacts,
    metadata: task.metadata,
    kind: 'task',
  }
}

/**
 * Build A2A endpoint URL
 */
export function buildA2AEndpointUrl(baseUrl: string, agentId: string): string {
  const base = baseUrl.replace(/\/$/, '')
  return `${base}/api/a2a/serve/${agentId}`
}

/**
 * Build Agent Card URL
 */
export function buildAgentCardUrl(baseUrl: string, agentId: string): string {
  const base = baseUrl.replace(/\/$/, '')
  return `${base}/api/a2a/agents/${agentId}`
}
