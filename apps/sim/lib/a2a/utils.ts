import type { DataPart, FilePart, Message, Part, Task, TaskState, TextPart } from '@a2a-js/sdk'
import {
  type BeforeArgs,
  type CallInterceptor,
  type Client,
  ClientFactory,
  ClientFactoryOptions,
} from '@a2a-js/sdk/client'
import { createLogger } from '@sim/logger'
import { isInternalFileUrl } from '@/lib/uploads/utils/file-utils'
import { A2A_TERMINAL_STATES } from './constants'

const logger = createLogger('A2AUtils')

/**
 * Interceptor to add X-API-Key header to outgoing A2A requests
 */
class ApiKeyInterceptor implements CallInterceptor {
  constructor(private apiKey: string) {}

  before(args: BeforeArgs): Promise<void> {
    args.options = {
      ...args.options,
      serviceParameters: {
        ...args.options?.serviceParameters,
        'X-API-Key': this.apiKey,
      },
    }
    return Promise.resolve()
  }

  after(): Promise<void> {
    return Promise.resolve()
  }
}

/**
 * Create an A2A client from an agent URL with optional API key authentication
 *
 * Supports both standard A2A agents (agent card at /.well-known/agent.json)
 * and Sim Studio agents (agent card at root URL via GET).
 *
 * Tries standard path first, falls back to root URL for compatibility.
 */
export async function createA2AClient(agentUrl: string, apiKey?: string): Promise<Client> {
  const factoryOptions = apiKey
    ? ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
        clientConfig: {
          interceptors: [new ApiKeyInterceptor(apiKey)],
        },
      })
    : ClientFactoryOptions.default
  const factory = new ClientFactory(factoryOptions)

  // Try standard A2A path first (/.well-known/agent.json)
  try {
    return await factory.createFromUrl(agentUrl, '/.well-known/agent.json')
  } catch (standardError) {
    logger.debug('Standard agent card path failed, trying root URL', {
      agentUrl,
      error: standardError instanceof Error ? standardError.message : String(standardError),
    })
  }

  // Fall back to root URL (Sim Studio compatibility)
  return factory.createFromUrl(agentUrl, '')
}

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
    .map((part) => {
      const file = part.file as unknown as Record<string, unknown>
      const uri = (file.url as string) || (file.uri as string)
      const hasBytes = Boolean(file.bytes)
      const canUseUri = Boolean(uri) && (!hasBytes || (uri ? !isInternalFileUrl(uri) : true))
      return {
        name: file.name as string | undefined,
        mimeType: file.mimeType as string | undefined,
        ...(canUseUri ? { uri } : {}),
        ...(hasBytes ? { bytes: file.bytes as string } : {}),
      }
    })
}

export interface ExecutionFileInput {
  type: 'file' | 'url'
  data: string
  name: string
  mime?: string
}

/**
 * Validate base64 string format
 */
function isValidBase64(str: string): boolean {
  if (!str || str.length === 0) return false
  return /^[A-Za-z0-9+/]*={0,2}$/.test(str)
}

/**
 * Convert A2A FileParts to execution file format
 * This format is then processed by processInputFileFields in the execute endpoint
 * FileWithUri → type 'url', FileWithBytes → type 'file' with data URL
 * Files without uri or bytes, or with invalid base64, are filtered out
 */
export function convertFilesToExecutionFormat(files: A2AFile[]): ExecutionFileInput[] {
  return files
    .filter((file) => {
      // Skip files without content
      if (!file.uri && !file.bytes) return false
      // Validate base64 if bytes are provided
      if (file.bytes && !isValidBase64(file.bytes)) return false
      return true
    })
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
      // Only log if content looks like it should be JSON (starts with { or [)
      if (dataContent.startsWith('{') || dataContent.startsWith('[')) {
        logger.debug('Failed to parse SSE data as JSON', {
          dataPreview: dataContent.substring(0, 100),
        })
      }
    }
  }

  return result
}
