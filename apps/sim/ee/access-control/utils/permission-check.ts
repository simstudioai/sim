import { db } from '@sim/db'
import { permissionGroup, permissionGroupMember, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, sql } from 'drizzle-orm'
import { isWorkspaceOnEnterprisePlan } from '@/lib/billing'
import {
  getAllowedIntegrationsFromEnv,
  isAccessControlEnabled,
  isHosted,
  isInvitationsDisabled,
  isPublicApiDisabled,
} from '@/lib/core/config/feature-flags'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  type PermissionGroupConfig,
  parsePermissionGroupConfig,
} from '@/lib/permission-groups/types'
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
 * Resolve the effective permission-group config for a user in the context of a
 * specific workspace. Returns `null` when the workspace isn't on an enterprise
 * plan or the user isn't a member of any permission group in that workspace.
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

  const isEnterprise = await isWorkspaceOnEnterprisePlan(workspaceId)
  if (!isEnterprise) {
    return mergeEnvAllowlist(null)
  }

  const [groupMembership] = await db
    .select({ config: permissionGroup.config })
    .from(permissionGroupMember)
    .innerJoin(permissionGroup, eq(permissionGroupMember.permissionGroupId, permissionGroup.id))
    .where(
      and(eq(permissionGroupMember.userId, userId), eq(permissionGroup.workspaceId, workspaceId))
    )
    .orderBy(asc(permissionGroup.createdAt), asc(permissionGroup.id))
    .limit(1)

  if (!groupMembership) {
    return mergeEnvAllowlist(null)
  }

  return mergeEnvAllowlist(parsePermissionGroupConfig(groupMembership.config))
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

  if (!config || config.allowedModelProviders === null) {
    return
  }

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

export async function validateBlockType(
  userId: string | undefined,
  workspaceId: string | undefined,
  blockType: string,
  ctx?: ExecutionContext
): Promise<void> {
  if (blockType === 'start_trigger') {
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
 *  - `workspaceId` — workspace-scoped invite: block when the user's group in that workspace has
 *    `disableInvitations`.
 *  - `organizationId` — organization-level invite (no specific workspace target): block when the
 *    user has `disableInvitations` set on their group in any organization-owned workspace. This
 *    mirrors the pre-refactor behavior where `disableInvitations` was an organization-level
 *    policy.
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
    const [row] = await db
      .select({ id: permissionGroup.id })
      .from(permissionGroupMember)
      .innerJoin(permissionGroup, eq(permissionGroupMember.permissionGroupId, permissionGroup.id))
      .innerJoin(workspace, eq(permissionGroup.workspaceId, workspace.id))
      .where(
        and(
          eq(permissionGroupMember.userId, userId),
          eq(workspace.organizationId, organizationId),
          sql`${permissionGroup.config} @> '{"disableInvitations": true}'::jsonb`
        )
      )
      .limit(1)

    if (row) {
      logger.warn('Invitations blocked by permission group (organization-wide)', {
        userId,
        organizationId,
        permissionGroupId: row.id,
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

export interface PermissionAssertion {
  userId: string | undefined
  workspaceId: string | undefined
  model?: string
  blockType?: string
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
  const { userId, workspaceId, model, blockType, toolKind, ctx } = req

  if (blockType === 'start_trigger') {
    if (!model && !toolKind) {
      return
    }
  }

  const config =
    userId && workspaceId
      ? await getPermissionConfig(userId, workspaceId, ctx)
      : mergeEnvAllowlist(null)

  if (model && config && config.allowedModelProviders !== null) {
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

  if (blockType && blockType !== 'start_trigger') {
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
