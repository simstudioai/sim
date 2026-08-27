import type { ToolResponse } from '@/tools/types'

/** Browser engine TinyFish runs the agent in. */
export type TinyFishBrowserProfile = 'lite' | 'stealth'

/** Agent behavior mode. `strict` fails fast, which suits test automation. */
export type TinyFishAgentMode = 'default' | 'strict'

/** Lifecycle states a TinyFish run can be in. */
export type TinyFishRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

/** Classification TinyFish attaches to a failed run. */
export type TinyFishErrorCategory =
  | 'SYSTEM_FAILURE'
  | 'AGENT_FAILURE'
  | 'BILLING_FAILURE'
  | 'UNKNOWN'

/** Output format the Fetch API extracts page content into. */
export type TinyFishFetchFormat = 'markdown' | 'html' | 'json'

interface TinyFishApiKeyParams {
  apiKey: string
}

/** Request fields shared by the synchronous and asynchronous automation endpoints. */
interface TinyFishAutomationParams extends TinyFishApiKeyParams {
  url: string
  goal: string
  browserProfile?: TinyFishBrowserProfile
  agentMode?: TinyFishAgentMode
  maxSteps?: number
  outputSchema?: string | Record<string, unknown>
  proxyEnabled?: boolean
  proxyCountryCode?: string
  useVault?: boolean
  credentialItemIds?: string | string[]
}

export interface TinyFishRunParams extends TinyFishAutomationParams {}

export interface TinyFishRunAsyncParams extends TinyFishAutomationParams {
  webhookUrl?: string
}

export interface TinyFishGetRunParams extends TinyFishApiKeyParams {
  runId: string
}

export interface TinyFishCancelRunParams extends TinyFishApiKeyParams {
  runId: string
}

export interface TinyFishListRunsParams extends TinyFishApiKeyParams {
  status?: TinyFishRunStatus
  goal?: string
  createdAfter?: string
  createdBefore?: string
  sortDirection?: 'asc' | 'desc'
  cursor?: string
  limit?: number
}

export interface TinyFishListVaultItemsParams extends TinyFishApiKeyParams {}

export interface TinyFishSearchParams extends TinyFishApiKeyParams {
  query: string
  location?: string
  language?: string
}

export interface TinyFishFetchParams extends TinyFishApiKeyParams {
  urls: string | string[]
  format?: TinyFishFetchFormat
  links?: boolean
  imageLinks?: boolean
}

/** A single mismatch between a run result and the requested `output_schema`. */
interface TinyFishSchemaValidationError {
  path: string
  expected: string
  received: string
  message: string
}

/** Outcome of validating a run result against the requested `output_schema`. */
export interface TinyFishSchemaValidation {
  valid: boolean
  rePromptAttempts: number
  errors: TinyFishSchemaValidationError[]
}

/** Failure details TinyFish returns inside a 200 response for a failed run. */
export interface TinyFishRunError {
  code: string | null
  message: string
  category: TinyFishErrorCategory
  retryAfter: number | null
  helpUrl: string | null
  helpMessage: string | null
}

/** Proxy settings the run actually executed with. */
export interface TinyFishBrowserConfig {
  proxyEnabled: boolean | null
  proxyCountryCode: string | null
}

/** Run summary shared by the get-run and list-runs endpoints. */
export interface TinyFishRunSummary {
  runId: string
  status: TinyFishRunStatus
  goal: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  numOfSteps: number | null
  result: Record<string, unknown> | null
  schemaValidation: TinyFishSchemaValidation | null
  error: TinyFishRunError | null
  streamingUrl: string | null
  browserConfig: TinyFishBrowserConfig | null
}

export interface TinyFishRunResponse extends ToolResponse {
  output: {
    runId: string | null
    status: 'COMPLETED' | 'FAILED'
    startedAt: string | null
    finishedAt: string | null
    numOfSteps: number | null
    result: Record<string, unknown> | null
    schemaValidation: TinyFishSchemaValidation | null
    error: TinyFishRunError | null
  }
}

export interface TinyFishRunAsyncResponse extends ToolResponse {
  output: {
    runId: string | null
  }
}

/** A single step the agent took during a run. */
interface TinyFishRunStep {
  id: string
  timestamp: string
  status: TinyFishRunStatus
  action: string | null
  duration: string | null
}

export interface TinyFishGetRunResponse extends ToolResponse {
  output: TinyFishRunSummary & {
    videoUrl: string | null
    steps: TinyFishRunStep[]
  }
}

export interface TinyFishCancelRunResponse extends ToolResponse {
  output: {
    runId: string
    status: 'CANCELLED' | 'COMPLETED' | 'FAILED'
    cancelledAt: string | null
    message: string | null
  }
}

export interface TinyFishListRunsResponse extends ToolResponse {
  output: {
    runs: TinyFishRunSummary[]
    total: number
    nextCursor: string | null
    hasMore: boolean
  }
}

/** Display-safe metadata for one field of a vault item. */
interface TinyFishVaultFieldMetadata {
  fieldId: string
  label: string
  type: 'STRING' | 'CONCEALED' | 'OTP'
}

/** Display-safe metadata for one credential in a connected password manager. */
interface TinyFishVaultItem {
  itemId: string
  connectionId: string | null
  label: string
  vaultName: string
  domains: string[]
  fieldMetadata: TinyFishVaultFieldMetadata[]
  hasTotp: boolean
}

export interface TinyFishListVaultItemsResponse extends ToolResponse {
  output: {
    items: TinyFishVaultItem[]
  }
}

/** A single ranked result from the Search API. */
interface TinyFishSearchResult {
  position: number
  siteName: string
  snippet: string
  title: string
  url: string
}

export interface TinyFishSearchResponse extends ToolResponse {
  output: {
    query: string
    results: TinyFishSearchResult[]
    totalResults: number
  }
}

/** A successfully fetched page from the Fetch API. */
interface TinyFishFetchResult {
  url: string
  finalUrl: string | null
  title: string | null
  description: string | null
  language: string | null
  format: TinyFishFetchFormat
  text: string | Record<string, unknown> | null
  author: string | null
  publishedDate: string | null
  links: string[]
  imageLinks: string[]
  latencyMs: number | null
}

/** A URL the Fetch API could not retrieve. Reported per URL, never fatal. */
interface TinyFishFetchError {
  url: string
  error: string
}

export interface TinyFishFetchResponse extends ToolResponse {
  output: {
    results: TinyFishFetchResult[]
    errors: TinyFishFetchError[]
  }
}

/**
 * Raw snake_case shapes TinyFish returns on the wire.
 *
 * Every field is optional and nullable: these describe what a response may
 * legally omit, so the mapping helpers narrow them into the camelCase output
 * types above rather than trusting the payload.
 */
interface TinyFishRawSchemaValidation {
  valid?: boolean | null
  re_prompt_attempts?: number | null
  errors?: Array<{
    path?: string | null
    expected?: string | null
    received?: string | null
    message?: string | null
  }> | null
}

interface TinyFishRawRunError {
  code?: string | null
  message?: string | null
  category?: TinyFishErrorCategory | null
  retry_after?: number | null
  help_url?: string | null
  help_message?: string | null
}

interface TinyFishRawBrowserConfig {
  proxy_enabled?: boolean | null
  proxy_country_code?: string | null
}

export interface TinyFishRawRunSummary {
  run_id?: string | null
  status?: TinyFishRunStatus | null
  goal?: string | null
  created_at?: string | null
  started_at?: string | null
  finished_at?: string | null
  num_of_steps?: number | null
  result?: Record<string, unknown> | null
  schema_validation?: TinyFishRawSchemaValidation | null
  error?: TinyFishRawRunError | null
  streaming_url?: string | null
  browser_config?: TinyFishRawBrowserConfig | null
}

export interface TinyFishRawRunDetail extends TinyFishRawRunSummary {
  video_url?: string | null
  steps?: Array<{
    id?: string | null
    timestamp?: string | null
    status?: TinyFishRunStatus | null
    action?: string | null
    duration?: string | null
  }> | null
}

export interface TinyFishRawRun {
  run_id?: string | null
  status?: 'COMPLETED' | 'FAILED'
  started_at?: string | null
  finished_at?: string | null
  num_of_steps?: number | null
  result?: Record<string, unknown> | null
  schema_validation?: TinyFishRawSchemaValidation | null
  error?: TinyFishRawRunError | null
}

export interface TinyFishRawRunAsync {
  run_id?: string | null
  error?: { code?: string | null; message?: string | null } | null
}

export interface TinyFishRawCancel {
  run_id?: string | null
  status?: 'CANCELLED' | 'COMPLETED' | 'FAILED'
  cancelled_at?: string | null
  message?: string | null
}

export interface TinyFishRawRunList {
  data?: TinyFishRawRunSummary[] | null
  pagination?: {
    total?: number | null
    next_cursor?: string | null
    has_more?: boolean | null
  } | null
}

export interface TinyFishRawSearch {
  query?: string | null
  results?: Array<{
    position?: number | null
    site_name?: string | null
    snippet?: string | null
    title?: string | null
    url?: string | null
  }> | null
  total_results?: number | null
}

export interface TinyFishRawFetch {
  results?: Array<{
    url?: string | null
    final_url?: string | null
    title?: string | null
    description?: string | null
    language?: string | null
    format?: TinyFishFetchFormat | null
    text?: string | Record<string, unknown> | null
    author?: string | null
    published_date?: string | null
    links?: string[] | null
    image_links?: string[] | null
    latency_ms?: number | null
  }> | null
  errors?: Array<{ url?: string | null; error?: string | null }> | null
}

export interface TinyFishRawVaultItems {
  items?: Array<{
    itemId?: string | null
    connectionId?: string | null
    label?: string | null
    vaultName?: string | null
    domains?: string[] | null
    fieldMetadata?: Array<{
      fieldId?: string | null
      label?: string | null
      type?: 'STRING' | 'CONCEALED' | 'OTP' | null
    }> | null
    hasTotp?: boolean | null
  }> | null
}

export type { TinyFishRawBrowserConfig, TinyFishRawRunError, TinyFishRawSchemaValidation }

/** Output property descriptions for the run-error object, shared by run-returning tools. */
export const RUN_ERROR_OUTPUT_PROPERTIES = {
  code: { type: 'string', description: 'Machine-readable error code', optional: true },
  message: { type: 'string', description: 'Why the run failed' },
  category: {
    type: 'string',
    description:
      'SYSTEM_FAILURE (retry), AGENT_FAILURE (fix the goal), BILLING_FAILURE (add credits), or UNKNOWN',
  },
  retryAfter: {
    type: 'number',
    description: 'Suggested retry delay in seconds, null when not retryable',
    optional: true,
  },
  helpUrl: { type: 'string', description: 'Troubleshooting documentation URL', optional: true },
  helpMessage: { type: 'string', description: 'Human-readable guidance', optional: true },
} as const

/** Output property descriptions for the schema-validation object. */
export const SCHEMA_VALIDATION_OUTPUT_PROPERTIES = {
  valid: { type: 'boolean', description: 'Whether the result matched the requested output schema' },
  rePromptAttempts: {
    type: 'number',
    description: 'Number of schema-repair re-prompts TinyFish performed',
  },
  errors: {
    type: 'array',
    description: 'Fields that did not match the requested schema',
    items: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the failing field' },
        expected: { type: 'string', description: 'Expected type or constraint' },
        received: { type: 'string', description: 'Type actually returned' },
        message: { type: 'string', description: 'Validation error message' },
      },
    },
  },
} as const

/** Output property descriptions for a run summary, shared by get-run and list-runs. */
export const RUN_SUMMARY_OUTPUT_PROPERTIES = {
  runId: { type: 'string', description: 'Run identifier' },
  status: {
    type: 'string',
    description: 'PENDING, RUNNING, COMPLETED, FAILED, or CANCELLED',
  },
  goal: { type: 'string', description: 'Natural-language goal the run was given' },
  createdAt: { type: 'string', description: 'ISO 8601 timestamp when the run was created' },
  startedAt: {
    type: 'string',
    description: 'ISO 8601 timestamp when the run started executing',
    optional: true,
  },
  finishedAt: {
    type: 'string',
    description: 'ISO 8601 timestamp when the run finished',
    optional: true,
  },
  numOfSteps: {
    type: 'number',
    description: 'Steps taken, null while the run is still in progress',
    optional: true,
  },
  result: {
    type: 'json',
    description: 'Structured data the agent extracted, null until the run succeeds',
    optional: true,
  },
  schemaValidation: {
    type: 'object',
    description: 'Validation of the result against the requested output schema',
    optional: true,
    properties: SCHEMA_VALIDATION_OUTPUT_PROPERTIES,
  },
  error: {
    type: 'object',
    description: 'Failure details, null while the run is pending or succeeded',
    optional: true,
    properties: RUN_ERROR_OUTPUT_PROPERTIES,
  },
  streamingUrl: {
    type: 'string',
    description: 'Live browser view URL, available while the run is executing',
    optional: true,
  },
  browserConfig: {
    type: 'object',
    description: 'Proxy settings the run executed with',
    optional: true,
    properties: {
      proxyEnabled: { type: 'boolean', description: 'Whether a proxy was used', optional: true },
      proxyCountryCode: { type: 'string', description: 'Proxy country code', optional: true },
    },
  },
} as const
