import { db } from '@sim/db'
import { member, permissionGroup, permissionGroupMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing'
import {
  getAllowedIntegrationsFromEnv,
  isAccessControlEnabled,
  isHosted,
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

export async function getUserPermissionConfig(
  userId: string
): Promise<PermissionGroupConfig | null> {
  if (!isHosted && !isAccessControlEnabled) {
    return mergeEnvAllowlist(null)
  }

  const [membership] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1)

  if (!membership) {
    return mergeEnvAllowlist(null)
  }

  const isEnterprise = await isOrganizationOnEnterprisePlan(membership.organizationId)
  if (!isEnterprise) {
    return mergeEnvAllowlist(null)
  }

  const [groupMembership] = await db
    .select({ config: permissionGroup.config })
    .from(permissionGroupMember)
    .innerJoin(permissionGroup, eq(permissionGroupMember.permissionGroupId, permissionGroup.id))
    .where(
      and(
        eq(permissionGroupMember.userId, userId),
        eq(permissionGroup.organizationId, membership.organizationId)
      )
    )
    .limit(1)

  if (!groupMembership) {
    return mergeEnvAllowlist(null)
  }

  return mergeEnvAllowlist(parsePermissionGroupConfig(groupMembership.config))
}

export async function getPermissionConfig(
  userId: string | undefined,
  ctx?: ExecutionContext
): Promise<PermissionGroupConfig | null> {
  if (!userId) {
    return null
  }

  if (ctx) {
    if (ctx.permissionConfigLoaded) {
      return ctx.permissionConfig ?? null
    }

    const config = await getUserPermissionConfig(userId)
    ctx.permissionConfig = config
    ctx.permissionConfigLoaded = true
    return config
  }

  return getUserPermissionConfig(userId)
}

export async function validateModelProvider(
  userId: string | undefined,
  model: string,
  ctx?: ExecutionContext
): Promise<void> {
  if (!userId) {
    return
  }

  const config = await getPermissionConfig(userId, ctx)

  if (!config || config.allowedModelProviders === null) {
    return
  }

  const providerId = getProviderFromModel(model)

  if (!config.allowedModelProviders.includes(providerId)) {
    logger.warn('Model provider blocked by permission group', { userId, model, providerId })
    throw new ProviderNotAllowedError(providerId, model)
  }
}

export async function validateBlockType(
  userId: string | undefined,
  blockType: string,
  ctx?: ExecutionContext
): Promise<void> {
  if (blockType === 'start_trigger') {
    return
  }

  const config = userId ? await getPermissionConfig(userId, ctx) : mergeEnvAllowlist(null)

  if (!config || config.allowedIntegrations === null) {
    return
  }

  if (!config.allowedIntegrations.includes(blockType.toLowerCase())) {
    const isEnvOnly = !userId
    logger.warn(
      isEnvOnly
        ? 'Integration blocked by env allowlist'
        : 'Integration blocked by permission config',
      { userId, blockType }
    )
    throw new IntegrationNotAllowedError(
      blockType,
      isEnvOnly ? 'blocked by server ALLOWED_INTEGRATIONS policy' : undefined
    )
  }
}

export async function validateMcpToolsAllowed(
  userId: string | undefined,
  ctx?: ExecutionContext
): Promise<void> {
  if (!userId) {
    return
  }

  const config = await getPermissionConfig(userId, ctx)

  if (!config) {
    return
  }

  if (config.disableMcpTools) {
    logger.warn('MCP tools blocked by permission group', { userId })
    throw new McpToolsNotAllowedError()
  }
}

export async function validateCustomToolsAllowed(
  userId: string | undefined,
  ctx?: ExecutionContext
): Promise<void> {
  if (!userId) {
    return
  }

  const config = await getPermissionConfig(userId, ctx)

  if (!config) {
    return
  }

  if (config.disableCustomTools) {
    logger.warn('Custom tools blocked by permission group', { userId })
    throw new CustomToolsNotAllowedError()
  }
}

export async function validateSkillsAllowed(
  userId: string | undefined,
  ctx?: ExecutionContext
): Promise<void> {
  if (!userId) {
    return
  }

  const config = await getPermissionConfig(userId, ctx)

  if (!config) {
    return
  }

  if (config.disableSkills) {
    logger.warn('Skills blocked by permission group', { userId })
    throw new SkillsNotAllowedError()
  }
}

/**
 * Validates if the user is allowed to send invitations.
 * Also checks the global feature flag.
 */
export async function validateInvitationsAllowed(userId: string | undefined): Promise<void> {
  const { isInvitationsDisabled } = await import('@/lib/core/config/feature-flags')
  if (isInvitationsDisabled) {
    logger.warn('Invitations blocked by feature flag')
    throw new InvitationsNotAllowedError()
  }

  if (!userId) {
    return
  }

  const config = await getUserPermissionConfig(userId)

  if (!config) {
    return
  }

  if (config.disableInvitations) {
    logger.warn('Invitations blocked by permission group', { userId })
    throw new InvitationsNotAllowedError()
  }
}
