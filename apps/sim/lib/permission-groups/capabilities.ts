import type { ForbiddenDetailCode } from '@/lib/core/application/forbidden'
import type {
  FILE_SHARE_AUTH_TYPES,
  PermissionGroupConfig,
  PermissionGroupConfigKey,
} from '@/lib/permission-groups/fields'

type ShareAuthMode = (typeof FILE_SHARE_AUTH_TYPES)[number]

/**
 * Every capability a permission group can withhold.
 *
 * Domain-shaped, because the declaration site is an operation
 * (`tables.rows.create`) while the config is surface-shaped (`hideTablesTab`).
 * {@link CAPABILITY_RULES} is the only place the two vocabularies meet — without
 * it every domain's operations module would restate a config key, and the
 * mapping would drift the first time one was renamed.
 *
 * A closed union rather than a predicate on the operation: operations are
 * frozen policy data, and a closure cannot be logged, compared, or read by
 * `check:permission-group-enforcement`. Fifty table operations naming one
 * capability is fifty identical strings, not fifty identical functions.
 */
export const CAPABILITY_IDS = [
  'knowledge.use',
  'tables.use',
  'files.use',
  'inbox.use',
  'copilot.use',
  'secrets.manage',
  'api_keys.manage',
  'integrations.manage',
  'deploy.api',
  'deploy.mcp',
  'deploy.chat',
  'deploy.chat.auth_mode',
  'file_share.publish',
  'file_share.auth_mode',
  'public_api.use',
  'invitations.send',
  'mcp_tools.use',
  'custom_tools.use',
  'skills.use',
  'logs.trace_spans',
  'personal_api_key.use',
  'logs.export',
  'logs.cost',
  'knowledge.create',
  'knowledge.upload',
  'knowledge.connectors',
  'tables.create',
  'tables.export',
  'files.bulk_download',
  'credentials.personal',
  'workspace.create',
  'organization.member_directory',
  'cli.use',
  'triggers.webhook',
  'copilot.tool_auto_approval',
] as const

export type PermissionGroupCapability = (typeof CAPABILITY_IDS)[number]

interface CapabilityRuleBase {
  /** The config keys this rule reads, so the audit can prove a key is enforced. */
  readonly configKeys: readonly PermissionGroupConfigKey[]
  readonly detailCode: ForbiddenDetailCode
  /** Named in the refusal message; the remedy is always an organization admin. */
  readonly describe: string
}

/**
 * Decidable from the config alone, so the authorization funnel can apply it
 * knowing only the principal, the workspace, and the operation.
 */
export interface StaticCapabilityRule extends CapabilityRuleBase {
  readonly kind: 'static'
  deniedBy(config: PermissionGroupConfig): boolean
}

/**
 * Needs a value only the request carries. The funnel never sees request input,
 * and widening the authorization context to carry it would reach every use case
 * for the sake of two keys, so these are asserted from inside `execute` and held
 * to account by the audit's annotation rule instead. They are not valid as an
 * operation's declared capability.
 */
export interface ParameterizedCapabilityRule extends CapabilityRuleBase {
  readonly kind: 'parameterized'
  deniedBy(config: PermissionGroupConfig, parameter: string): boolean
}

export type CapabilityRule = StaticCapabilityRule | ParameterizedCapabilityRule

/**
 * The one sentence every capability refusal uses, wherever it is raised.
 *
 * Shared so a raw route that gates inline cannot drift from what the
 * authorization funnel tells a caller refused for the same reason.
 */
export function capabilityRefusalMessage(describe: string): string {
  return `${describe} is not available under your organization's permission group`
}

function authModeDeniedBy(allowed: ShareAuthMode[] | null, mode: string): boolean {
  return allowed !== null && !allowed.some((allowedMode) => allowedMode === mode)
}

/** An allowlist denies a member when it is set and does not name it; `null` names everything. */
function allowlistDenies(allowed: readonly string[] | null, member: string): boolean {
  return allowed !== null && !allowed.includes(member)
}

/**
 * What each capability means in terms of the stored config.
 *
 * `satisfies` rather than an annotation, so adding a capability still fails to
 * compile until it is given a rule — the same completeness gate
 * `FORBIDDEN_DETAIL_CODE_DESCRIPTIONS` uses — while each entry keeps its own
 * `kind`. Annotating would widen every entry to `CapabilityRule`, and
 * {@link StaticPermissionGroupCapability} would then resolve to `never`,
 * silently rejecting every capability an operation tried to declare.
 */
export const CAPABILITY_RULES = {
  'knowledge.use': {
    kind: 'static',
    configKeys: ['hideKnowledgeBaseTab'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Knowledge bases',
    deniedBy: (config) => config.hideKnowledgeBaseTab,
  },
  'tables.use': {
    kind: 'static',
    configKeys: ['hideTablesTab'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Tables',
    deniedBy: (config) => config.hideTablesTab,
  },
  'files.use': {
    kind: 'static',
    configKeys: ['hideFilesTab'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Files',
    deniedBy: (config) => config.hideFilesTab,
  },
  'inbox.use': {
    kind: 'static',
    configKeys: ['hideInboxTab'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'The inbox',
    deniedBy: (config) => config.hideInboxTab,
  },
  'copilot.use': {
    kind: 'static',
    configKeys: ['hideCopilot'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Chat',
    deniedBy: (config) => config.hideCopilot,
  },
  'secrets.manage': {
    kind: 'static',
    configKeys: ['hideSecretsTab'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Secrets',
    deniedBy: (config) => config.hideSecretsTab,
  },
  'api_keys.manage': {
    kind: 'static',
    configKeys: ['hideApiKeysTab'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'API keys',
    deniedBy: (config) => config.hideApiKeysTab,
  },
  'integrations.manage': {
    kind: 'static',
    configKeys: ['hideIntegrationsTab'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Integrations',
    deniedBy: (config) => config.hideIntegrationsTab,
  },
  'deploy.api': {
    kind: 'static',
    configKeys: ['hideDeployApi'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'API deployment',
    deniedBy: (config) => config.hideDeployApi,
  },
  'deploy.mcp': {
    kind: 'static',
    configKeys: ['hideDeployMcp'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'MCP server deployment',
    deniedBy: (config) => config.hideDeployMcp,
  },
  'deploy.chat': {
    kind: 'static',
    configKeys: ['hideDeployChatbot'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Chat deployment',
    deniedBy: (config) => config.hideDeployChatbot,
  },
  'deploy.chat.auth_mode': {
    kind: 'parameterized',
    configKeys: ['allowedChatDeployAuthTypes'],
    detailCode: 'CHAT_AUTH_MODE_NOT_PERMITTED',
    describe: 'This chat authentication mode',
    deniedBy: (config, mode) => authModeDeniedBy(config.allowedChatDeployAuthTypes, mode),
  },
  'file_share.publish': {
    kind: 'static',
    configKeys: ['disablePublicFileSharing'],
    detailCode: 'PUBLIC_SHARING_NOT_ALLOWED',
    describe: 'Public file sharing',
    deniedBy: (config) => config.disablePublicFileSharing,
  },
  'file_share.auth_mode': {
    kind: 'parameterized',
    configKeys: ['allowedFileShareAuthTypes'],
    detailCode: 'PUBLIC_SHARING_NOT_ALLOWED',
    describe: 'This file-share authentication mode',
    deniedBy: (config, mode) => authModeDeniedBy(config.allowedFileShareAuthTypes, mode),
  },
  'public_api.use': {
    kind: 'static',
    configKeys: ['disablePublicApi'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Public API access',
    deniedBy: (config) => config.disablePublicApi,
  },
  'invitations.send': {
    kind: 'static',
    configKeys: ['disableInvitations'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Invitations',
    deniedBy: (config) => config.disableInvitations,
  },
  'mcp_tools.use': {
    kind: 'static',
    configKeys: ['disableMcpTools'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'MCP tools',
    deniedBy: (config) => config.disableMcpTools,
  },
  'custom_tools.use': {
    kind: 'static',
    configKeys: ['disableCustomTools'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Custom tools',
    deniedBy: (config) => config.disableCustomTools,
  },
  'skills.use': {
    kind: 'static',
    configKeys: ['disableSkills'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Skills',
    deniedBy: (config) => config.disableSkills,
  },
  /**
   * Not declarable on an operation: it refuses a *principal kind* rather than a
   * capability of the resource, so it applies to every operation a personal key
   * could reach. Asserted in the authorization funnel's personal-key branch.
   */
  'personal_api_key.use': {
    kind: 'static',
    configKeys: ['disablePersonalApiKeys'],
    detailCode: 'PERSONAL_API_KEYS_DISABLED',
    describe: 'Personal API keys',
    deniedBy: (config) => config.disablePersonalApiKeys,
  },
  'logs.export': {
    kind: 'static',
    configKeys: ['disableLogExport'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Exporting execution logs',
    deniedBy: (config) => config.disableLogExport,
  },
  'logs.cost': {
    kind: 'static',
    configKeys: ['hideCostInfo'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Execution cost',
    deniedBy: (config) => config.hideCostInfo,
  },
  'knowledge.create': {
    kind: 'static',
    configKeys: ['disableKnowledgeBaseCreation'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Creating knowledge bases',
    deniedBy: (config) => config.disableKnowledgeBaseCreation,
  },
  'knowledge.upload': {
    kind: 'static',
    configKeys: ['disableKnowledgeBaseFileUpload'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Uploading documents to a knowledge base',
    deniedBy: (config) => config.disableKnowledgeBaseFileUpload,
  },
  /**
   * Parameterized on the connector id, because the decision is which source a
   * member may sync — a connector pulls a whole external corpus into the
   * workspace, and an organization that sanctions Drive rarely sanctions every
   * one of the other sixty.
   */
  'knowledge.connectors': {
    kind: 'parameterized',
    configKeys: ['allowedKnowledgeConnectors'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'This knowledge base connector',
    deniedBy: (config, connectorType) =>
      allowlistDenies(config.allowedKnowledgeConnectors, connectorType),
  },
  'tables.create': {
    kind: 'static',
    configKeys: ['disableTableCreation'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Creating tables',
    deniedBy: (config) => config.disableTableCreation,
  },
  'tables.export': {
    kind: 'static',
    configKeys: ['disableTableExport'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Exporting a table',
    deniedBy: (config) => config.disableTableExport,
  },
  'files.bulk_download': {
    kind: 'static',
    configKeys: ['disableBulkFileDownload'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Downloading files in bulk',
    deniedBy: (config) => config.disableBulkFileDownload,
  },
  'credentials.personal': {
    kind: 'static',
    configKeys: ['disablePersonalCredentials'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Connecting personal credentials',
    deniedBy: (config) => config.disablePersonalCredentials,
  },
  'workspace.create': {
    kind: 'static',
    configKeys: ['disableWorkspaceCreation'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Creating workspaces',
    deniedBy: (config) => config.disableWorkspaceCreation,
  },
  'organization.member_directory': {
    kind: 'static',
    configKeys: ['hideOrgMemberDirectory'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'The organization member directory',
    deniedBy: (config) => config.hideOrgMemberDirectory,
  },
  'cli.use': {
    kind: 'static',
    configKeys: ['disableCliAccess'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'CLI access',
    deniedBy: (config) => config.disableCliAccess,
  },
  'triggers.webhook': {
    kind: 'static',
    configKeys: ['disableWebhookTriggers'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Webhook triggers',
    deniedBy: (config) => config.disableWebhookTriggers,
  },
  'copilot.tool_auto_approval': {
    kind: 'static',
    configKeys: ['disableToolAutoApproval'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Silencing a tool confirmation',
    deniedBy: (config) => config.disableToolAutoApproval,
  },
  'logs.trace_spans': {
    kind: 'static',
    configKeys: ['hideTraceSpans'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Execution trace spans',
    deniedBy: (config) => config.hideTraceSpans,
  },
} satisfies { readonly [K in PermissionGroupCapability]: CapabilityRule }

/**
 * The capabilities an operation may declare — the static ones. A parameterized
 * rule needs a request value the funnel cannot see, so naming one on an
 * operation would silently never fire.
 */
export type StaticPermissionGroupCapability = {
  [K in PermissionGroupCapability]: (typeof CAPABILITY_RULES)[K] extends StaticCapabilityRule
    ? K
    : never
}[PermissionGroupCapability]

/** Whether a capability id is one an operation may declare. */
export function isStaticCapability(
  capability: PermissionGroupCapability
): capability is StaticPermissionGroupCapability {
  return CAPABILITY_RULES[capability].kind === 'static'
}

/**
 * Proof that the static/parameterized split resolves.
 *
 * `StaticPermissionGroupCapability` reads each rule's own `kind`, so annotating
 * {@link CAPABILITY_RULES} instead of using `satisfies` would widen every entry
 * and collapse this type to `never` — at which point no operation could declare
 * any capability and every gate would silently never fire. Nothing at runtime
 * would look wrong, so it is asserted here.
 */
type Assert<T extends true> = T

type AssertsStaticCapabilityResolves = Assert<
  'tables.use' extends StaticPermissionGroupCapability ? true : false
>
type AssertsParameterizedCapabilityIsExcluded = Assert<
  'deploy.chat.auth_mode' extends StaticPermissionGroupCapability ? false : true
>

export type { AssertsParameterizedCapabilityIsExcluded, AssertsStaticCapabilityResolves }
