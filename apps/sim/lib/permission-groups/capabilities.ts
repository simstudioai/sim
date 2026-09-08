import type { ForbiddenDetailCode } from '@/lib/core/application/forbidden'
import { PermissionGroupCapabilityError } from '@/lib/permission-groups/capability-error'
import type {
  PermissionGroupConfig,
  PermissionGroupConfigKey,
} from '@/lib/permission-groups/fields'

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
  'sandboxes.use',
] as const

export type PermissionGroupCapability = (typeof CAPABILITY_IDS)[number]

interface CapabilityRuleBase {
  /** The config keys this rule reads, so the audit can prove a key is enforced. */
  readonly configKeys: readonly PermissionGroupConfigKey[]
  readonly detailCode: ForbiddenDetailCode
  /**
   * The subject of the shared refusal sentence — `<describe> is not available
   * under your organization's permission group` — so it is written as a
   * singular noun or gerund phrase that agrees with the verb.
   */
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
 * Shared so the funnel, a raw route gating inline, and a parameterized rule
 * asserted from a use case cannot word the same refusal three ways. Each rule's
 * `describe` is written to read as this sentence's subject.
 */
export function capabilityRefusal(capability: PermissionGroupCapability): string {
  return `${CAPABILITY_RULES[capability].describe} is not available under your organization's permission group`
}

/**
 * Throws {@link capabilityRefusal} as the error the surfaces project.
 *
 * Accepts any capability, static or parameterized, because a parameterized one
 * is refused from a call site rather than by the funnel and still has to read
 * identically.
 */
export function refuseCapability(capability: PermissionGroupCapability): never {
  throw new PermissionGroupCapabilityError(
    capability,
    CAPABILITY_RULES[capability].detailCode,
    capabilityRefusal(capability)
  )
}

/** An allowlist denies a member when it is set and does not name it; `null` names everything. */
function allowlistDenies(allowed: readonly string[] | null, member: string): boolean {
  return allowed !== null && !allowed.includes(member)
}

/**
 * What each capability means in terms of the stored config.
 *
 * `satisfies` rather than an annotation, so adding a capability still fails to
 * compile until it is given a rule while each entry keeps its own `kind`.
 * Annotating would widen every entry to `CapabilityRule`, and
 * {@link StaticPermissionGroupCapability} would then resolve to `never`,
 * silently rejecting every capability an operation tried to declare.
 */
export const CAPABILITY_RULES = {
  'knowledge.use': {
    kind: 'static',
    configKeys: ['hideKnowledgeBaseTab'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'The Knowledge Base module',
    deniedBy: (config) => config.hideKnowledgeBaseTab,
  },
  'tables.use': {
    kind: 'static',
    configKeys: ['hideTablesTab'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'The Tables module',
    deniedBy: (config) => config.hideTablesTab,
  },
  'files.use': {
    kind: 'static',
    configKeys: ['hideFilesTab'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'The Files module',
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
    describe: 'Managing secrets',
    deniedBy: (config) => config.hideSecretsTab,
  },
  'api_keys.manage': {
    kind: 'static',
    configKeys: ['hideApiKeysTab'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Managing API keys',
    deniedBy: (config) => config.hideApiKeysTab,
  },
  'integrations.manage': {
    kind: 'static',
    configKeys: ['hideIntegrationsTab'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Managing integrations',
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
    deniedBy: (config, mode) => allowlistDenies(config.allowedChatDeployAuthTypes, mode),
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
    deniedBy: (config, mode) => allowlistDenies(config.allowedFileShareAuthTypes, mode),
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
    describe: 'Sending invitations',
    deniedBy: (config) => config.disableInvitations,
  },
  'mcp_tools.use': {
    kind: 'static',
    configKeys: ['disableMcpTools'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Calling MCP tools',
    deniedBy: (config) => config.disableMcpTools,
  },
  'custom_tools.use': {
    kind: 'static',
    configKeys: ['disableCustomTools'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Calling custom tools',
    deniedBy: (config) => config.disableCustomTools,
  },
  'skills.use': {
    kind: 'static',
    configKeys: ['disableSkills'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Loading skills',
    deniedBy: (config) => config.disableSkills,
  },
  'logs.trace_spans': {
    kind: 'static',
    configKeys: ['hideTraceSpans'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'The per-block execution trace',
    deniedBy: (config) => config.hideTraceSpans,
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
    describe: 'Using a personal API key',
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
  /**
   * Also reads `hideKnowledgeBaseTab`, because an operation declares exactly one
   * capability: moving knowledge-base creation off `knowledge.use` would
   * otherwise let a group that withheld the whole module still create one
   * through the API. The narrower capability has to subsume the broader.
   */
  'knowledge.create': {
    kind: 'static',
    configKeys: ['disableKnowledgeBaseCreation', 'hideKnowledgeBaseTab'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Creating a knowledge base',
    deniedBy: (config) => config.disableKnowledgeBaseCreation || config.hideKnowledgeBaseTab,
  },
  /** Subsumes `knowledge.use` for the same reason as `knowledge.create`. */
  'knowledge.upload': {
    kind: 'static',
    configKeys: ['disableKnowledgeBaseFileUpload', 'hideKnowledgeBaseTab'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Uploading documents to a knowledge base',
    deniedBy: (config) => config.disableKnowledgeBaseFileUpload || config.hideKnowledgeBaseTab,
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
  /**
   * Also reads `hideTablesTab`, for the reason `knowledge.create` does: an
   * operation declares exactly one capability, so the narrower one replacing the
   * broader one on `tables.create` would otherwise let a group that withholds
   * the whole module still create tables through the API.
   */
  'tables.create': {
    kind: 'static',
    configKeys: ['disableTableCreation', 'hideTablesTab'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Creating a table',
    deniedBy: (config) => config.disableTableCreation || config.hideTablesTab,
  },
  /** Subsumes `tables.use` for the same reason as `tables.create`. */
  'tables.export': {
    kind: 'static',
    configKeys: ['disableTableExport', 'hideTablesTab'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Exporting a table',
    deniedBy: (config) => config.disableTableExport || config.hideTablesTab,
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
    describe: 'Creating a workspace',
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
    describe: 'Creating a webhook trigger',
    deniedBy: (config) => config.disableWebhookTriggers,
  },
  'copilot.tool_auto_approval': {
    kind: 'static',
    configKeys: ['disableToolAutoApproval'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'Silencing a tool confirmation',
    deniedBy: (config) => config.disableToolAutoApproval,
  },
  'sandboxes.use': {
    kind: 'static',
    configKeys: ['hideSandboxesTab'],
    detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    describe: 'The Sandboxes module',
    deniedBy: (config) => config.hideSandboxesTab,
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

/**
 * Proof that the static/parameterized split resolves.
 *
 * `StaticPermissionGroupCapability` reads each rule's own `kind`, so annotating
 * {@link CAPABILITY_RULES} instead of using `satisfies` would widen every entry
 * and collapse this type to `never` — at which point no operation could declare
 * any capability and every gate would silently never fire. Nothing at runtime
 * would look wrong, so it is asserted here.
 *
 * The aliases below are deliberately unexported: the constraint on
 * {@link Assert} is checked where the alias is declared, so an export bought
 * nothing but the appearance of a consumer that never existed. They are unused
 * on purpose, and deleting one deletes the proof.
 */
type Assert<T extends true> = T

type AssertsStaticCapabilityResolves = Assert<
  'tables.use' extends StaticPermissionGroupCapability ? true : false
>
type AssertsParameterizedCapabilityIsExcluded = Assert<
  'deploy.chat.auth_mode' extends StaticPermissionGroupCapability ? false : true
>
