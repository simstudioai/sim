import { z } from 'zod'

/**
 * Auth modes a public file share or a chat deployment can use; admins may
 * restrict the allowed subset. The two surfaces share the same four modes.
 */
export const FILE_SHARE_AUTH_TYPES = ['public', 'password', 'email', 'sso'] as const

const shareAuthType = z.enum(FILE_SHARE_AUTH_TYPES)

/**
 * Whether a key is refused by a server-side gate or is only a client rendering
 * hint. A `ui-only` key hides a surface without withholding it, so a caller
 * that skips the UI still reaches the API — that is a property to state, not to
 * discover.
 */
export type PermissionGroupEnforcement = 'server' | 'ui-only'

/** The admin-editor descriptor for a boolean key, rendered from the registry. */
interface PlatformFeatureMeta {
  readonly id: string
  readonly label: string
  readonly category: string
  readonly hint: string
}

/** Prose for an allowlist, which reads differently narrowed than emptied. */
interface AllowlistPhrasing {
  readonly limited: string
  readonly empty: string
}

/**
 * Coerces an untrusted value into an array of `item`, element by element.
 *
 * Deliberately not `z.array(item).catch(fallback)`: `.catch` is whole-value
 * tolerant, so one bad member would discard every good one. For an allowlist
 * that is also a fail-open change, because the fallback is `null` and `null`
 * means unrestricted — a partially corrupt allowlist would stop restricting
 * anything. Filtering keeps the surviving members and fails closed.
 */
function tolerantArray<TItem extends z.ZodType, TFallback extends z.infer<TItem>[] | null>(
  item: TItem,
  fallback: TFallback
): z.ZodType<z.infer<TItem>[] | TFallback> {
  return z.unknown().transform((raw) => {
    if (!Array.isArray(raw)) return fallback
    return raw.flatMap((entry) => {
      const parsed = item.safeParse(entry)
      return parsed.success ? [parsed.data as z.infer<TItem>] : []
    })
  })
}

interface BooleanRestrictionField {
  readonly kind: 'boolean-restriction'
  readonly schema: z.ZodBoolean
  readonly writeSchema: z.ZodOptional<z.ZodBoolean>
  readonly readSchema: z.ZodBoolean
  readonly tolerantSchema: z.ZodType<boolean>
  readonly default: boolean
  readonly enforcement: PermissionGroupEnforcement
  readonly feature: PlatformFeatureMeta
}

interface AllowlistField<TItem extends z.ZodType = z.ZodType> {
  readonly kind: 'allowlist'
  readonly schema: z.ZodNullable<z.ZodArray<TItem>>
  readonly writeSchema: z.ZodOptional<z.ZodNullable<z.ZodArray<TItem>>>
  readonly readSchema: z.ZodNullable<z.ZodArray<TItem>>
  readonly tolerantSchema: z.ZodType<z.infer<TItem>[] | null>
  readonly default: null
  readonly enforcement: PermissionGroupEnforcement
  readonly phrasing: AllowlistPhrasing
}

interface DenylistField<TItem extends z.ZodType = z.ZodType> {
  readonly kind: 'denylist'
  readonly schema: z.ZodArray<TItem>
  readonly writeSchema: z.ZodOptional<z.ZodArray<TItem>>
  readonly readSchema: z.ZodDefault<z.ZodArray<TItem>>
  readonly tolerantSchema: z.ZodType<z.infer<TItem>[]>
  readonly default: never[]
  readonly enforcement: PermissionGroupEnforcement
  readonly phrasing: string
}

/**
 * The structural shape every entry satisfies. Deliberately loose in its schema
 * members: a concrete `AllowlistField<ZodString>` is not reliably assignable to
 * `AllowlistField<ZodType>` through zod's internals, and widening the registry
 * to this type would erase the per-key output types the config depends on. It
 * exists for `satisfies`, never as an annotation.
 */
type PermissionGroupField = {
  readonly kind: 'boolean-restriction' | 'allowlist' | 'denylist'
  readonly schema: z.ZodType
  readonly writeSchema: z.ZodType
  readonly readSchema: z.ZodType
  readonly tolerantSchema: z.ZodType
  readonly default: unknown
  readonly enforcement: PermissionGroupEnforcement
}

function booleanRestriction(
  enforcement: PermissionGroupEnforcement,
  feature: PlatformFeatureMeta
): BooleanRestrictionField {
  const schema = z.boolean()
  return {
    kind: 'boolean-restriction',
    schema,
    writeSchema: schema.optional(),
    readSchema: schema,
    tolerantSchema: schema.catch(false),
    default: false,
    enforcement,
    feature,
  }
}

function allowlist<TItem extends z.ZodType>(
  item: TItem,
  enforcement: PermissionGroupEnforcement,
  phrasing: AllowlistPhrasing
): AllowlistField<TItem> {
  const schema = z.array(item).nullable()
  return {
    kind: 'allowlist',
    schema,
    writeSchema: schema.optional(),
    readSchema: schema,
    tolerantSchema: tolerantArray(item, null),
    default: null,
    enforcement,
    phrasing,
  }
}

function denylist<TItem extends z.ZodType>(
  item: TItem,
  enforcement: PermissionGroupEnforcement,
  phrasing: string
): DenylistField<TItem> {
  const schema = z.array(item)
  return {
    kind: 'denylist',
    schema,
    writeSchema: schema.optional(),
    readSchema: schema.default([]),
    tolerantSchema: tolerantArray(item, [] as never[]),
    default: [],
    enforcement,
    phrasing,
  }
}

/**
 * Every permission-group config key, in wire order.
 *
 * Declaration order here is the key order of `PermissionGroupConfig`, of both
 * zod schemas, and of every config JSON that crosses the API boundary. The
 * group editor's dirty check compares stringified configs, so reordering
 * entries is a breaking change.
 *
 * Adding a key here adds it to the write schema, the read schema, the type, the
 * defaults, the tolerant parser and — for a boolean — the admin editor. It does
 * not add enforcement: `enforcement` records whether a server gate exists, and
 * a key declared `server` without one is what `check:permission-group-enforcement`
 * refuses.
 */
export const PERMISSION_GROUP_FIELDS = {
  allowedIntegrations: allowlist(z.string(), 'server', {
    limited: 'Integrations and blocks are limited to effectiveConfig.allowedIntegrations.',
    empty: 'No non-exempt integrations or blocks are allowed.',
  }),
  allowedModelProviders: allowlist(z.string(), 'server', {
    limited: 'Model providers are limited to effectiveConfig.allowedModelProviders.',
    empty: 'No model providers are allowed.',
  }),
  deniedModels: denylist(
    z.string(),
    'server',
    'Models listed in effectiveConfig.deniedModels are blocked.'
  ),
  deniedTools: denylist(
    z.string(),
    'server',
    'Integration tools listed in effectiveConfig.deniedTools are blocked.'
  ),
  hideTraceSpans: booleanRestriction('ui-only', {
    id: 'hide-trace-spans',
    label: 'Trace Spans',
    category: 'Logs',
    hint: 'Hide per-block trace spans in logs.',
  }),
  hideKnowledgeBaseTab: booleanRestriction('ui-only', {
    id: 'hide-knowledge-base',
    label: 'Knowledge Base',
    category: 'Sidebar',
    hint: 'Hide the Knowledge Base module from the sidebar.',
  }),
  hideTablesTab: booleanRestriction('ui-only', {
    id: 'hide-tables',
    label: 'Tables',
    category: 'Sidebar',
    hint: 'Hide the Tables module from the sidebar.',
  }),
  hideCopilot: booleanRestriction('ui-only', {
    id: 'hide-copilot',
    label: 'Chat',
    category: 'Workflow Panel',
    hint: 'Hide the Chat panel so users cannot build or edit with natural language.',
  }),
  hideIntegrationsTab: booleanRestriction('ui-only', {
    id: 'hide-integrations',
    label: 'Integrations',
    category: 'Settings Tabs',
    hint: 'Hide the Integrations settings tab (OAuth connections).',
  }),
  hideSecretsTab: booleanRestriction('ui-only', {
    id: 'hide-secrets',
    label: 'Secrets',
    category: 'Settings Tabs',
    hint: 'Hide the Secrets (environment variables) settings tab.',
  }),
  hideApiKeysTab: booleanRestriction('ui-only', {
    id: 'hide-api-keys',
    label: 'API Keys',
    category: 'Settings Tabs',
    hint: 'Hide the API Keys settings tab.',
  }),
  hideInboxTab: booleanRestriction('ui-only', {
    id: 'hide-inbox',
    label: 'Sim Mailer',
    category: 'Features',
    hint: 'Hide the Sim Mailer inbox.',
  }),
  hideFilesTab: booleanRestriction('ui-only', {
    id: 'hide-files',
    label: 'Files',
    category: 'Settings Tabs',
    hint: 'Hide the Files settings tab.',
  }),
  disableMcpTools: booleanRestriction('server', {
    id: 'disable-mcp',
    label: 'MCP Tools',
    category: 'Tools',
    hint: 'Block agents from calling MCP tools.',
  }),
  disableCustomTools: booleanRestriction('server', {
    id: 'disable-custom-tools',
    label: 'Custom Tools',
    category: 'Tools',
    hint: 'Block agents from calling user-defined custom tools.',
  }),
  disableSkills: booleanRestriction('server', {
    id: 'disable-skills',
    label: 'Skills',
    category: 'Tools',
    hint: 'Block agents from loading skills.',
  }),
  disableInvitations: booleanRestriction('server', {
    id: 'disable-invitations',
    label: 'Invitations',
    category: 'Collaboration',
    hint: 'Prevent users from inviting others to workspaces.',
  }),
  disablePublicApi: booleanRestriction('server', {
    id: 'disable-public-api',
    label: 'Public API',
    category: 'Features',
    hint: 'Disable public API access to deployed workflows.',
  }),
  disablePublicFileSharing: booleanRestriction('server', {
    id: 'disable-public-file-sharing',
    label: 'Public Sharing',
    category: 'Files',
    hint: 'Disable public file-share links.',
  }),
  allowedFileShareAuthTypes: allowlist(shareAuthType, 'server', {
    limited:
      'Public file-share authentication is limited to effectiveConfig.allowedFileShareAuthTypes.',
    empty: 'No public file-share authentication modes are allowed.',
  }),
  hideDeployApi: booleanRestriction('ui-only', {
    id: 'hide-deploy-api',
    label: 'API',
    category: 'Deploy Tabs',
    hint: 'Hide the API deployment option.',
  }),
  hideDeployMcp: booleanRestriction('ui-only', {
    id: 'hide-deploy-mcp',
    label: 'MCP',
    category: 'Deploy Tabs',
    hint: 'Hide the MCP server deployment option.',
  }),
  hideDeployChatbot: booleanRestriction('ui-only', {
    id: 'hide-deploy-chatbot',
    label: 'Deployment',
    category: 'Chat',
    hint: 'Hide the chat deployment option.',
  }),
  allowedChatDeployAuthTypes: allowlist(shareAuthType, 'server', {
    limited:
      'Chat deployment authentication is limited to effectiveConfig.allowedChatDeployAuthTypes.',
    empty: 'No chat deployment authentication modes are allowed.',
  }),
} satisfies Record<string, PermissionGroupField>

export type PermissionGroupFields = typeof PERMISSION_GROUP_FIELDS
export type PermissionGroupConfigKey = keyof PermissionGroupFields

type DerivedPermissionGroupConfig = {
  [K in PermissionGroupConfigKey]: z.infer<PermissionGroupFields[K]['schema']>
}

/**
 * The effective permission-group configuration.
 *
 * Declared as an interface over the derived shape so it keeps a stable name in
 * errors and hovers rather than expanding to a mapped type at every use site.
 */
export interface PermissionGroupConfig extends DerivedPermissionGroupConfig {}

/** The per-field properties that each project into one whole-config shape. */
type FieldProjection = 'writeSchema' | 'readSchema' | 'tolerantSchema' | 'default'

/**
 * Collects one property from every field, preserving declaration order.
 *
 * `Object.fromEntries` widens to an index signature, so the result is asserted
 * back to the mapped type. The assertion is safe by construction — the value at
 * each key is that key's own entry read at a fixed property — but TypeScript
 * cannot follow that correspondence through a union of field kinds, so it is
 * stated once here rather than at each of the four shapes.
 */
function collectFieldProperty<P extends FieldProjection>(
  property: P
): { [K in PermissionGroupConfigKey]: PermissionGroupFields[K][P] } {
  const entries = Object.entries(PERMISSION_GROUP_FIELDS).map(([key, field]) => [
    key,
    field[property],
  ])
  return Object.fromEntries(entries) as {
    [K in PermissionGroupConfigKey]: PermissionGroupFields[K][P]
  }
}

/** The PATCH shape: every key optional, so a partial config is a legal write. */
export const permissionGroupWriteShape = collectFieldProperty('writeSchema')

/** The wire shape: every key present, denylists defaulted. */
export const permissionGroupReadShape = collectFieldProperty('readSchema')

const tolerantConfigSchema = z.object(collectFieldProperty('tolerantSchema'))

/**
 * The unrestricted config: allowlists `null` (everything permitted), denylists
 * empty, restrictions off. Assigned rather than asserted, so each field's
 * declared default has to actually satisfy that key's config type.
 */
export const DEFAULT_PERMISSION_GROUP_CONFIG: PermissionGroupConfig =
  collectFieldProperty('default')

/**
 * Coerces an untrusted stored config into a complete, well-typed one.
 *
 * Never throws: every field is total, and the guard covers the shapes a `jsonb`
 * column can hold that `z.object()` refuses. `Array.isArray` is load-bearing —
 * `typeof [] === 'object'`, so an array-valued column would otherwise reach
 * `.parse` and throw where it used to coerce to defaults.
 */
export function parsePermissionGroupConfig(config: unknown): PermissionGroupConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return DEFAULT_PERMISSION_GROUP_CONFIG
  }
  return tolerantConfigSchema.parse(config)
}

/**
 * Compile-time proof that deriving the config from the registry did not widen
 * it. Every consumer reads these keys expecting a precise type, and a zod
 * generic that degraded to `unknown` would be invisible at runtime — the values
 * would still be right, so no test would fail, while every call site quietly
 * lost its narrowing. Declared here rather than in a `.test.ts` because
 * type-check excludes test files.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

/** Fails to compile unless `T` is exactly `true`, which is what makes the aliases below load-bearing. */
type Assert<T extends true> = T

type AssertsAllowlistStaysPrecise = Assert<
  Exact<PermissionGroupConfig['allowedIntegrations'], string[] | null>
>
type AssertsDenylistStaysPrecise = Assert<Exact<PermissionGroupConfig['deniedTools'], string[]>>
type AssertsRestrictionStaysPrecise = Assert<Exact<PermissionGroupConfig['hideCopilot'], boolean>>
type AssertsAuthTypesStayPrecise = Assert<
  Exact<
    PermissionGroupConfig['allowedFileShareAuthTypes'],
    (typeof FILE_SHARE_AUTH_TYPES)[number][] | null
  >
>
type AssertsParserReturnsTheConfig = Assert<
  Exact<z.output<typeof tolerantConfigSchema>, PermissionGroupConfig>
>

export type {
  AssertsAllowlistStaysPrecise,
  AssertsAuthTypesStayPrecise,
  AssertsDenylistStaysPrecise,
  AssertsParserReturnsTheConfig,
  AssertsRestrictionStaysPrecise,
}
