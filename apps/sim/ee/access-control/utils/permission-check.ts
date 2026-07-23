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
import { isBlockTypeAccessControlExempt } from '@/lib/permission-groups/block-access'
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

export class PublicFileSharingNotAllowedError extends Error {
  constructor() {
    super('Public file sharing is not allowed based on your permission group settings')
    this.name = 'PublicFileSharingNotAllowedError'
  }
}

export class ChatDeployAuthNotAllowedError extends Error {
  constructor() {
    super('This chat authentication mode is not allowed based on your permission group settings')
    this.name = 'ChatDeployAuthNotAllowedError'
  }
}

/**
 * Merges the env allowlist into a permission config.
 * If `config` is null and no env allowlist is set, returns null.
 * If `config` is null but env allowlist is set, returns a default config with only allowedIntegrations set.
 * If both are set, intersects the two allowlists.
 */
function mergeEnvAllowlist(config: PermissionGroupConfig | null): PermissionGroupConfig | null {
  const envAllowlist = getAllowedIntegrationsFromEnv()

  if (envAllowlist === null) {
    return config
  }

  if (config === null) {
    return { ...DEFAULT_PERMISSION_GROUP_CONFIG, allowedIntegrations: envAllowlist }
  }

  const merged =
    config.allowedIntegrations === null
      ? envAllowlist
      : config.allowedIntegrations
          .map((i) => i.toLowerCase())
          .filter((i) => envAllowlist.includes(i))

  return { ...config, allowedIntegrations: merged }
}

/**
 * The permission group that governs a user in a given context, with its parsed
 * config. Shared by the executor path and the `/api/permission-groups/user`
 * route so resolution never drifts between the two.
 */
export interface ResolvedPermissionGroup {
  permissionGroupId: string
  groupName: string
  config: PermissionGroupConfig
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

  const winner = rows.find((row) => row.isMember) ?? rows.find((row) => !row.hasMembers)

  if (winner) {
    return {
      permissionGroupId: winner.id,
      groupName: winner.name,
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
export async function getUserPermissionConfig(
  userId: string,
  workspaceId: string
): Promise<PermissionGroupConfig | null> {
  if (!isHosted && !isAccessControlEnabled) {
    return mergeEnvAllowlist(null)
  }

  const ws = await getWorkspaceWithOwner(workspaceId, { includeArchived: true })
  if (!ws?.organizationId) {
    return mergeEnvAllowlist(null)
  }

  const isEnterprise = await isOrganizationOnEnterprisePlan(ws.organizationId)
  if (!isEnterprise) {
    return mergeEnvAllowlist(null)
  }

  const resolved = await resolveWorkspaceGroup(userId, ws.organizationId, workspaceId)
  return mergeEnvAllowlist(resolved?.config ?? null)
}

/**
 * Throws {@link PublicFileSharingNotAllowedError} if the user's effective permission
 * group for the workspace disables public file sharing, or — when `authType` is
 * given — if that auth mode isn't in the group's `allowedFileShareAuthTypes`
 * allow-list (`null` allows all). No-op when access control doesn't apply
 * (non-enterprise / disabled), so non-governed orgs are unaffected.
 */
export async function validatePublicFileSharing(
  userId: string,
  workspaceId: string,
  authType?: ShareAuthType
): Promise<void> {
  const config = await getUserPermissionConfig(userId, workspaceId)
  if (!config) {
    return
  }
  if (config.disablePublicFileSharing) {
    throw new PublicFileSharingNotAllowedError()
  }
  if (
    authType &&
    config.allowedFileShareAuthTypes !== null &&
    !config.allowedFileShareAuthTypes.includes(authType)
  ) {
    logger.warn('File share auth type blocked by permission group', {
      userId,
      workspaceId,
      authType,
    })
    throw new PublicFileSharingNotAllowedError()
  }
}

/**
 * Throws {@link ChatDeployAuthNotAllowedError} if the user's effective permission
 * group for the workspace doesn't allow the chat deployment's `authType` (i.e. it
 * isn't in the group's `allowedChatDeployAuthTypes` allow-list; `null` allows all).
 * No-op when access control doesn't apply (non-enterprise / disabled), so
 * non-governed orgs are unaffected.
 */
export async function validateChatDeployAuth(
  userId: string,
  workspaceId: string,
  authType: ShareAuthType
): Promise<void> {
  const config = await getUserPermissionConfig(userId, workspaceId)
  if (!config) {
    return
  }
  if (
    config.allowedChatDeployAuthTypes !== null &&
    !config.allowedChatDeployAuthTypes.includes(authType)
  ) {
    logger.warn('Chat deploy auth type blocked by permission group', {
      userId,
      workspaceId,
      authType,
    })
    throw new ChatDeployAuthNotAllowedError()
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

  if (config.allowedModelProviders !== null) {
    const providerId = getProviderFromModel(model)

    if (!config.allowedModelProviders.includes(providerId)) {
      logger.warn('Model provider blocked by permission group', {
        userId,
        workspaceId,
        model,
        providerId,
      })
      throw new ProviderNotAllowedError(providerId, model)
    }
  }

  if (isModelDenied(config, model)) {
    logger.warn('Model blocked by permission group', { userId, workspaceId, model })
    throw new ModelNotAllowedError(model)
  }
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

  if (!config || config.allowedIntegrations === null) {
    return
  }

  if (!config.allowedIntegrations.includes(blockType.toLowerCase())) {
    const envAllowlist = getAllowedIntegrationsFromEnv()
    const blockedByEnv = envAllowlist !== null && !envAllowlist.includes(blockType.toLowerCase())
    logger.warn(
      blockedByEnv
        ? 'Integration blocked by env allowlist'
        : 'Integration blocked by permission group',
      { userId, workspaceId, blockType }
    )
    throw new IntegrationNotAllowedError(
      blockType,
      blockedByEnv ? 'blocked by server ALLOWED_INTEGRATIONS policy' : undefined
    )
  }
}

export async function validateMcpToolsAllowed(
  userId: string | undefined,
  workspaceId: string | undefined,
  ctx?: ExecutionContext
): Promise<void> {
  if (!userId || !workspaceId) {
    return
  }

  const config = await getPermissionConfig(userId, workspaceId, ctx)

  if (!config) {
    return
  }

  if (config.disableMcpTools) {
    logger.warn('MCP tools blocked by permission group', { userId, workspaceId })
    throw new McpToolsNotAllowedError()
  }
}

export async function validateCustomToolsAllowed(
  userId: string | undefined,
  workspaceId: string | undefined,
  ctx?: ExecutionContext
): Promise<void> {
  if (!userId || !workspaceId) {
    return
  }

  const config = await getPermissionConfig(userId, workspaceId, ctx)

  if (!config) {
    return
  }

  if (config.disableCustomTools) {
    logger.warn('Custom tools blocked by permission group', { userId, workspaceId })
    throw new CustomToolsNotAllowedError()
  }
}

export async function validateSkillsAllowed(
  userId: string | undefined,
  workspaceId: string | undefined,
  ctx?: ExecutionContext
): Promise<void> {
  if (!userId || !workspaceId) {
    return
  }

  const config = await getPermissionConfig(userId, workspaceId, ctx)

  if (!config) {
    return
  }

  if (config.disableSkills) {
    logger.warn('Skills blocked by permission group', { userId, workspaceId })
    throw new SkillsNotAllowedError()
  }
}

/**
 * Validates if the user is allowed to send invitations. Pass one of:
 *  - `workspaceId` — workspace-scoped invite: block when the user's governing group (explicit or
 *    org default) for the workspace's organization has `disableInvitations`.
 *  - `organizationId` — organization-level invite (no specific workspace target): block when the
 *    user's group in that organization (explicit or the org default) has `disableInvitations`.
 *  - neither — only the global feature flag is checked.
 */
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
    if (config?.disableInvitations) {
      logger.warn('Invitations blocked by permission group', { userId, workspaceId })
      throw new InvitationsNotAllowedError()
    }
    return
  }

  if (organizationId) {
    const config = await getUserPermissionConfigForOrganization(organizationId)
    if (config?.disableInvitations) {
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

  if (config.disablePublicApi) {
    logger.warn('Public API blocked by permission group', { userId, workspaceId })
    throw new PublicApiNotAllowedError()
  }
}

export type ToolKind = 'mcp' | 'custom' | 'skill'

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
 * (model provider, block type, tool kind) against it, throwing the existing
 * granular error classes on the first mismatch.
 *
 * Prefer this over calling the individual `validate*Allowed` helpers when
 * gating a shared entry point like `executeTool` or an HTTP proxy, so a single
 * callsite covers every future config field.
 */
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

  if (model && config) {
    if (config.allowedModelProviders !== null) {
      const providerId = getProviderFromModel(model)
      if (!config.allowedModelProviders.includes(providerId)) {
        logger.warn('Model provider blocked by permission group', {
          userId,
          workspaceId,
          model,
          providerId,
        })
        throw new ProviderNotAllowedError(providerId, model)
      }
    }

    if (isModelDenied(config, model)) {
      logger.warn('Model blocked by permission group', { userId, workspaceId, model })
      throw new ModelNotAllowedError(model)
    }
  }

  if (blockType && !blockTypeExempt) {
    if (config && config.allowedIntegrations !== null) {
      if (!config.allowedIntegrations.includes(blockType.toLowerCase())) {
        const envAllowlist = getAllowedIntegrationsFromEnv()
        const blockedByEnv =
          envAllowlist !== null && !envAllowlist.includes(blockType.toLowerCase())
        logger.warn(
          blockedByEnv
            ? 'Integration blocked by env allowlist'
            : 'Integration blocked by permission group',
          { userId, workspaceId, blockType }
        )
        throw new IntegrationNotAllowedError(
          blockType,
          blockedByEnv ? 'blocked by server ALLOWED_INTEGRATIONS policy' : undefined
        )
      }
    }
  }

  if (toolId && config?.deniedTools?.includes(toolId)) {
    logger.warn('Tool blocked by permission group', { userId, workspaceId, toolId })
    throw new ToolNotAllowedError(toolId)
  }

  if (toolKind && config) {
    if (toolKind === 'mcp' && config.disableMcpTools) {
      logger.warn('MCP tools blocked by permission group', { userId, workspaceId })
      throw new McpToolsNotAllowedError()
    }
    if (toolKind === 'custom' && config.disableCustomTools) {
      logger.warn('Custom tools blocked by permission group', { userId, workspaceId })
      throw new CustomToolsNotAllowedError()
    }
    if (toolKind === 'skill' && config.disableSkills) {
      logger.warn('Skills blocked by permission group', { userId, workspaceId })
      throw new SkillsNotAllowedError()
    }
  }
}
