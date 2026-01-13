/**
 * A2A Protocol Utilities (v0.3)
 *
 * App-specific utilities. SDK handles protocol-level operations.
 */

import type { DataPart, FilePart, Message, Part, Task, TaskState, TextPart } from '@a2a-js/sdk'
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
 * Extract structured data from DataParts in a message
 * Later parts override earlier ones if keys conflict
 */
export function extractDataContent(message: Message): Record<string, unknown> {
  const dataParts = message.parts.filter((part): part is DataPart => part.kind === 'data')
  return dataParts.reduce((acc, part) => ({ ...acc, ...part.data }), {})
}

/**
 * A2A file extracted from FilePart
 */
export interface A2AFile {
  name?: string
  mimeType?: string
  uri?: string
  bytes?: string
}

/**
 * Extract files from FileParts in a message
 */
export function extractFileContent(message: Message): A2AFile[] {
  return message.parts
    .filter((part): part is FilePart => part.kind === 'file')
    .map((part) => ({
      name: part.file.name,
      mimeType: part.file.mimeType,
      ...('uri' in part.file ? { uri: part.file.uri } : {}),
      ...('bytes' in part.file ? { bytes: part.file.bytes } : {}),
    }))
}

/**
 * File format expected by workflow execute endpoint for processing
 */
export interface ExecutionFileInput {
  type: 'file' | 'url'
  data: string
  name: string
  mime?: string
}

/**
 * Convert A2A FileParts to execution file format
 * This format is then processed by processInputFileFields in the execute endpoint
 * FileWithUri → type 'url', FileWithBytes → type 'file' with data URL
 * Files without uri or bytes are filtered out as invalid
 */
export function convertFilesToExecutionFormat(files: A2AFile[]): ExecutionFileInput[] {
  return files
    .filter((file) => file.uri || file.bytes) // Skip invalid files without content
    .map((file) => {
      if (file.uri) {
        return {
          type: 'url' as const,
          data: file.uri,
          name: file.name || 'file',
          mime: file.mimeType,
        }
      }
      // FileWithBytes - create data URL format (bytes guaranteed by filter)
      const dataUrl = `data:${file.mimeType || 'application/octet-stream'};base64,${file.bytes}`
      return {
        type: 'file' as const,
        data: dataUrl,
        name: file.name || 'file',
        mime: file.mimeType,
      }
    })
}

/**
 * Workflow input format extracted from A2A message parts
 */
export interface WorkflowInput {
  input: string
  data?: Record<string, unknown>
  files?: ExecutionFileInput[]
}

/**
 * Extract workflow input from an A2A message
 * Returns null if message has no content (empty parts)
 */
export function extractWorkflowInput(message: Message): WorkflowInput | null {
  const messageText = extractTextContent(message)
  const dataContent = extractDataContent(message)
  const fileContent = extractFileContent(message)
  const files = convertFilesToExecutionFormat(fileContent)
  const hasData = Object.keys(dataContent).length > 0

  // Return null if no content
  if (!messageText && !hasData && files.length === 0) {
    return null
  }

  return {
    input: messageText,
    ...(hasData ? { data: dataContent } : {}),
    ...(files.length > 0 ? { files } : {}),
  }
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
