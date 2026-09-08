import { z } from 'zod'

/**
 * Auth modes a public file share or a chat deployment can use; admins may
 * restrict the allowed subset. The two surfaces share the same four modes.
 */
export const FILE_SHARE_AUTH_TYPES = ['public', 'password', 'email', 'sso'] as const

const shareAuthType = z.enum(FILE_SHARE_AUTH_TYPES)

/**
 * Which mechanism refuses a request when this key is set.
 *
 * - `capability`: an operation declares a capability whose rule reads the key,
 *   so the authorization funnel refuses before the use case runs.
 * - `executor`: the key is read per block, tool or model at execution time by
 *   `assertPermissionsAllowed`. It governs what a run may *do*, which no
 *   operation-level gate can express.
 * - `ui-only`: the key hides a surface without withholding it, so a caller that
 *   skips the UI still reaches the API.
 *
 * Declared rather than inferred, because `ui-only` is the value an admin is
 * most likely to mistake for a control — twelve keys shipped that way.
 *
 * Not derived from the capability rules, which also name config keys, and not
 * worth collapsing into them: `capabilities.ts` imports this module for
 * `PermissionGroupConfigKey`, so the dependency runs one way only, and the two
 * are different facts anyway — a field is storage plus admin UI, a rule is a
 * decision — related many-to-many (`knowledge.create` reads two keys;
 * `hideKnowledgeBaseTab` is read by three rules). This value is the single fact
 * they share, and `check:permission-group-enforcement` is what keeps it honest
 * in both directions.
 */
type PermissionGroupEnforcement = 'capability' | 'executor' | 'ui-only'

/**
 * Which group a key's capability is actually read from when it is enforced.
 *
 * - `workspace`: resolved from the group governing the caller in the workspace
 *   the request names, so the group being edited is the group that applies.
 * - `organization`: resolved from the organization's *default* group, because
 *   the act names no workspace (creating one, reading the member directory).
 *   Setting it on any other group changes nothing at all.
 * - `workspace-or-organization`: both, on different paths — a workspace-scoped
 *   act reads this group, and the same capability's account-level path
 *   (minting a key, an organization-wide invitation) falls back to the default
 *   group.
 *
 * Declared because the editor renders every key on every group, and two of them
 * are read from one group no matter which is open. That was disclosed only in a
 * hint an admin has to hover, so the checkbox looked like it did something on
 * the group in front of them; `scope` is what lets the editor say so in the row
 * itself. Required rather than optional so the next organization-scoped key
 * ships marked instead of inheriting the majority answer by omission.
 */
export type PermissionGroupCapabilityScope =
  | 'workspace'
  | 'organization'
  | 'workspace-or-organization'

/** The admin-editor descriptor for a boolean key, rendered from the registry. */
interface PlatformFeatureMeta {
  readonly id: string
  readonly label: string
  readonly category: string
  /** See {@link PermissionGroupCapabilityScope}. */
  readonly scope: PermissionGroupCapabilityScope
  /**
   * What the key withholds, in one or two short sentences. Read twice — as the
   * editor's hint and as the prose `getActivePermissionGroupRestrictions`
   * reports for an active restriction — so it states the restriction rather
   * than what remains permitted, which reads backwards in the second place.
   *
   * It must describe the *access* withheld, never a surface hidden. Every key
   * with `enforcement: 'capability'` refuses at the API, so a hint that says
   * "hide from the sidebar" tells an admin they are tidying a nav bar when they
   * are revoking a module. Twelve keys shipped worded that way while they were
   * genuinely cosmetic; the wording outlived the behavior.
   */
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
  readonly writeSchema: z.ZodOptional<z.ZodBoolean>
  readonly readSchema: z.ZodBoolean
  readonly tolerantSchema: z.ZodType<boolean>
  readonly default: boolean
  readonly enforcement: PermissionGroupEnforcement
  readonly feature: PlatformFeatureMeta
}

interface AllowlistField<TItem extends z.ZodType = z.ZodType> {
  readonly kind: 'allowlist'
  readonly writeSchema: z.ZodOptional<z.ZodNullable<z.ZodArray<TItem>>>
  readonly readSchema: z.ZodNullable<z.ZodArray<TItem>>
  readonly tolerantSchema: z.ZodType<z.infer<TItem>[] | null>
  readonly default: null
  readonly enforcement: PermissionGroupEnforcement
  readonly phrasing: AllowlistPhrasing
}

interface DenylistField<TItem extends z.ZodType = z.ZodType> {
  readonly kind: 'denylist'
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
 * not add enforcement: `enforcement` names the mechanism that refuses, and
 * `check:permission-group-enforcement` refuses a key that claims one it does
 * not have.
 */
export const PERMISSION_GROUP_FIELDS = {
  allowedIntegrations: allowlist(z.string(), 'executor', {
    limited: 'Integrations and blocks are limited to effectiveConfig.allowedIntegrations.',
    empty: 'No non-exempt integrations or blocks are allowed.',
  }),
  allowedModelProviders: allowlist(z.string(), 'executor', {
    limited: 'Model providers are limited to effectiveConfig.allowedModelProviders.',
    empty: 'No model providers are allowed.',
  }),
  deniedModels: denylist(
    z.string(),
    'executor',
    'Models listed in effectiveConfig.deniedModels are blocked.'
  ),
  deniedTools: denylist(
    z.string(),
    'executor',
    'Integration tools listed in effectiveConfig.deniedTools are blocked.'
  ),
  hideTraceSpans: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'hide-trace-spans',
    label: 'Trace Spans',
    category: 'Logs',
    hint: 'Withhold per-block trace spans from logs and from the API.',
  }),
  hideKnowledgeBaseTab: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'hide-knowledge-base',
    label: 'Knowledge Base',
    category: 'Knowledge Base',
    hint: 'Revoke the Knowledge Base module. Members cannot open, search, or query any knowledge base.',
  }),
  hideTablesTab: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'hide-tables',
    label: 'Tables',
    category: 'Tables',
    hint: 'Revoke the Tables module. Members cannot read or write any table.',
  }),
  hideCopilot: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'hide-copilot',
    label: 'Chat',
    category: 'Modules',
    hint: 'Revoke Chat. Members cannot ask Sim to build or edit anything.',
  }),
  hideIntegrationsTab: booleanRestriction('capability', {
    scope: 'workspace-or-organization',
    id: 'hide-integrations',
    label: 'Integrations',
    category: 'Credentials & Access',
    hint: 'Revoke integration connections. Members cannot view, add, or remove an OAuth connection.',
  }),
  hideSecretsTab: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'hide-secrets',
    label: 'Secrets',
    category: 'Credentials & Access',
    hint: 'Revoke secrets. Members cannot read, add, or change a workspace environment variable.',
  }),
  hideApiKeysTab: booleanRestriction('capability', {
    scope: 'workspace-or-organization',
    id: 'hide-api-keys',
    label: 'API Keys',
    category: 'Credentials & Access',
    hint: 'Revoke workspace API keys. Members cannot list, create, or revoke one.',
  }),
  hideInboxTab: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'hide-inbox',
    label: 'Sim Mailer',
    category: 'Modules',
    hint: 'Revoke the Sim Mailer inbox. Members cannot read or send mail.',
  }),
  hideFilesTab: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'hide-files',
    label: 'Files',
    category: 'Files',
    hint: 'Revoke the Files module. Members cannot list, upload, or download workspace files.',
  }),
  disableMcpTools: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'disable-mcp',
    label: 'MCP Tools',
    category: 'Tools',
    hint: 'Block agents from calling MCP tools.',
  }),
  disableCustomTools: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'disable-custom-tools',
    label: 'Custom Tools',
    category: 'Tools',
    hint: 'Block agents from calling user-defined custom tools.',
  }),
  disableSkills: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'disable-skills',
    label: 'Skills',
    category: 'Tools',
    hint: 'Block agents from loading skills.',
  }),
  disableInvitations: booleanRestriction('capability', {
    scope: 'workspace-or-organization',
    id: 'disable-invitations',
    label: 'Invitations',
    category: 'Collaboration',
    hint: 'Prevent inviting anyone to a workspace or to the organization.',
  }),
  disablePublicApi: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'disable-public-api',
    label: 'Public API',
    category: 'Deployment',
    hint: 'Revoke public API access. Calls to a deployed workflow are refused.',
  }),
  disablePublicFileSharing: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'disable-public-file-sharing',
    label: 'Public Sharing',
    category: 'Files',
    hint: 'Revoke public file sharing. Members cannot create a share link.',
  }),
  allowedFileShareAuthTypes: allowlist(shareAuthType, 'capability', {
    limited:
      'Public file-share authentication is limited to effectiveConfig.allowedFileShareAuthTypes.',
    empty: 'No public file-share authentication modes are allowed.',
  }),
  hideDeployApi: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'hide-deploy-api',
    label: 'API Deployment',
    category: 'Deployment',
    hint: 'Prevent deploying a workflow as an API endpoint.',
  }),
  hideDeployMcp: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'hide-deploy-mcp',
    label: 'MCP Server',
    category: 'Deployment',
    hint: 'Prevent exposing a workflow as an MCP server.',
  }),
  hideDeployChatbot: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'hide-deploy-chatbot',
    label: 'Chat Deployment',
    category: 'Deployment',
    hint: 'Prevent publishing a workflow as a chat.',
  }),
  allowedChatDeployAuthTypes: allowlist(shareAuthType, 'capability', {
    limited:
      'Chat deployment authentication is limited to effectiveConfig.allowedChatDeployAuthTypes.',
    empty: 'No chat deployment authentication modes are allowed.',
  }),
  /**
   * Appended rather than grouped with the other restrictions: declaration order
   * is the wire order, and moving an existing key would read as an unsaved
   * change in every open group editor.
   */
  disablePersonalApiKeys: booleanRestriction('capability', {
    scope: 'workspace-or-organization',
    id: 'disable-personal-api-keys',
    label: 'Personal API Keys',
    category: 'Credentials & Access',
    hint: 'Prevent members from using a personal API key against this workspace.',
  }),
  disableLogExport: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'disable-log-export',
    label: 'Log Export',
    category: 'Logs',
    hint: 'Prevent downloading execution logs as a CSV.',
  }),
  hideCostInfo: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'hide-cost-info',
    label: 'Execution Cost',
    category: 'Logs',
    hint: 'Withhold execution cost. Logs and member exports omit cost and token spend; organization-level data drains, configurable by org admins only, are not projected.',
  }),
  disableKnowledgeBaseCreation: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'disable-knowledge-base-creation',
    label: 'Knowledge Base Creation',
    category: 'Knowledge Base',
    hint: 'Prevent creating knowledge bases, leaving existing ones queryable.',
  }),
  disableKnowledgeBaseFileUpload: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'disable-knowledge-base-upload',
    label: 'Knowledge Base Uploads',
    category: 'Knowledge Base',
    hint: 'Prevent uploading local documents, leaving sanctioned connectors as the only source.',
  }),
  allowedKnowledgeConnectors: allowlist(z.string(), 'capability', {
    limited: 'Knowledge base connectors are limited to effectiveConfig.allowedKnowledgeConnectors.',
    empty: 'No knowledge base connectors are allowed.',
  }),
  disableTableCreation: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'disable-table-creation',
    label: 'Table Creation',
    category: 'Tables',
    hint: 'Prevent creating tables, leaving existing ones usable.',
  }),
  disableTableExport: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'disable-table-export',
    label: 'Table Export',
    category: 'Tables',
    hint: 'Prevent downloading a whole table as CSV or JSON.',
  }),
  disableBulkFileDownload: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'disable-bulk-file-download',
    label: 'Bulk Download',
    category: 'Files',
    hint: 'Prevent downloading folders as an archive.',
  }),
  disablePersonalCredentials: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'disable-personal-credentials',
    label: 'Personal Credentials',
    category: 'Credentials & Access',
    hint: 'Prevent connecting personal credentials, leaving only workspace-shared ones.',
  }),
  disableWorkspaceCreation: booleanRestriction('capability', {
    scope: 'organization',
    id: 'disable-workspace-creation',
    label: 'Workspace Creation',
    category: 'Collaboration',
    hint: "Prevent creating new workspaces, which no existing group would govern. Read from the organization's default group, because creating a workspace names none.",
  }),
  hideOrgMemberDirectory: booleanRestriction('capability', {
    scope: 'organization',
    id: 'hide-org-member-directory',
    label: 'Member Directory',
    category: 'Collaboration',
    hint: "Withhold the member directory. Members cannot see the names or email addresses of other members. Read from the organization's default group, because the directory belongs to the organization and names no workspace.",
  }),
  disableCliAccess: booleanRestriction('capability', {
    scope: 'workspace-or-organization',
    id: 'disable-cli-access',
    label: 'CLI Access',
    category: 'Credentials & Access',
    hint: "Prevent approving a CLI login or using Sim CLI OAuth tokens for the public API. A login naming one of this group's workspaces is refused; an account-level login names none, so it is read from the organization's default group.",
  }),
  disableWebhookTriggers: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'disable-webhook-triggers',
    label: 'Webhook Triggers',
    category: 'Deployment',
    hint: 'Prevent making a workflow reachable from an inbound webhook.',
  }),
  disableToolAutoApproval: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'disable-tool-auto-approval',
    label: 'Tool Auto-Approval',
    category: 'Tools',
    hint: 'Prevent silencing a tool confirmation, so every call is confirmed again.',
  }),
  hideSandboxesTab: booleanRestriction('capability', {
    scope: 'workspace',
    id: 'hide-sandboxes',
    label: 'Sandboxes',
    category: 'Modules',
    hint: 'Revoke the Sandboxes module. Members cannot view, create, or change a workspace sandbox.',
  }),
  disableOAuthAppAccess: booleanRestriction('capability', {
    scope: 'workspace-or-organization',
    id: 'disable-oauth-app-access',
    label: 'OAuth App Access',
    category: 'Credentials & Access',
    hint: "Prevent OAuth apps from accessing this group's workspaces. The organization's default group also governs authorizing apps and refreshing their access.",
  }),
} satisfies Record<string, PermissionGroupField>

export type PermissionGroupFields = typeof PERMISSION_GROUP_FIELDS
export type PermissionGroupConfigKey = keyof PermissionGroupFields

type DerivedPermissionGroupConfig = {
  [K in PermissionGroupConfigKey]: z.infer<PermissionGroupFields[K]['readSchema']>
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

/**
 * The config a create or update body may carry: every key optional, so a caller
 * patches only what it means to change. The route merges the result over the
 * group's stored config, which is what heals a row written before a key
 * existed.
 */
export const permissionGroupConfigSchema = z.object(permissionGroupWriteShape)

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

/**
 * Fails to compile unless `T` is exactly `true`, which is what makes the aliases
 * below load-bearing. They are deliberately unexported: the constraint is
 * checked where the alias is declared, so an export bought nothing but the
 * appearance of a consumer that never existed. Nothing may import them; they
 * are unused on purpose, and deleting one deletes the proof.
 */
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
