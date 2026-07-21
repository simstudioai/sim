import type { ComponentType, JSX, SVGProps } from 'react'
import type {
  OutputCondition,
  OutputFieldDefinition,
  PrimitiveValueType,
  SubBlockType,
} from '@sim/workflow-types/blocks'
import type { SelectorKey } from '@/hooks/selectors/types'
import type { ToolResponse } from '@/tools/types'

export type { OutputCondition, OutputFieldDefinition, PrimitiveValueType, SubBlockType }
export { isHiddenFromDisplay } from '@sim/workflow-types/blocks'

export type BlockIcon = (props: SVGProps<SVGSVGElement>) => JSX.Element
export type ParamType = 'string' | 'number' | 'boolean' | 'json' | 'array' | 'file'

export type BlockCategory = 'blocks' | 'tools' | 'triggers'

export enum IntegrationType {
  AI = 'ai',
  Analytics = 'analytics',
  Commerce = 'commerce',
  Communication = 'communication',
  Databases = 'databases',
  DevOps = 'devops',
  Documents = 'documents',
  Email = 'email',
  HR = 'hr',
  Marketing = 'marketing',
  Observability = 'observability',
  Productivity = 'productivity',
  Sales = 'sales',
  Search = 'search',
  Security = 'security',
  Support = 'support',
}

/**
 * Human-readable label for each canonical integration category. Used by every
 * UI surface that renders a category name — landing /integrations grid,
 * workspace integrations page, dropdowns, etc.
 */
export const INTEGRATION_TYPE_LABELS: Record<IntegrationType, string> = {
  [IntegrationType.AI]: 'AI',
  [IntegrationType.Analytics]: 'Analytics',
  [IntegrationType.Commerce]: 'Commerce',
  [IntegrationType.Communication]: 'Communication',
  [IntegrationType.Databases]: 'Databases',
  [IntegrationType.DevOps]: 'DevOps',
  [IntegrationType.Documents]: 'Documents',
  [IntegrationType.Email]: 'Email',
  [IntegrationType.HR]: 'HR',
  [IntegrationType.Marketing]: 'Marketing',
  [IntegrationType.Observability]: 'Observability',
  [IntegrationType.Productivity]: 'Productivity',
  [IntegrationType.Sales]: 'Sales',
  [IntegrationType.Search]: 'Search',
  [IntegrationType.Security]: 'Security',
  [IntegrationType.Support]: 'Support',
}

/** Format any category slug for display. Falls back to the slug if unknown. */
export function formatIntegrationType(slug: string): string {
  return INTEGRATION_TYPE_LABELS[slug as IntegrationType] ?? slug
}

export type IntegrationTag =
  | 'marketing'
  | 'automation'
  | 'webhooks'
  | 'vector-search'
  | 'meeting'
  | 'calendar'
  | 'scheduling'
  | 'incident-management'
  | 'monitoring'
  | 'error-tracking'
  | 'prediction-markets'
  | 'document-processing'
  | 'ocr'
  | 'text-to-speech'
  | 'speech-to-text'
  | 'image-generation'
  | 'video-generation'
  | 'cloud'
  | 'google-workspace'
  | 'microsoft-365'
  | 'data-warehouse'
  | 'data-analytics'
  | 'customer-support'
  | 'project-management'
  | 'ticketing'
  | 'payments'
  | 'subscriptions'
  | 'enrichment'
  | 'web-scraping'
  | 'llm'
  | 'messaging'
  | 'version-control'
  | 'ci-cd'
  | 'note-taking'
  | 'spreadsheet'
  | 'seo'
  | 'email-marketing'
  | 'e-signatures'
  | 'identity'
  | 'secrets-management'
  | 'hiring'
  | 'sales-engagement'
  | 'agentic'
  | 'knowledge-base'
  | 'content-management'
  | 'forms'
  | 'link-management'
  | 'events'
  | 'feature-flags'

export type ModuleTag = 'knowledge-base' | 'tables' | 'files' | 'workflows' | 'scheduled' | 'agent'

export type TemplateCategory =
  | 'popular'
  | 'sales'
  | 'support'
  | 'engineering'
  | 'marketing'
  | 'productivity'
  | 'operations'

/** Catalog template prompt featuring this block. Never read by the executor. */
export interface BlockTemplate {
  icon: ComponentType<SVGProps<SVGSVGElement>>
  title: string
  prompt: string
  modules: readonly ModuleTag[]
  category: TemplateCategory
  tags: readonly string[]
  image?: string
  featured?: boolean
  /** Other blocks referenced by this template's prompt, besides the owning block. */
  alsoIntegrations?: readonly string[]
}

/**
 * A research-backed, ready-to-add skill suggestion surfaced on an integration's
 * detail page. Adding one creates a workspace skill with these exact fields, so
 * the shape mirrors `skillUpsertItemSchema` (name is kebab-case, content is
 * markdown). Never read by the executor.
 */
export interface SuggestedSkill {
  /** kebab-case identifier; becomes the created skill's `name`. */
  name: string
  /** One-line summary of what the skill does and when to use it. */
  description: string
  /** Skill instructions in markdown; becomes the created skill's `content`. */
  content: string
}

/** Presentation/catalog data for a block. Never read by the executor. */
export interface BlockMeta {
  tags: readonly IntegrationTag[]
  /**
   * Canonical homepage of the external service this block integrates with
   * (e.g. `https://exa.ai`). Distinct from `BlockConfig.docsLink`, which points
   * at Sim's own integration docs. Links back to the tool from its catalog page.
   */
  url?: string
  templates?: readonly BlockTemplate[]
  /** Popular, ready-to-add skills for this integration, shown on its detail page. */
  skills?: readonly SuggestedSkill[]
}

// Authentication modes for sub-blocks and summaries
export enum AuthMode {
  OAuth = 'oauth',
  ApiKey = 'api_key',
  BotToken = 'bot_token',
}

export type GenerationType =
  | 'javascript-function-body'
  | 'typescript-function-body'
  | 'json-schema'
  | 'json-object'
  | 'table-schema'
  | 'system-prompt'
  | 'custom-tool-schema'
  | 'sql-query'
  | 'postgrest'
  | 'mongodb-filter'
  | 'mongodb-pipeline'
  | 'mongodb-sort'
  | 'mongodb-documents'
  | 'mongodb-update'
  | 'neo4j-cypher'
  | 'neo4j-parameters'
  | 'timestamp'
  | 'timezone'
  | 'cron-expression'
  | 'odata-expression'

/**
 * Selector types that require display name hydration
 * These show IDs/keys that need to be resolved to human-readable names
 */
export const SELECTOR_TYPES_HYDRATION_REQUIRED: SubBlockType[] = [
  'oauth-input',
  'channel-selector',
  'user-selector',
  'file-selector',
  'sheet-selector',
  'folder-selector',
  'project-selector',
  'knowledge-base-selector',
  'workflow-selector',
  'document-selector',
  'variables-input',
  'mcp-server-selector',
  'mcp-tool-selector',
  'table-selector',
] as const

export type ExtractToolOutput<T> = T extends ToolResponse ? T['output'] : never

export type ToolOutputToValueType<T> = T extends Record<string, any>
  ? {
      [K in keyof T]: T[K] extends string
        ? 'string'
        : T[K] extends number
          ? 'number'
          : T[K] extends boolean
            ? 'boolean'
            : T[K] extends object
              ? 'json'
              : 'any'
    }
  : never

export type BlockOutput = PrimitiveValueType | { [key: string]: any }

interface ParamConfig {
  type: ParamType
  description?: string
  schema?: {
    type: string
    properties: Record<string, any>
    required?: string[]
    additionalProperties?: boolean
    items?: {
      type: string
      properties?: Record<string, any>
      required?: string[]
      additionalProperties?: boolean
    }
  }
}

export interface SubBlockConfig {
  id: string
  title?: string
  type: SubBlockType
  mode?: 'basic' | 'advanced' | 'both' | 'trigger' | 'trigger-advanced' // Default is 'both' if not specified. 'trigger' means only shown in trigger mode. 'trigger-advanced' is the advanced side of a trigger field — either a canonical pair member or a standalone field shown under the block-level advanced toggle
  canonicalParamId?: string
  /** Controls parameter visibility in agent/tool-input context */
  paramVisibility?: 'user-or-llm' | 'user-only' | 'llm-only' | 'hidden'
  required?:
    | boolean
    | {
        field: string
        value: string | number | boolean | Array<string | number | boolean>
        not?: boolean
        and?: {
          field: string
          value: string | number | boolean | Array<string | number | boolean> | undefined
          not?: boolean
        }
      }
    | ((values?: Record<string, unknown>) => {
        field: string
        value: string | number | boolean | Array<string | number | boolean>
        not?: boolean
        and?: {
          field: string
          value: string | number | boolean | Array<string | number | boolean> | undefined
          not?: boolean
        }
      })
  defaultValue?: string | number | boolean | Record<string, unknown> | Array<unknown>
  options?:
    | {
        label: string
        id: string
        icon?: React.ComponentType<{ className?: string }>
        group?: string
        hidden?: boolean
        defaultChecked?: boolean
        description?: string
      }[]
    | (() => {
        label: string
        id: string
        icon?: React.ComponentType<{ className?: string }>
        group?: string
        hidden?: boolean
        defaultChecked?: boolean
        description?: string
      }[])
  min?: number
  max?: number
  columns?: string[]
  placeholder?: string
  password?: boolean
  readOnly?: boolean
  showCopyButton?: boolean
  connectionDroppable?: boolean
  hidden?: boolean
  hideFromPreview?: boolean // Hide this subblock from the workflow block preview
  showWhenEnvSet?: string // Show this subblock only when the named NEXT_PUBLIC_ env var is truthy
  hideWhenHosted?: boolean // Hide this subblock when running on hosted sim
  hideWhenEnvSet?: string // Hide this subblock when the named NEXT_PUBLIC_ env var is truthy
  description?: string
  tooltip?: string // Tooltip text displayed via info icon next to the title
  modalId?: string // Registry key when type is 'modal'; see sub-block/components/modal-registry.ts
  value?: (params: Record<string, any>) => string
  grouped?: boolean
  scrollable?: boolean
  maxHeight?: number
  selectAllOption?: boolean
  condition?:
    | {
        field: string
        value: string | number | boolean | Array<string | number | boolean>
        not?: boolean
        and?: {
          field: string
          value: string | number | boolean | Array<string | number | boolean> | undefined
          not?: boolean
        }
      }
    | ((values?: Record<string, unknown>) => {
        field: string
        value: string | number | boolean | Array<string | number | boolean>
        not?: boolean
        and?: {
          field: string
          value: string | number | boolean | Array<string | number | boolean> | undefined
          not?: boolean
        }
      })
  /**
   * Credential-type visibility gate. The first non-empty string value from
   * `watchFields` is treated as a credential ID and fetched via the credentials
   * API. The subblock is hidden unless `credential.type` matches `requiredType`.
   *
   * Only one subblock per block may use this. The serializer ignores it —
   * the field is always serialized when it has a value.
   */
  reactiveCondition?: {
    watchFields: string[]
    requiredType: 'oauth' | 'service_account'
  }
  // Props specific to 'code' sub-block type
  language?: 'javascript' | 'json' | 'python'
  generationType?: GenerationType
  collapsible?: boolean // Whether the code block can be collapsed
  defaultCollapsed?: boolean // Whether the code block is collapsed by default
  // OAuth specific properties - serviceId is the canonical identifier for OAuth services
  serviceId?: string
  requiredScopes?: string[]
  /**
   * Narrows an `oauth-input` selector to a specific credential kind. `'custom-bot'`
   * lists only reusable custom Slack bot credentials (service-account type) and its
   * connect row opens the custom-bot setup modal instead of the OAuth flow.
   * `'service-account'` is the generic equivalent for a no-OAuth provider: it lists
   * only service-account credentials and its connect row opens the descriptor-driven
   * token-paste modal (`ConnectServiceAccountModal`). `'any'` lists OAuth accounts
   * and custom bots together in a grouped dropdown with a connect action for each kind.
   */
  credentialKind?: 'custom-bot' | 'service-account' | 'any'
  /**
   * Opts a trigger-mode `oauth-input` selector into listing service-account
   * credentials, which are otherwise excluded in trigger mode. Set only when the
   * trigger's server-side polling path can resolve the provider's service-account
   * token (see `resolveOAuthCredential` in `@/lib/webhooks/polling/utils`).
   */
  allowServiceAccounts?: boolean
  // Selector properties — declarative mapping to a SelectorKey
  selectorKey?: SelectorKey
  selectorAllowSearch?: boolean
  // File selector specific properties
  mimeType?: string
  // File upload specific properties
  acceptedTypes?: string
  multiple?: boolean
  maxSize?: number
  /**
   * When true, FileUpload checks for S3/Blob and warns / disables new uploads if missing.
   * Used by providers (e.g. Instagram) that need a Meta-fetchable public HTTPS URL.
   */
  requiresCloudStorage?: boolean
  // Slider-specific properties
  step?: number
  integer?: boolean
  // Long input specific properties
  rows?: number
  // Multi-select functionality
  multiSelect?: boolean
  // Combobox specific: Enable search input in dropdown
  searchable?: boolean
  /** Dropdown-specific: include static options as Cmd K search entries that preset this subblock. */
  commandSearchable?: boolean
  // Wand configuration for AI assistance
  wandConfig?: {
    enabled: boolean
    prompt: string // Custom prompt template for this subblock
    generationType?: GenerationType // Optional custom generation type
    placeholder?: string // Custom placeholder for the prompt input
    maintainHistory?: boolean // Whether to maintain conversation history
  }
  /**
   * Declarative dependency hints for cross-field clearing or invalidation.
   * Supports two formats:
   * - Simple array: `['credential']` - all fields must have values (AND logic)
   * - Object with all/any: `{ all: ['authMethod'], any: ['credential', 'botToken'] }`
   *   - `all`: all listed fields must have values (AND logic)
   *   - `any`: at least one field must have a value (OR logic)
   */
  dependsOn?: string[] | { all?: string[]; any?: string[] }
  // Copyable-text specific: Use webhook URL from webhook management hook
  useWebhookUrl?: boolean
  // Dropdown/Combobox: Function to fetch options dynamically
  // Works with both 'dropdown' (select-only) and 'combobox' (editable with expression support)
  fetchOptions?: (blockId: string) => Promise<Array<{ label: string; id: string }>>
  // Dropdown/Combobox: Function to fetch a single option's label by ID (for hydration)
  // Called when component mounts with a stored value to display the correct label before options load
  fetchOptionById?: (
    blockId: string,
    optionId: string
  ) => Promise<{ label: string; id: string } | null>
  /**
   * tool-input only: tool categories the consuming block cannot execute. They
   * stay visible in the picker but are greyed out with a tooltip rather than
   * hidden. Block/integration tools always run via `executeTool`, so only the
   * non-registry categories (`mcp`, `custom-tool`) can be marked unsupported.
   */
  unsupportedToolTypes?: ('mcp' | 'custom-tool')[]
}

export interface BlockConfig<T extends ToolResponse = ToolResponse> {
  type: string
  name: string
  description: string
  category: BlockCategory
  integrationType?: IntegrationType
  longDescription?: string
  bestPractices?: string
  docsLink?: string
  bgColor: string
  /**
   * Theme-safe brand foreground color for rendering this block's icon WITHOUT
   * its colored tile background (a "bare" icon). Unlike {@link bgColor}, which
   * is the tile fill, this is applied as the icon's `color`/`currentColor` and
   * must read clearly on both light and dark surfaces — so only set it to vivid
   * brand colors (e.g. HubSpot `#FF7A59`), never near-black tile colors. When
   * omitted, bare renders fall back to the theme-aware `var(--text-icon)`.
   */
  iconColor?: string
  icon: BlockIcon
  subBlocks: SubBlockConfig[]
  triggerAllowed?: boolean
  authMode?: AuthMode
  singleInstance?: boolean
  tools: {
    access: string[]
    config?: {
      tool: (params: Record<string, any>) => string
      params?: (params: Record<string, any>) => Record<string, any>
    }
  }
  inputs: Record<string, ParamConfig>
  outputs: Record<string, OutputFieldDefinition> & {
    visualization?: {
      type: 'image'
      url: string
    }
  }
  hideFromToolbar?: boolean
  /**
   * For published custom blocks only: the bound source workflow's id. Discovery
   * surfaces use it to hide a workflow's own block on that workflow's canvas
   * (placing it would recurse).
   */
  sourceWorkflowId?: string
  /**
   * Marks an unreleased block. Preview blocks are hidden from every discovery
   * surface (toolbar, search, mentions, copilot/VFS, docs) in every environment —
   * hosted, self-hosted, dev, and SSR — until revealed via the hosted
   * `block-visibility` AppConfig document or the `PREVIEW_BLOCKS` env allowlist.
   * Fail-closed by design; distinct from {@link hideFromToolbar} (permanently
   * hidden superseded versions). Execution of already-placed instances is never
   * gated. Remove at GA.
   */
  preview?: boolean
  /**
   * Post-GA lifecycle state. `legacy` — superseded but still supported (amber
   * badge, click-to-upgrade); `deprecated` — no longer supported, slated for
   * removal (red badge). Placed instances keep executing and rendering in both
   * states. `replacedBy` is the block `type` to migrate to — omit when no direct
   * successor exists. Distinct from {@link hideFromToolbar} (a rendering
   * decision) and {@link preview} (unreleased). Remove config at end-of-life.
   */
  sunset?: {
    status: 'legacy' | 'deprecated'
    replacedBy?: string
  }
  triggers?: {
    enabled: boolean
    available: string[] // List of trigger IDs this block supports
  }
}

interface OutputConfig {
  type: BlockOutput
}
