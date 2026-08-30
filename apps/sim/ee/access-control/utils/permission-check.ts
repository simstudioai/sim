import { db } from '@sim/db'
import { permissionGroup, permissionGroupMember, permissionGroupWorkspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { ShareAuthType } from '@/lib/api/contracts/public-shares'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing'
import {
  getAllowedIntegrationsFromEnv,
  isAccessControlEnabled,
  isHosted,
  isInvitationsDisabled,
  isPublicApiDisabled,
} from '@/lib/core/config/env-flags'
import {
  isBlockTypeAccessControlExempt,
  resolveAccessControlBlockType,
} from '@/lib/permission-groups/block-access'
import {
  CAPABILITY_RULES,
  refuseCapability,
  type StaticCapabilityRule,
} from '@/lib/permission-groups/capabilities'
import { intersectIntegrationAllowlists } from '@/lib/permission-groups/integration-allowlist'
import { createToolAccessGate } from '@/lib/permission-groups/operation-access'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  type PermissionGroupConfig,
  parsePermissionGroupConfig,
} from '@/lib/permission-groups/types'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import type { ExecutionContext } from '@/executor/types'
import { getProviderFromModel } from '@/providers/utils'

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
 * Merges the env allowlist into a permission config.
 *
 * Returns null only when neither layer restricts anything. Otherwise the group's
 * own allowlist is intersected with the env one by
 * {@link intersectIntegrationAllowlists}, which case-folds both sides — callers
 * compare against a lowercased block type, and a stored config reaches here
 * straight off the wire, where the contract permits any casing.
 */
function mergeEnvAllowlist(config: PermissionGroupConfig | null): PermissionGroupConfig | null {
  const envAllowlist = getAllowedIntegrationsFromEnv()
  if (config === null && envAllowlist === null) return null

  const base = config ?? DEFAULT_PERMISSION_GROUP_CONFIG
  return {
    ...base,
    allowedIntegrations: intersectIntegrationAllowlists(base.allowedIntegrations, envAllowlist),
  }
}

/**
 * The permission group that governs a user in a given context, with its parsed
 * config. Shared by the executor path and the `/api/permission-groups/user`
 * route so resolution never drifts between the two.
 */
export interface ResolvedPermissionGroup {
  permissionGroupId: string
  groupName: string
  resolution: 'explicit-member' | 'all-members' | 'default'
  config: PermissionGroupConfig
}

export interface UserAccessControlContext {
  organizationId: string | null
  entitled: boolean
  permissionGroup: {
    id: string
    name: string
    resolution: ResolvedPermissionGroup['resolution']
  } | null
  config: PermissionGroupConfig | null
}

function inactiveUserAccessControlContext(organizationId: string | null): UserAccessControlContext {
  return {
    organizationId,
    entitled: false,
    permissionGroup: null,
    config: mergeEnvAllowlist(null),
  }
}

/** The organization's single default group (`isDefault`), or `null`. */
async function resolveDefaultGroup(
  organizationId: string
): Promise<ResolvedPermissionGroup | null> {
  const [defaultGroup] = await db
    .select({
      id: permissionGroup.id,
      name: permissionGroup.name,
      config: permissionGroup.config,
    })
    .from(permissionGroup)
    .where(
      and(eq(permissionGroup.organizationId, organizationId), eq(permissionGroup.isDefault, true))
    )
    .limit(1)

  if (!defaultGroup) {
    return null
  }

  return {
    permissionGroupId: defaultGroup.id,
    groupName: defaultGroup.name,
    resolution: 'default',
    config: parsePermissionGroupConfig(defaultGroup.config),
  }
}

/**
 * Resolve the group governing `userId` in `workspaceId` (which belongs to
 * `organizationId`). One effective group per workspace, by precedence:
 *   1. a non-default group targeting this workspace that `userId` is an explicit
 *      member of, else
 *   2. a non-default group targeting this workspace that has no explicit members
 *      — governs all members of the workspace, including external members, else
 *   3. the organization's default group (also governs external members), else
 *   4. `null` (unrestricted).
 *
 * Assignment-time conflict checks keep this unambiguous: at most one all-members
 * group per workspace, and a user is an explicit member of at most one group per
 * workspace. If an overlap nonetheless exists, the oldest group wins — rows are
 * ordered by `created_at` (then `id`).
 *
 * Callers gate on enterprise entitlement before invoking this and merge the env
 * allowlist afterwards.
 */
export async function resolveWorkspaceGroup(
  userId: string,
  organizationId: string,
  workspaceId: string
): Promise<ResolvedPermissionGroup | null> {
  const rows = await db
    .select({
      id: permissionGroup.id,
      name: permissionGroup.name,
      config: permissionGroup.config,
      isMember: sql<boolean>`exists (
        select 1 from ${permissionGroupMember}
        where ${permissionGroupMember.permissionGroupId} = ${permissionGroup.id}
          and ${permissionGroupMember.userId} = ${userId}
      )`,
      hasMembers: sql<boolean>`exists (
        select 1 from ${permissionGroupMember}
        where ${permissionGroupMember.permissionGroupId} = ${permissionGroup.id}
      )`,
    })
    .from(permissionGroup)
    .innerJoin(
      permissionGroupWorkspace,
      and(
        eq(permissionGroupWorkspace.permissionGroupId, permissionGroup.id),
        eq(permissionGroupWorkspace.workspaceId, workspaceId)
      )
    )
    .where(
      and(eq(permissionGroup.organizationId, organizationId), eq(permissionGroup.isDefault, false))
    )
    .orderBy(asc(permissionGroup.createdAt), asc(permissionGroup.id))

  const explicitMemberGroup = rows.find((row) => row.isMember)
  const winner = explicitMemberGroup ?? rows.find((row) => !row.hasMembers)

  if (winner) {
    return {
      permissionGroupId: winner.id,
      groupName: winner.name,
      resolution: explicitMemberGroup ? 'explicit-member' : 'all-members',
      config: parsePermissionGroupConfig(winner.config),
    }
  }

  return resolveDefaultGroup(organizationId)
}

/**
 * Resolve the effective permission-group config for a user in the context of a
 * specific workspace. The workspace is mapped to its organization and the
 * governing group is resolved with specific-over-all precedence.
 *
 * Returns `null` (after env merge) when the workspace has no organization, the
 * organization isn't on an enterprise plan, or no group governs the user.
 *
 * The env-level integration allowlist is always merged last so self-hosted
 * deployments can constrain integrations without touching the DB.
 */
async function resolveUserAccessControlContextForOrganization(
  userId: string,
  workspaceId: string,
  organizationId: string | null
): Promise<UserAccessControlContext> {
  if (!organizationId) return inactiveUserAccessControlContext(null)

  const isEnterprise = await isOrganizationOnEnterprisePlan(organizationId)
  if (!isEnterprise) {
    return inactiveUserAccessControlContext(organizationId)
  }

  const resolved = await resolveWorkspaceGroup(userId, organizationId, workspaceId)
  return {
    organizationId,
    entitled: true,
    permissionGroup: resolved
      ? {
          id: resolved.permissionGroupId,
          name: resolved.groupName,
          resolution: resolved.resolution,
        }
      : null,
    config: mergeEnvAllowlist(resolved?.config ?? null),
  }
}

/**
 * Resolves Access Control from an organization ID obtained from an already
 * access-checked workspace. This function does not independently authorize the
 * user for the workspace; callers must establish that boundary first.
 */
export async function resolveVerifiedUserAccessControlContext(
  userId: string,
  workspaceId: string,
  organizationId: string | null
): Promise<UserAccessControlContext> {
  if (!isHosted && !isAccessControlEnabled) {
    return inactiveUserAccessControlContext(null)
  }
  return resolveUserAccessControlContextForOrganization(userId, workspaceId, organizationId)
}

export async function resolveUserAccessControlContext(
  userId: string,
  workspaceId: string
): Promise<UserAccessControlContext> {
  if (!isHosted && !isAccessControlEnabled) {
    return inactiveUserAccessControlContext(null)
  }

  const workspace = await getWorkspaceWithOwner(workspaceId, { includeArchived: true })
  return resolveUserAccessControlContextForOrganization(
    userId,
    workspaceId,
    workspace?.organizationId ?? null
  )
}

export async function getUserPermissionConfig(
  userId: string,
  workspaceId: string
): Promise<PermissionGroupConfig | null> {
  return (await resolveUserAccessControlContext(userId, workspaceId)).config
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
  const config = await getUserPermissionConfig(userId, workspaceId)
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
  const config = await getUserPermissionConfig(userId, workspaceId)
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
 * Org-addressed variant of {@link getUserPermissionConfig}. Use when only the
 * organization is known (e.g. organization-level invitations). Non-default
 * groups target specific workspaces and never gate organization-level actions,
 * so this resolves the organization's default group — which governs everyone not
 * covered by a workspace group.
 */
export async function getUserPermissionConfigForOrganization(
  organizationId: string
): Promise<PermissionGroupConfig | null> {
  if (!isHosted && !isAccessControlEnabled) {
    return mergeEnvAllowlist(null)
  }

  const isEnterprise = await isOrganizationOnEnterprisePlan(organizationId)
  if (!isEnterprise) {
    return mergeEnvAllowlist(null)
  }

  const resolved = await resolveDefaultGroup(organizationId)
  return mergeEnvAllowlist(resolved?.config ?? null)
}

/**
 * Cache-aware wrapper around `getUserPermissionConfig`. When an
 * `ExecutionContext` is provided, the resolved config is memoized on the
 * context so repeated checks during a single workflow run share one DB hit.
 */
async function getPermissionConfig(
  userId: string | undefined,
  workspaceId: string | undefined,
  ctx?: ExecutionContext
): Promise<PermissionGroupConfig | null> {
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
   */
  const allowlistType = resolveAccessControlBlockType(blockType).toLowerCase()

  if (!config.allowedIntegrations.includes(allowlistType)) {
    const envAllowlist = getAllowedIntegrationsFromEnv()
    const blockedByEnv = envAllowlist !== null && !envAllowlist.includes(allowlistType)
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

  assertModelAllowed(config, model, { userId, workspaceId })
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

  assertBlockTypeAllowed(config, blockType, { userId, workspaceId })
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
    const config = await getUserPermissionConfig(userId, workspaceId)
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

  const config = await getUserPermissionConfig(userId, workspaceId)

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
  const { userId, workspaceId, model, blockType, toolId, toolKind, ctx } = req

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
