import {
  AGENT_CARD_PATH,
  type AgentCard,
  type Artifact,
  type Message,
  type Part,
  Role,
  type Task,
  TaskState,
  taskStateToJSON,
} from '@a2a-js/sdk'
import {
  type BeforeArgs,
  type CallInterceptor,
  type Client,
  ClientFactory,
  ClientFactoryOptions,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  RestTransportFactory,
} from '@a2a-js/sdk/client'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'

const logger = createLogger('A2AClient')

/** Upper bound on a single agent HTTP response body, to bound memory on a hostile/large reply. */
const A2A_MAX_RESPONSE_BYTES = 10 * 1024 * 1024

/** Per-hop timeout for agent RPC calls; blocking sends may legitimately run long. */
const RPC_TIMEOUT_MS = 300_000

/** Shorter timeout for agent-card discovery so a slow or hanging agent fails fast. */
const CARD_RESOLUTION_TIMEOUT_MS = 30_000

/** How long a resolved agent card is reused before it is re-fetched. */
const CARD_CACHE_TTL_MS = 5 * 60 * 1000

/** Upper bound on cached cards; the oldest entry is evicted past this size. */
const CARD_CACHE_MAX_ENTRIES = 256

/** Well-known agent-card paths tried in order, ending with the URL itself. */
const CARD_CANDIDATE_PATHS = [AGENT_CARD_PATH, '/.well-known/agent.json', ''] as const

const agentCardCache = new Map<string, { card: AgentCard; expiresAt: number }>()

function getCachedCard(agentUrl: string): AgentCard | undefined {
  const cached = agentCardCache.get(agentUrl)
  if (!cached) return undefined
  if (cached.expiresAt <= Date.now()) {
    agentCardCache.delete(agentUrl)
    return undefined
  }
  return cached.card
}

function cacheCard(agentUrl: string, card: AgentCard): void {
  if (agentCardCache.size >= CARD_CACHE_MAX_ENTRIES) {
    const oldest = agentCardCache.keys().next().value
    if (oldest !== undefined) agentCardCache.delete(oldest)
  }
  agentCardCache.set(agentUrl, { card, expiresAt: Date.now() + CARD_CACHE_TTL_MS })
}

/** Attaches the `X-API-Key` header to every outgoing request. */
class ApiKeyInterceptor implements CallInterceptor {
  constructor(private readonly apiKey: string) {}

  before(args: BeforeArgs): Promise<void> {
    args.options = {
      ...args.options,
      serviceParameters: { ...args.options?.serviceParameters, 'X-API-Key': this.apiKey },
    }
    return Promise.resolve()
  }

  after(): Promise<void> {
    return Promise.resolve()
  }
}

/**
 * Build a `fetch` bound to a DNS-validated, pinned IP so that calls to
 * user-supplied agent URLs cannot be rebound to internal hosts (SSRF).
 *
 * Redirects are not followed: an authenticated agent call must not have its
 * `X-API-Key` carried to a redirected host. A per-hop `timeout` and an optional
 * caller `signal` bound how long the call can run and let the request abort
 * propagate to the outbound connection.
 */
function createPinnedFetch(
  resolvedIP: string,
  config: { timeout: number; signal?: AbortSignal }
): typeof fetch {
  return async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = input instanceof Request ? input.url : input.toString()
    const method = init?.method ?? (input instanceof Request ? input.method : undefined)

    const rawHeaders = init?.headers ?? (input instanceof Request ? input.headers : undefined)
    const headers =
      rawHeaders instanceof Headers
        ? Object.fromEntries(rawHeaders.entries())
        : Array.isArray(rawHeaders)
          ? Object.fromEntries(rawHeaders as string[][])
          : (rawHeaders as Record<string, string> | undefined)

    let body: string | Uint8Array | undefined
    if (init?.body != null) {
      if (typeof init.body === 'string' || init.body instanceof Uint8Array) {
        body = init.body
      } else if (init.body instanceof ArrayBuffer) {
        body = new Uint8Array(init.body)
      } else {
        const text = await new Response(init.body as BodyInit).text()
        if (text) body = text
      }
    } else if (input instanceof Request && !input.bodyUsed) {
      const text = await input.text()
      if (text) body = text
    }

    const callSignal =
      config.signal ??
      (init?.signal instanceof AbortSignal
        ? init.signal
        : input instanceof Request && input.signal instanceof AbortSignal
          ? input.signal
          : undefined)

    const res = await secureFetchWithPinnedIP(url, resolvedIP, {
      method,
      headers,
      body,
      signal: callSignal,
      timeout: config.timeout,
      maxRedirects: 0,
      maxResponseBytes: A2A_MAX_RESPONSE_BYTES,
    })
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: new Headers(res.headers.toRecord()),
    })
  }
}

/**
 * Resolve (and cache) an agent card. The card is resolved by trying the SDK
 * default well-known path, the legacy pre-0.3 path, and finally the URL itself
 * (some agents serve the card at the same URL they serve requests). Resolution
 * uses a short timeout so a hanging agent fails fast; successful cards are
 * cached per URL so subsequent operations skip the discovery round-trips.
 */
async function resolveAgentCard(
  agentUrl: string,
  resolvedIP: string,
  signal?: AbortSignal
): Promise<AgentCard> {
  const cached = getCachedCard(agentUrl)
  if (cached) return cached

  const resolver = new DefaultAgentCardResolver({
    fetchImpl: createPinnedFetch(resolvedIP, { timeout: CARD_RESOLUTION_TIMEOUT_MS, signal }),
  })
  let lastError: unknown
  for (const path of CARD_CANDIDATE_PATHS) {
    try {
      const card = await resolver.resolve(agentUrl, path)
      cacheCard(agentUrl, card)
      return card
    } catch (error) {
      lastError = error
      logger.debug('Agent card resolution failed', {
        agentUrl,
        path,
        error: toError(error).message,
      })
    }
  }
  throw toError(lastError)
}

/**
 * Create an A2A client for an external agent URL. The URL is validated against
 * SSRF and its DNS pinned on every call; an optional API key is sent via
 * `X-API-Key`. The caller `signal` aborts the outbound connection when the
 * request is cancelled.
 */
export async function createA2AClient(
  agentUrl: string,
  apiKey?: string,
  options: { signal?: AbortSignal } = {}
): Promise<Client> {
  const validation = await validateUrlWithDNS(agentUrl, 'agentUrl')
  if (!validation.isValid || !validation.resolvedIP) {
    throw new Error(validation.error || 'Agent URL validation failed')
  }
  const { resolvedIP } = validation

  const card = await resolveAgentCard(agentUrl, resolvedIP, options.signal)

  const pinnedFetch = createPinnedFetch(resolvedIP, {
    timeout: RPC_TIMEOUT_MS,
    signal: options.signal,
  })
  const factory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      transports: [
        new JsonRpcTransportFactory({ fetchImpl: pinnedFetch }),
        new RestTransportFactory({ fetchImpl: pinnedFetch }),
      ],
      ...(apiKey ? { clientConfig: { interceptors: [new ApiKeyInterceptor(apiKey)] } } : {}),
    })
  )

  return factory.createFromAgentCard(card)
}

/** A file to attach to an outgoing message, resolved to raw bytes from Sim storage. */
export interface A2AFileInput {
  bytes: Uint8Array
  name: string
  mediaType: string
}

function textPart(value: string): Part {
  return { content: { $case: 'text', value }, metadata: undefined, filename: '', mediaType: '' }
}

function dataPart(value: unknown): Part {
  return { content: { $case: 'data', value }, metadata: undefined, filename: '', mediaType: '' }
}

function filePart(file: A2AFileInput): Part {
  return {
    content: { $case: 'raw', value: Buffer.from(file.bytes) },
    metadata: undefined,
    filename: file.name,
    mediaType: file.mediaType,
  }
}

/** Construct a user `Message` with a text part plus optional data and file parts. */
export function buildUserMessage(opts: {
  text: string
  data?: unknown
  files?: A2AFileInput[]
  taskId?: string
  contextId?: string
}): Message {
  const parts: Part[] = [textPart(opts.text)]
  if (opts.data !== undefined) parts.push(dataPart(opts.data))
  for (const file of opts.files ?? []) parts.push(filePart(file))
  return {
    messageId: generateId(),
    contextId: opts.contextId ?? '',
    taskId: opts.taskId ?? '',
    role: Role.ROLE_USER,
    parts,
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  }
}

function partsText(parts: Part[]): string {
  return parts
    .map((part) => (part.content?.$case === 'text' ? part.content.value : ''))
    .filter(Boolean)
    .join('\n')
}

/** Concatenated text of all text parts in a message. */
export function extractText(message: Message): string {
  return partsText(message.parts)
}

function latestAgentText(task: Task): string {
  const lastAgentMessage = task.history.filter((message) => message.role === Role.ROLE_AGENT).at(-1)
  if (lastAgentMessage) return extractText(lastAgentMessage)
  // Interrupted states (input-required, auth-required) carry the agent's prompt
  // in the status message rather than the history.
  const statusMessage = task.status?.message
  return statusMessage ? extractText(statusMessage) : ''
}

/** A flattened artifact for block output. */
export interface A2AArtifactOutput {
  name: string
  description: string
  content: string
}

function mapArtifacts(artifacts: Artifact[]): A2AArtifactOutput[] {
  return artifacts.map((artifact) => ({
    name: artifact.name,
    description: artifact.description,
    content: partsText(artifact.parts),
  }))
}

function taskStateLabel(state: TaskState): string {
  return taskStateToJSON(state)
    .replace(/^TASK_STATE_/, '')
    .toLowerCase()
    .replace(/_/g, '-')
}

/** A send result is a `Task` when it carries status; otherwise it is a `Message`. */
export function isTaskResult(result: Message | Task): result is Task {
  return 'status' in result
}

/** Normalized task fields for block output. */
export interface A2ATaskOutput {
  content: string
  taskId: string
  contextId: string
  state: string
  artifacts: A2AArtifactOutput[]
}

export function taskOutput(task: Task): A2ATaskOutput {
  const state = task.status?.state ?? TaskState.TASK_STATE_UNSPECIFIED
  return {
    content: latestAgentText(task),
    taskId: task.id,
    contextId: task.contextId,
    state: taskStateLabel(state),
    artifacts: mapArtifacts(task.artifacts),
  }
}

/** Normalized output for a direct (non-task) message reply. */
export function messageOutput(message: Message): A2ATaskOutput {
  return {
    content: extractText(message),
    taskId: message.taskId,
    contextId: message.contextId,
    state: 'completed',
    artifacts: [],
  }
}

/**
 * True when the task ended in a hard-failure state (failed or rejected). Used to
 * decide whether a send surfaces as a block error. Interrupted states such as
 * input-required/auth-required are not failures — the caller branches on `state`.
 */
export function taskErrored(task: Task): boolean {
  const state = task.status?.state ?? TaskState.TASK_STATE_UNSPECIFIED
  return state === TaskState.TASK_STATE_FAILED || state === TaskState.TASK_STATE_REJECTED
}

/** Flattened agent card fields for block output. */
export interface A2AAgentCardOutput {
  name: string
  description: string
  url: string
  version: string
  protocolVersion: string
  capabilities: { streaming: boolean; pushNotifications: boolean; extendedAgentCard: boolean }
  skills: Array<{ id: string; name: string; description: string }>
  defaultInputModes: string[]
  defaultOutputModes: string[]
}

export function agentCardOutput(card: AgentCard, fallbackUrl: string): A2AAgentCardOutput {
  const iface = card.supportedInterfaces.at(0)
  return {
    name: card.name,
    description: card.description,
    url: iface?.url ?? fallbackUrl,
    version: card.version,
    protocolVersion: iface?.protocolVersion ?? '',
    capabilities: {
      streaming: card.capabilities?.streaming ?? false,
      pushNotifications: card.capabilities?.pushNotifications ?? false,
      extendedAgentCard: card.capabilities?.extendedAgentCard ?? false,
    },
    skills: card.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
    })),
    defaultInputModes: card.defaultInputModes,
    defaultOutputModes: card.defaultOutputModes,
  }
}
