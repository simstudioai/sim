/**
 * A2A Protocol Utilities (v0.3)
 *
 * App-specific utilities. SDK handles protocol-level operations.
 */

import type { Message, Part, Task, TaskState, TextPart } from '@a2a-js/sdk'
import { A2A_TERMINAL_STATES } from './constants'

/**
 * Check if a task is in a terminal state
 */
export function isTerminalState(state: TaskState): boolean {
  return (A2A_TERMINAL_STATES as readonly string[]).includes(state)
}

/**
 * Extract text content from a message
 */
export function extractTextContent(message: Message): string {
  return message.parts
    .filter((part): part is TextPart => part.kind === 'text')
    .map((part) => part.text)
    .join('\n')
}

/**
 * Create a text part (SDK format)
 */
export function createTextPart(text: string): Part {
  return { kind: 'text', text }
}

/**
 * Create a user message (SDK format)
 */
export function createUserMessage(text: string): Message {
  return {
    kind: 'message',
    messageId: crypto.randomUUID(),
    role: 'user',
    parts: [{ kind: 'text', text }],
  }
}

/**
 * Create an agent message (SDK format)
 */
export function createAgentMessage(text: string): Message {
  return {
    kind: 'message',
    messageId: crypto.randomUUID(),
    role: 'agent',
    parts: [{ kind: 'text', text }],
  }
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

/**
 * Get last agent message from task history
 */
export function getLastAgentMessage(task: Task): Message | undefined {
  return task.history?.filter((m) => m.role === 'agent').pop()
}

/**
 * Get last agent message text from task
 */
export function getLastAgentMessageText(task: Task): string {
  const message = getLastAgentMessage(task)
  return message ? extractTextContent(message) : ''
}
