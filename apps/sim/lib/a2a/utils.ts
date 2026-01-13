import type { DataPart, FilePart, Message, Part, Task, TaskState, TextPart } from '@a2a-js/sdk'
import { A2A_TERMINAL_STATES } from './constants'

export function isTerminalState(state: TaskState): boolean {
  return (A2A_TERMINAL_STATES as readonly string[]).includes(state)
}

export function extractTextContent(message: Message): string {
  return message.parts
    .filter((part): part is TextPart => part.kind === 'text')
    .map((part) => part.text)
    .join('\n')
}

export function extractDataContent(message: Message): Record<string, unknown> {
  const dataParts = message.parts.filter((part): part is DataPart => part.kind === 'data')
  return dataParts.reduce((acc, part) => ({ ...acc, ...part.data }), {})
}

export interface A2AFile {
  name?: string
  mimeType?: string
  uri?: string
  bytes?: string
}

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
      const dataUrl = `data:${file.mimeType || 'application/octet-stream'};base64,${file.bytes}`
      return {
        type: 'file' as const,
        data: dataUrl,
        name: file.name || 'file',
        mime: file.mimeType,
      }
    })
}

export interface WorkflowInput {
  input: string
  data?: Record<string, unknown>
  files?: ExecutionFileInput[]
}

export function extractWorkflowInput(message: Message): WorkflowInput | null {
  const messageText = extractTextContent(message)
  const dataContent = extractDataContent(message)
  const fileContent = extractFileContent(message)
  const files = convertFilesToExecutionFormat(fileContent)
  const hasData = Object.keys(dataContent).length > 0

  if (!messageText && !hasData && files.length === 0) {
    return null
  }

  return {
    input: messageText,
    ...(hasData ? { data: dataContent } : {}),
    ...(files.length > 0 ? { files } : {}),
  }
}

export function createTextPart(text: string): Part {
  return { kind: 'text', text }
}

export function createUserMessage(text: string): Message {
  return {
    kind: 'message',
    messageId: crypto.randomUUID(),
    role: 'user',
    parts: [{ kind: 'text', text }],
  }
}

export function createAgentMessage(text: string): Message {
  return {
    kind: 'message',
    messageId: crypto.randomUUID(),
    role: 'agent',
    parts: [{ kind: 'text', text }],
  }
}

export function createA2AToolId(agentId: string, skillId: string): string {
  return `a2a:${agentId}:${skillId}`
}

export function parseA2AToolId(toolId: string): { agentId: string; skillId: string } | null {
  const parts = toolId.split(':')
  if (parts.length !== 3 || parts[0] !== 'a2a') {
    return null
  }
  return { agentId: parts[1], skillId: parts[2] }
}

export function sanitizeAgentName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 64)
}

export function buildA2AEndpointUrl(baseUrl: string, agentId: string): string {
  const base = baseUrl.replace(/\/$/, '')
  return `${base}/api/a2a/serve/${agentId}`
}

export function buildAgentCardUrl(baseUrl: string, agentId: string): string {
  const base = baseUrl.replace(/\/$/, '')
  return `${base}/api/a2a/agents/${agentId}`
}

export function getLastAgentMessage(task: Task): Message | undefined {
  return task.history?.filter((m) => m.role === 'agent').pop()
}

export function getLastAgentMessageText(task: Task): string {
  const message = getLastAgentMessage(task)
  return message ? extractTextContent(message) : ''
}

export interface ParsedSSEChunk {
  /** Incremental content from chunk events */
  content: string
  /** Final content if this chunk contains the final event */
  finalContent?: string
  /** Whether this chunk indicates the stream is done */
  isDone: boolean
}

/**
 * Parse workflow SSE chunk and extract clean content
 *
 * Workflow execute endpoint returns SSE in this format:
 * - data: {"event":"chunk","data":{"content":"partial text"}}
 * - data: {"event":"final","data":{"success":true,"output":{"content":"full text"}}}
 * - data: "[DONE]"
 *
 * This function extracts the actual text content for A2A streaming
 */
export function parseWorkflowSSEChunk(chunk: string): ParsedSSEChunk {
  const result: ParsedSSEChunk = {
    content: '',
    isDone: false,
  }

  const lines = chunk.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed.startsWith('data:')) continue

    const dataContent = trimmed.slice(5).trim()

    if (dataContent === '"[DONE]"' || dataContent === '[DONE]') {
      result.isDone = true
      continue
    }

    try {
      const parsed = JSON.parse(dataContent)

      if (parsed.event === 'chunk' && parsed.data?.content) {
        result.content += parsed.data.content
      } else if (parsed.event === 'final' && parsed.data?.output?.content) {
        result.finalContent = parsed.data.output.content
        result.isDone = true
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  return result
}
