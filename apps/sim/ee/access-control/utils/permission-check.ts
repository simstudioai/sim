import { createLogger } from '@sim/logger'
import type { ShareAuthType } from '@/lib/api/contracts/public-shares'
import {
  getAllowedIntegrationsFromEnv,
  isInvitationsDisabled,
  isPublicApiDisabled,
} from '@/lib/core/config/env-flags'
import { isBlockTypeAccessControlExempt } from '@/lib/permission-groups/block-access'
import {
  CAPABILITY_RULES,
  refuseCapability,
  type StaticCapabilityRule,
} from '@/lib/permission-groups/capabilities'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import {
  resolveAccessControlBlockType,
  toAccessControlAllowlist,
} from '@/lib/permission-groups/integration-allowlist'
import { createToolAccessGate } from '@/lib/permission-groups/operation-access'
import {
  getUserPermissionConfig,
  getUserPermissionConfigForOrganization,
  mergeEnvAllowlist,
} from '@/lib/permission-groups/resolve.server'
import type { ExecutionContext } from '@/executor/types'
import { getProviderFromModel } from '@/providers/utils'

/**
 * The permission-group resolution layer lives in `@/lib/permission-groups`
 * because ~24 domain `operations.ts` modules reach it through the authorization
 * funnel, and none of them may pull in this module's provider, block-registry
 * and billing imports. Re-exported here so the surfaces that already read the
 * validators from one place keep doing so.
 */
export {
  getUserPermissionConfig,
  getUserPermissionConfigForOrganization,
  type ResolvedPermissionGroup,
  resolveVerifiedUserAccessControlContext,
  resolveWorkspaceGroup,
  type UserAccessControlContext,
} from '@/lib/permission-groups/resolve.server'

const logger = createLogger('PermissionCheck')

export class ProviderNotAllowedError extends Error {
  constructor(providerId: string, model: string) {
    super(
      `Provider "${providerId}" is not allowed for model "${model}" based on your permission group settings`
    )
    this.name = 'ProviderNotAllowedError'
  }
}

export class ModelNotAllowedError extends Error {
  constructor(model: string) {
    super(`Model "${model}" is not allowed based on your permission group settings`)
    this.name = 'ModelNotAllowedError'
  }
}

export class IntegrationNotAllowedError extends Error {
  constructor(blockType: string, reason?: string) {
    super(
      reason
        ? `Integration "${blockType}" is not allowed: ${reason}`
        : `Integration "${blockType}" is not allowed based on your permission group settings`
    )
    this.name = 'IntegrationNotAllowedError'
  }
}

export class ToolNotAllowedError extends Error {
  constructor(toolId: string) {
    super(`Tool "${toolId}" is not allowed based on your permission group settings`)
    this.name = 'ToolNotAllowedError'
  }
}

export class McpToolsNotAllowedError extends Error {
  constructor() {
    super('MCP tools are not allowed based on your permission group settings')
    this.name = 'McpToolsNotAllowedError'
  }
}

export class CustomToolsNotAllowedError extends Error {
  constructor() {
    super('Custom tools are not allowed based on your permission group settings')
    this.name = 'CustomToolsNotAllowedError'
  }
}

export class SkillsNotAllowedError extends Error {
  constructor() {
    super('Skills are not allowed based on your permission group settings')
    this.name = 'SkillsNotAllowedError'
  }
}

export class InvitationsNotAllowedError extends Error {
  constructor() {
    super('Invitations are not allowed based on your permission group settings')
    this.name = 'InvitationsNotAllowedError'
  }
}

export class PublicApiNotAllowedError extends Error {
  constructor() {
    super('Public API access is not allowed based on your permission group settings')
    this.name = 'PublicApiNotAllowedError'
  }
}

/**
 * Refuses a public file share the caller's permission group withholds — the
 * master switch, and then — when `authType` is given — the auth mode the share
 * would carry. No-op when access control doesn't apply (non-enterprise /
 * disabled), so non-governed organizations are unaffected.
 *
 * Kept as one helper because these two rules are always asked together: a share
 * is refused if the group withholds sharing at all, or if it sanctions sharing
 * but not this way of gating it.
 */
/** permission-group-enforced: file_share.publish — asserted where a share is created, not per operation */
/** permission-group-enforced: file_share.auth_mode — needs the request auth mode, which the funnel never sees */
export async function validatePublicFileSharing(
  userId: string,
  workspaceId: string,
  authType?: ShareAuthType
): Promise<void> {
  const config = await resolvePermissionGroupConfig(userId, workspaceId, undefined)
  if (!config) {
    return
  }
  if (CAPABILITY_RULES['file_share.publish'].deniedBy(config)) {
    refuseCapability('file_share.publish')
  }
  if (authType && CAPABILITY_RULES['file_share.auth_mode'].deniedBy(config, authType)) {
    logger.warn('File share auth type blocked by permission group', {
      userId,
      workspaceId,
      authType,
    })
    refuseCapability('file_share.auth_mode')
  }
}

/**
 * Refuses a chat deployment auth mode the caller's permission group withholds.
 * No-op when access control doesn't apply (non-enterprise / disabled), so
 * non-governed organizations are unaffected.
 *
 * Callers ask only when the mode actually changes, so a grandfathered mode
 * already saved on a chat survives an edit to some other field. That asymmetry
 * belongs to them — it reads the stored deployment, which this never sees.
 */
/** permission-group-enforced: deploy.chat.auth_mode — needs the request auth mode, which the funnel never sees */
export async function validateChatDeployAuth(
  userId: string,
  workspaceId: string,
  authType: ShareAuthType
): Promise<void> {
  const config = await resolvePermissionGroupConfig(userId, workspaceId, undefined)
  if (!config) {
    return
  }
  if (CAPABILITY_RULES['deploy.chat.auth_mode'].deniedBy(config, authType)) {
    logger.warn('Chat deploy auth type blocked by permission group', {
      userId,
      workspaceId,
      authType,
    })
    refuseCapability('deploy.chat.auth_mode')
  }
}

/**
 * The person a run's group gates are decided about.
 *
 * A run's actor and its gate subject are not the same id. `userId` is the
 * billing/rate actor and the credential subject, and for a trigger with no
 * acting person — a table cell dispatched by a workspace API key — it names the
 * workspace's billing owner. Gating on that bystander denies tools nobody meant
 * to deny and skips the denylist of whoever actually asked, so a trigger that
 * knows its acting person declares it on the run's metadata instead.
 *
 * `undefined` there means "not declared": the surface has always had exactly
 * one person, and the actor stays the subject. A declared `null` is the
 * actorless run — no group, hence no group gate.
 */
function governedSubjectUserId(
  actorUserId: string | undefined,
  ctx: ExecutionContext | undefined
): string | undefined {
  const declared = ctx?.metadata?.capabilityGovernedUserId
  if (declared === undefined) return actorUserId
  return declared ?? undefined
}

/**
 * Cache-aware wrapper around `getUserPermissionConfig`. When an
 * `ExecutionContext` is provided, the resolved config is memoized on the
 * context so repeated checks during a single workflow run share one DB hit.
 *
 * The subject is resolved HERE rather than by each caller, because the memo is
 * keyed by nothing but the context. `validateModelProvider` and
 * `validateBlockType` take the actor's id positionally, so a run declaring a
 * different gate subject had the first model check fill the cache with the
 * BILLING actor's group — and every later `assertPermissionsAllowed`, having
 * correctly resolved the governed subject, was handed that stale entry. Doing
 * the derivation at the one place the config is loaded makes the memo correct
 * by construction: within a run `capabilityGovernedUserId` is fixed, so every
 * path resolves and caches the same person.
 */
async function getPermissionConfig(
  actorUserId: string | undefined,
  workspaceId: string | undefined,
  ctx?: ExecutionContext
): Promise<PermissionGroupConfig | null> {
  const userId = governedSubjectUserId(actorUserId, ctx)
  if (!userId || !workspaceId) {
    return mergeEnvAllowlist(null)
  }

  if (ctx) {
    if (ctx.permissionConfigLoaded) {
      return ctx.permissionConfig ?? null
    }

    const config = await getUserPermissionConfig(userId, workspaceId)
    ctx.permissionConfig = config
    ctx.permissionConfigLoaded = true
    return config
  }

  return getUserPermissionConfig(userId, workspaceId)
}

/**
 * Returns true when `model` appears in the group's model denylist. Comparison is
 * case-insensitive to match the normalization applied by `getProviderFromModel`.
 */
function isModelDenied(config: PermissionGroupConfig, model: string): boolean {
  if (!config.deniedModels || config.deniedModels.length === 0) {
    return false
  }
  const normalized = model.toLowerCase()
  return config.deniedModels.some((denied) => denied.toLowerCase() === normalized)
}

/** Identifies the caller in a log line; never used for a decision. */
interface PermissionSubject {
  userId: string | undefined
  workspaceId: string | undefined
}

/**
 * Refuses `model` when the config withholds its provider or names it outright.
 *
 * Takes a loaded config rather than loading one, so the single-gate entry point
 * and {@link assertPermissionsAllowed} share one copy of the decision. Two
 * copies is how an allowlist stops matching in one of them.
 */
function assertModelAllowed(
  config: PermissionGroupConfig,
  model: string,
  subject: PermissionSubject
): void {
  if (config.allowedModelProviders !== null) {
    const providerId = getProviderFromModel(model)

    if (!config.allowedModelProviders.includes(providerId)) {
      logger.warn('Model provider blocked by permission group', { ...subject, model, providerId })
      throw new ProviderNotAllowedError(providerId, model)
    }
  }

  if (isModelDenied(config, model)) {
    logger.warn('Model blocked by permission group', { ...subject, model })
    throw new ModelNotAllowedError(model)
  }
}

/**
 * Refuses `blockType` when the config's integration allowlist does not name it.
 *
 * Shared with {@link assertPermissionsAllowed} for the reason
 * {@link assertModelAllowed} is. Callers screen out exempt block types first —
 * the exemption also decides whether they need a config at all.
 */
function assertBlockTypeAllowed(
  config: PermissionGroupConfig,
  blockType: string,
  subject: PermissionSubject
): void {
  if (config.allowedIntegrations === null) {
    return
  }

  /**
   * A superseded version is judged as its successor, so an allowlist naming the
   * current block covers every retired version of the same integration. The
   * editor only offers current ids, so without this an admin could not deny a
   * legacy block even knowing it existed.
   *
   * Lowercased *before* resolving, not after: registry keys are lowercase, so
   * `getBlock('Slack')` misses and the successor lookup answers `Slack` — which
   * then compares as `slack` against an allowlist holding `slack_v2` and
   * refuses a block both policies allow. `blockType` reaches here from
   * persisted workflow state and from an agent block's `tool.type`, neither of
   * which is case-normalized upstream. `toAccessControlAllowlist` normalizes
   * the policy side the same way.
   */
  const allowlistType = resolveAccessControlBlockType(blockType.toLowerCase())

  if (!toAccessControlAllowlist(config.allowedIntegrations)?.has(allowlistType)) {
    const envAllowlist = toAccessControlAllowlist(getAllowedIntegrationsFromEnv())
    const blockedByEnv = envAllowlist !== null && !envAllowlist.has(allowlistType)
    logger.warn(
      blockedByEnv
        ? 'Integration blocked by env allowlist'
        : 'Integration blocked by permission group',
      { ...subject, blockType }
    )
    throw new IntegrationNotAllowedError(
      blockType,
      blockedByEnv ? 'blocked by server ALLOWED_INTEGRATIONS policy' : undefined
    )
  }
}

export async function validateModelProvider(
  userId: string | undefined,
  workspaceId: string | undefined,
  model: string,
  ctx?: ExecutionContext
): Promise<void> {
  if (!userId || !workspaceId) {
    return
  }

  const config = await getPermissionConfig(userId, workspaceId, ctx)
  if (!config) {
    return
  }

  assertModelAllowed(config, model, { userId: governedSubjectUserId(userId, ctx), workspaceId })
}

export async function validateBlockType(
  userId: string | undefined,
  workspaceId: string | undefined,
  blockType: string,
  ctx?: ExecutionContext
): Promise<void> {
  if (isBlockTypeAccessControlExempt(blockType)) {
    return
  }

  const config =
    userId && workspaceId
      ? await getPermissionConfig(userId, workspaceId, ctx)
      : mergeEnvAllowlist(null)

  if (!config) {
    return
  }

  assertBlockTypeAllowed(config, blockType, {
    userId: governedSubjectUserId(userId, ctx),
    workspaceId,
  })
}

const INVITATIONS_RULE = CAPABILITY_RULES['invitations.send']

/**
 * Validates if the user is allowed to send invitations. Pass one of:
 *  - `workspaceId` — workspace-scoped invite: block when the user's governing group (explicit or
 *    org default) for the workspace's organization has `disableInvitations`.
 *  - `organizationId` — organization-level invite (no specific workspace target): block when the
 *    user's group in that organization (explicit or the org default) has `disableInvitations`.
 *  - neither — only the global feature flag is checked.
 */
/** permission-group-enforced: invitations.send — organization-scoped, so it resolves the default group rather than a workspace one */
export async function validateInvitationsAllowed(
  userId: string | undefined,
  scope: string | { workspaceId?: string; organizationId?: string } = {}
): Promise<void> {
  if (isInvitationsDisabled) {
    logger.warn('Invitations blocked by feature flag')
    throw new InvitationsNotAllowedError()
  }

  if (!userId) {
    return
  }

  const { workspaceId, organizationId } =
    typeof scope === 'string' ? { workspaceId: scope, organizationId: undefined } : scope

  if (workspaceId) {
    const config = await resolvePermissionGroupConfig(userId, workspaceId, undefined)
    if (config && INVITATIONS_RULE.deniedBy(config)) {
      logger.warn('Invitations blocked by permission group', { userId, workspaceId })
      throw new InvitationsNotAllowedError()
    }
    return
  }

  if (organizationId) {
    const config = await getUserPermissionConfigForOrganization(organizationId)
    if (config && INVITATIONS_RULE.deniedBy(config)) {
      logger.warn('Invitations blocked by permission group (organization-wide)', {
        userId,
        organizationId,
      })
      throw new InvitationsNotAllowedError()
    }
  }
}

/**
 * Validates if the user is allowed to enable public API access on the given
 * workspace. Also checks the global feature flag. When `workspaceId` is
 * omitted only the feature-flag check runs (no permission-group gate).
 */
/** permission-group-enforced: public_api.use — gates the public execution surface, which has no workspace operation */
export async function validatePublicApiAllowed(
  userId: string | undefined,
  workspaceId?: string
): Promise<void> {
  if (isPublicApiDisabled) {
    logger.warn('Public API blocked by feature flag')
    throw new PublicApiNotAllowedError()
  }

  if (!userId || !workspaceId) {
    return
  }

  const config = await resolvePermissionGroupConfig(userId, workspaceId, undefined)

  if (!config) {
    return
  }

  if (CAPABILITY_RULES['public_api.use'].deniedBy(config)) {
    logger.warn('Public API blocked by permission group', { userId, workspaceId })
    throw new PublicApiNotAllowedError()
  }
}

type ToolKind = 'mcp' | 'custom' | 'skill'

/**
 * What each tool kind is gated on. The decision reads
 * {@link CAPABILITY_RULES}, so a renamed config key breaks the build here
 * rather than silently ceasing to deny anything.
 *
 * These keep their own error classes rather than raising the funnel's
 * capability refusal: they surface inside a run, where the executor reports
 * them as the failing block's error, and `lib/mcp` branches on
 * {@link McpToolsNotAllowedError} by identity.
 */
const TOOL_KIND_GATES = {
  mcp: {
    rule: CAPABILITY_RULES['mcp_tools.use'],
    error: McpToolsNotAllowedError,
    blocked: 'MCP tools blocked by permission group',
  },
  custom: {
    rule: CAPABILITY_RULES['custom_tools.use'],
    error: CustomToolsNotAllowedError,
    blocked: 'Custom tools blocked by permission group',
  },
  skill: {
    rule: CAPABILITY_RULES['skills.use'],
    error: SkillsNotAllowedError,
    blocked: 'Skills blocked by permission group',
  },
} as const satisfies Record<
  ToolKind,
  { rule: StaticCapabilityRule; error: new () => Error; blocked: string }
>

interface PermissionAssertion {
  userId: string | undefined
  workspaceId: string | undefined
  model?: string
  blockType?: string
  /**
   * Concrete tool ID being executed (e.g. `slack_canvas`). Checked against the
   * group's `deniedTools` denylist so an admin can allow an integration but deny
   * specific operations within it. Pass the normalized tool id.
   */
  toolId?: string
  toolKind?: ToolKind
  ctx?: ExecutionContext
}

/**
 * Unified entry point for workspace-scoped access control. Loads the user's
 * permission config for `workspaceId` once and runs every applicable gate
 * (model provider, block type, tool id, tool kind) against it, throwing the
 * granular error classes on the first mismatch.
 *
 * This decides what a *run* may do, which is not what the authorization funnel
 * decides: the funnel refuses an operation up front, while a run reaches here
 * once per block, model and tool it actually touches, and a deployed workflow
 * with no acting user has no group for the funnel to consult at all.
 */
/** permission-group-enforced: mcp_tools.use — gates tool invocation during a run, not an operation */
/** permission-group-enforced: custom_tools.use — gates tool invocation during a run, not an operation */
/** permission-group-enforced: skills.use — gates skill loading during a run, not an operation */
export async function assertPermissionsAllowed(req: PermissionAssertion): Promise<void> {
  const { workspaceId, model, blockType, toolId, toolKind, ctx } = req
  const userId = governedSubjectUserId(req.userId, ctx)

  const blockTypeExempt = blockType ? isBlockTypeAccessControlExempt(blockType) : false

  if (blockTypeExempt && !model && !toolKind && !toolId) {
    return
  }

  const config =
    userId && workspaceId
      ? await getPermissionConfig(userId, workspaceId, ctx)
      : mergeEnvAllowlist(null)

  const subject = { userId, workspaceId }

  if (model && config) {
    assertModelAllowed(config, model, subject)
  }

  if (blockType && !blockTypeExempt && config) {
    assertBlockTypeAllowed(config, blockType, subject)
  }

  if (toolId && !createToolAccessGate(config?.deniedTools)(toolId)) {
    logger.warn('Tool blocked by permission group', { userId, workspaceId, toolId })
    throw new ToolNotAllowedError(toolId)
  }

  if (toolKind && config) {
    const gate = TOOL_KIND_GATES[toolKind]
    if (gate.rule.deniedBy(config)) {
      logger.warn(gate.blocked, { userId, workspaceId })
      throw new gate.error()
    }
  }
}
