import { getErrorMessage } from '@sim/utils/errors'
import type {
  TinyFishBrowserConfig,
  TinyFishRawBrowserConfig,
  TinyFishRawRunError,
  TinyFishRawRunSummary,
  TinyFishRawSchemaValidation,
  TinyFishRunError,
  TinyFishRunSummary,
  TinyFishSchemaValidation,
} from '@/tools/tinyfish/types'

/** Agent API host. Search, Fetch, and Browser each live on their own host. */
export const TINYFISH_AGENT_API_BASE = 'https://agent.tinyfish.ai'

/** Search API host. */
export const TINYFISH_SEARCH_API_BASE = 'https://api.search.tinyfish.ai'

/** Fetch API host. */
export const TINYFISH_FETCH_API_BASE = 'https://api.fetch.tinyfish.ai'

/**
 * Identifies Sim to TinyFish's analytics on every automation request, as the
 * `api_integration` field documents for integration partners.
 */
export const TINYFISH_API_INTEGRATION = 'sim'

/** Maximum URLs the Fetch API accepts in one request. */
export const MAX_FETCH_URLS = 10

/** Every TinyFish surface authenticates with the same `X-API-Key` header. */
export function tinyfishHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-API-Key': apiKey,
  }
}

/**
 * Extracts the message from TinyFish's API-level error envelope.
 *
 * Both documented shapes nest the message under `error`, so an unparseable or
 * differently shaped body falls back to the HTTP status line.
 */
export async function tinyfishErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json()
    const message = body?.error?.message
    if (typeof message === 'string' && message.length > 0) {
      const code = body?.error?.code
      return typeof code === 'string' && code.length > 0 ? `${code}: ${message}` : message
    }
  } catch {}
  return `TinyFish request failed with status ${response.status}`
}

/** Splits a comma- or newline-separated list into trimmed, non-empty entries. */
export function parseList(input: string | string[] | undefined): string[] {
  if (!input) return []
  const values = Array.isArray(input) ? input : input.split(/[\n,]/)
  return values.map((value) => String(value).trim()).filter(Boolean)
}

/**
 * Accepts a JSON Schema as either a parsed object or the stringified form the
 * block's code editor produces, and returns it as an object.
 */
export function parseJsonSchema(
  input: string | Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!input) return undefined

  if (typeof input !== 'string') {
    if (Array.isArray(input)) {
      throw new Error('Output Schema must be a JSON object')
    }
    return input
  }

  const trimmed = input.trim()
  if (!trimmed) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    throw new Error(`Output Schema is not valid JSON: ${getErrorMessage(error)}`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Output Schema must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

export function mapSchemaValidation(
  raw: TinyFishRawSchemaValidation | null | undefined
): TinyFishSchemaValidation | null {
  if (!raw) return null
  return {
    valid: raw.valid ?? false,
    rePromptAttempts: raw.re_prompt_attempts ?? 0,
    errors: (raw.errors ?? []).map((issue) => ({
      path: issue?.path ?? '',
      expected: issue?.expected ?? '',
      received: issue?.received ?? '',
      message: issue?.message ?? '',
    })),
  }
}

export function mapRunError(raw: TinyFishRawRunError | null | undefined): TinyFishRunError | null {
  if (!raw) return null
  return {
    code: raw.code ?? null,
    message: raw.message ?? '',
    category: raw.category ?? 'UNKNOWN',
    retryAfter: raw.retry_after ?? null,
    helpUrl: raw.help_url ?? null,
    helpMessage: raw.help_message ?? null,
  }
}

function mapBrowserConfig(
  raw: TinyFishRawBrowserConfig | null | undefined
): TinyFishBrowserConfig | null {
  if (!raw) return null
  return {
    proxyEnabled: raw.proxy_enabled ?? null,
    proxyCountryCode: raw.proxy_country_code ?? null,
  }
}

/** Maps a run object from `GET /v1/runs` or `GET /v1/runs/{id}` to Sim's camelCase shape. */
export function mapRunSummary(raw: TinyFishRawRunSummary): TinyFishRunSummary {
  return {
    runId: raw.run_id ?? '',
    status: raw.status ?? 'PENDING',
    goal: raw.goal ?? '',
    createdAt: raw.created_at ?? '',
    startedAt: raw.started_at ?? null,
    finishedAt: raw.finished_at ?? null,
    numOfSteps: raw.num_of_steps ?? null,
    result: raw.result ?? null,
    schemaValidation: mapSchemaValidation(raw.schema_validation),
    error: mapRunError(raw.error),
    streamingUrl: raw.streaming_url ?? null,
    browserConfig: mapBrowserConfig(raw.browser_config),
  }
}

/**
 * Reads a workflow switch as a boolean.
 *
 * The editor's switch control stores a real boolean, but a workflow that was
 * imported or generated rather than clicked together can carry the serialized
 * string instead, and `'false'` is truthy. Every flag on the automation body is
 * read through here so a disabled switch cannot enable a proxy, a vault, or a
 * saved authenticated session.
 */
function isEnabled(value: boolean | string | undefined): boolean {
  return value === true || value === 'true'
}

/**
 * Builds the request body shared by `POST /v1/automation/run` and
 * `POST /v1/automation/run-async`.
 *
 * Optional fields are omitted rather than sent as null so TinyFish applies its
 * own documented defaults (`lite` browser engine, `default` agent mode, 150
 * max steps, no proxy, no vault, no Browser Context Profile).
 */
export function buildAutomationBody(params: {
  url: string
  goal: string
  browserProfile?: string
  agentMode?: string
  maxSteps?: number
  outputSchema?: string | Record<string, unknown>
  proxyEnabled?: boolean | string
  proxyCountryCode?: string
  useVault?: boolean | string
  credentialItemIds?: string | string[]
  useProfile?: boolean | string
  profileId?: string
  webhookUrl?: string
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    url: params.url,
    goal: params.goal,
    api_integration: TINYFISH_API_INTEGRATION,
  }

  if (params.browserProfile) body.browser_profile = params.browserProfile

  const agentConfig: Record<string, unknown> = {}
  if (params.agentMode) agentConfig.mode = params.agentMode
  if (typeof params.maxSteps === 'number' && Number.isFinite(params.maxSteps)) {
    agentConfig.max_steps = params.maxSteps
  }
  if (Object.keys(agentConfig).length > 0) body.agent_config = agentConfig

  if (isEnabled(params.proxyEnabled)) {
    const proxyConfig: Record<string, unknown> = { enabled: true, type: 'tetra' }
    if (params.proxyCountryCode) proxyConfig.country_code = params.proxyCountryCode
    body.proxy_config = proxyConfig
  }

  const outputSchema = parseJsonSchema(params.outputSchema)
  if (outputSchema) body.output_schema = outputSchema

  if (isEnabled(params.useVault)) {
    body.use_vault = true
    const credentialItemIds = parseList(params.credentialItemIds)
    if (credentialItemIds.length > 0) body.credential_item_ids = credentialItemIds
  }

  /**
   * `profile_id` is sent only alongside `use_profile: true`, because TinyFish
   * rejects the id on its own with a 400. Without an id the run falls back to
   * the account's default Browser Context Profile, which is also a 400 when no
   * default has been set.
   */
  if (isEnabled(params.useProfile)) {
    body.use_profile = true
    const profileId = params.profileId?.trim()
    if (profileId) body.profile_id = profileId
  }

  if (params.webhookUrl) body.webhook_url = params.webhookUrl

  return body
}

/** Param declarations shared by the synchronous and asynchronous automation tools. */
export const AUTOMATION_TOOL_PARAMS = {
  url: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Target website URL the agent starts on',
  },
  goal: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Natural-language description of what to accomplish on the website',
  },
  browserProfile: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Browser engine: "lite" (standard) or "stealth" (anti-detection). Not a Browser Context Profile — use useProfile for saved logins',
  },
  agentMode: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Agent behavior: "default" or "strict" (fail fast)',
  },
  maxSteps: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Maximum tool-call steps before the agent stops (1-500, default 150)',
  },
  outputSchema: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description: 'JSON Schema draft-07 contract the run result must satisfy',
  },
  proxyEnabled: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Route the run through TinyFish’s Tetra proxy',
  },
  proxyCountryCode: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Proxy country: US, GB, CA, DE, FR, JP, or AU',
  },
  useVault: {
    type: 'boolean',
    required: false,
    visibility: 'user-only',
    description: 'Let the run use credentials from the connected TinyFish vault',
  },
  credentialItemIds: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description: 'Comma-separated vault credential URIs to scope the run to',
  },
  /**
   * A Browser Context Profile carries a logged-in session, so activating one is
   * as sensitive as handing the run a credential. Both fields are therefore
   * `user-only` — the same visibility the vault fields above use — which keeps
   * them out of the tool schema the agent model writes.
   */
  useProfile: {
    type: 'boolean',
    required: false,
    visibility: 'user-only',
    description:
      'Start the run from a saved Browser Context Profile, reusing the logged-in session stored in it',
  },
  profileId: {
    type: 'string',
    required: false,
    visibility: 'user-only',
    description:
      'Browser Context Profile to start from, such as "prof_abc123". Requires useProfile; omit to use the account default',
  },
  apiKey: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'TinyFish API key',
  },
} as const

/**
 * Model-visible selection shared by the automation tools.
 *
 * TinyFish hands the goal to the agent's LLM verbatim, and re-prompts that same
 * model with the output schema when a result does not satisfy it — the run's
 * `schema_validation.re_prompt_attempts` counts exactly those repair passes. Both
 * are therefore model input and are projected to canonical secret placeholders
 * before the request is formatted.
 *
 * The target URL, browser engine, proxy settings, and Browser Context Profile and
 * vault scoping are ordinary request inputs and keep their normal semantics. The schema is projected as the
 * whole param rather than through `applyProjected` because it reaches the request
 * formatter unparsed, matching `tools/exa/search.ts`.
 */
export function selectAutomationModelInput(params: {
  goal?: string
  outputSchema?: string | Record<string, unknown>
}) {
  return { goal: params.goal, outputSchema: params.outputSchema }
}
