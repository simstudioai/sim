import { db } from '@sim/db'
import {
  type CredentialGroupOptionConfig,
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  mcpServers,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import {
  credentialGroupWorkflowAccessPolicyCodec,
  requireDefaultCredentialGroupWorkflowAccessPolicy,
} from '@/lib/credential-groups/application/workflow-access-policy'
import { getManagedMcpConnector } from '@/lib/credential-groups/managed-mcp-connectors'
import { retireManagedMcpServersForGroup } from '@/lib/credential-groups/managed-mcp-service'
import { credentialGroupScopePolicyVersion } from '@/lib/credential-groups/provider-adapter'
import { decryptCredentialGroupProviderConfiguration } from '@/lib/credential-groups/provider-configuration'
import { getCredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-registry'
import { isCredentialGroupProvider } from '@/lib/credential-groups/providers'
import { SLACK_MANAGED_USER_SCOPES } from '@/lib/credential-groups/slack-managed-user-scopes'
import type {
  CreateCredentialGroupInput,
  CredentialGroupMcpServer,
  CredentialGroupOptionInput,
  CredentialGroupRecord,
  UpdateCredentialGroupInput,
} from '@/lib/credential-groups/types'
import type { DbOrTx } from '@/lib/db/types'
import {
  deleteResourcePolicyForResource,
  requireResourcePolicy,
} from '@/lib/resource-policies/repository'

interface CredentialGroupMutationResult {
  credentialGroup: CredentialGroupRecord
  retiredMcpConnectionIds: string[]
}

interface DeleteCredentialGroupResult {
  deleted: boolean
  retiredMcpConnectionIds: string[]
  retiredMcpServerIds: string[]
}

async function listLinkedMcpServers(
  credentialGroupId: string,
  executor: DbOrTx = db
): Promise<CredentialGroupMcpServer[]> {
  const rows = await executor
    .select({
      id: mcpServers.id,
      name: mcpServers.name,
      description: mcpServers.description,
      authType: mcpServers.authType,
      enabled: mcpServers.enabled,
      managedConnectorId: mcpServers.managedConnectorId,
    })
    .from(mcpServers)
    .where(and(eq(mcpServers.credentialGroupId, credentialGroupId), isNull(mcpServers.deletedAt)))
    .orderBy(asc(mcpServers.name), asc(mcpServers.id))
  return rows.map((row) => {
    if (!row.managedConnectorId) {
      throw new Error(`Credential Group MCP server ${row.id} has no managed connector ID`)
    }
    return {
      ...row,
      managedConnectorId: getManagedMcpConnector(row.managedConnectorId).id,
    }
  })
}

function scopesEqual(left: string[], right: string[]): boolean {
  const normalizedLeft = [...new Set(left)].sort()
  const normalizedRight = [...new Set(right)].sort()
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((scope, index) => scope === normalizedRight[index])
  )
}

async function buildOption(
  workspaceId: string,
  option: CredentialGroupOptionInput,
  credentialGroupId?: string,
  executor: DbOrTx = db
): Promise<CredentialGroupOptionConfig> {
  const providerConfig = await getCredentialGroupProviderAdapter(option.provider).getPolicy(
    option,
    { workspaceId, credentialGroupId, executor }
  )
  return {
    id: generateId(),
    provider: option.provider,
    label: option.label,
    ...(option.provider === 'slack' ? { slackBotCredentialId: option.slackBotCredentialId } : {}),
    authorizationAppId: providerConfig.authorizationAppId,
    requiredScopes: providerConfig.requiredScopes,
    scopeVersion: providerConfig.scopeVersion,
    required: option.required,
    status: 'active',
  }
}

async function updateOptions(
  workspaceId: string,
  credentialGroupId: string,
  inputs: NonNullable<UpdateCredentialGroupInput['options']>,
  existingOptions: CredentialGroupOptionConfig[],
  executor: DbOrTx
): Promise<CredentialGroupOptionConfig[]> {
  const existingById = new Map(existingOptions.map((option) => [option.id, option]))
  return Promise.all(
    inputs.map(async (input) => {
      if (!input.id) return buildOption(workspaceId, input, credentialGroupId, executor)
      const existing = existingById.get(input.id)
      if (!existing) throw new Error(`Credential group option ${input.id} does not exist`)
      if (input.provider !== existing.provider) {
        throw new Error('A credential option provider cannot be changed; add a new option instead')
      }

      const providerConfig = await getCredentialGroupProviderAdapter(input.provider).getPolicy(
        input,
        { workspaceId, credentialGroupId, executor }
      )
      return {
        id: existing.id,
        provider: existing.provider,
        label: input.label,
        ...(input.provider === 'slack' ? { slackBotCredentialId: input.slackBotCredentialId } : {}),
        authorizationAppId: providerConfig.authorizationAppId,
        requiredScopes: providerConfig.requiredScopes,
        scopeVersion: providerConfig.scopeVersion,
        required: input.required,
        status: existing.status,
      }
    })
  )
}

async function toCredentialGroup(
  row: typeof credentialGroup.$inferSelect,
  linkedMcpServers: CredentialGroupMcpServer[]
): Promise<CredentialGroupRecord> {
  const providerConfiguration = await decryptCredentialGroupProviderConfiguration(
    row.encryptedProviderConfiguration
  )
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    options: row.options.map((option) => {
      if (!isCredentialGroupProvider(option.provider)) {
        throw new Error(`Unsupported Credential Group provider: ${option.provider}`)
      }
      const common = {
        id: option.id,
        label: option.label,
        required: option.required,
        status: option.status,
      }
      if (option.provider !== 'slack') {
        return { ...common, provider: option.provider, configurationStatus: 'ready' as const }
      }
      if (!option.slackBotCredentialId) {
        throw new Error(`Slack credential option ${option.id} has no custom bot`)
      }
      return {
        ...common,
        provider: 'slack' as const,
        slackBotCredentialId: option.slackBotCredentialId,
        configurationStatus:
          !providerConfiguration.slack ||
          providerConfiguration.slack.slackBotCredentialId !== option.slackBotCredentialId
            ? ('not_configured' as const)
            : option.scopeVersion !==
                  credentialGroupScopePolicyVersion([...SLACK_MANAGED_USER_SCOPES]) ||
                !SLACK_MANAGED_USER_SCOPES.every((scope) =>
                  providerConfiguration.slack?.scopes.includes(scope)
                )
              ? ('needs_update' as const)
              : ('ready' as const),
      }
    }),
    mcpServers: linkedMcpServers,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listCredentialGroups(workspaceId: string): Promise<CredentialGroupRecord[]> {
  const [rows, serverRows] = await Promise.all([
    db
      .select()
      .from(credentialGroup)
      .where(eq(credentialGroup.workspaceId, workspaceId))
      .orderBy(desc(credentialGroup.createdAt)),
    db
      .select({
        id: mcpServers.id,
        name: mcpServers.name,
        description: mcpServers.description,
        authType: mcpServers.authType,
        enabled: mcpServers.enabled,
        credentialGroupId: mcpServers.credentialGroupId,
        managedConnectorId: mcpServers.managedConnectorId,
      })
      .from(mcpServers)
      .where(and(eq(mcpServers.workspaceId, workspaceId), isNull(mcpServers.deletedAt)))
      .orderBy(asc(mcpServers.name), asc(mcpServers.id)),
  ])
  const serversByGroupId = new Map<string, CredentialGroupMcpServer[]>()
  for (const server of serverRows) {
    if (!server.credentialGroupId) continue
    const summary = {
      id: server.id,
      name: server.name,
      description: server.description,
      authType: server.authType,
      enabled: server.enabled,
      managedConnectorId: getManagedMcpConnector(server.managedConnectorId ?? '').id,
    }
    const current = serversByGroupId.get(server.credentialGroupId)
    if (current) current.push(summary)
    else serversByGroupId.set(server.credentialGroupId, [summary])
  }
  return Promise.all(rows.map((row) => toCredentialGroup(row, serversByGroupId.get(row.id) ?? [])))
}

export async function getCredentialGroup(
  workspaceId: string,
  groupId: string
): Promise<CredentialGroupRecord | null> {
  const [row] = await db
    .select()
    .from(credentialGroup)
    .where(and(eq(credentialGroup.id, groupId), eq(credentialGroup.workspaceId, workspaceId)))
    .limit(1)
  return row ? toCredentialGroup(row, await listLinkedMcpServers(row.id)) : null
}

export async function createCredentialGroup(
  workspaceId: string,
  userId: string,
  body: CreateCredentialGroupInput
): Promise<CredentialGroupRecord> {
  const now = new Date()
  const options = await Promise.all(body.options.map((option) => buildOption(workspaceId, option)))
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(credentialGroup)
      .values({
        id: generateId(),
        workspaceId,
        publicId: generateId(),
        name: body.name,
        description: body.description || null,
        options,
        status: 'active',
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    if (!created) throw new Error('Credential group insert returned no row')
    const policy = await requireResourcePolicy(
      {
        workspaceId,
        resourceType: 'credential_group',
        resourceId: created.id,
        codec: credentialGroupWorkflowAccessPolicyCodec,
      },
      tx
    )
    requireDefaultCredentialGroupWorkflowAccessPolicy({
      revision: policy.revision,
      document: policy.document,
      credentialGroupId: created.id,
    })
    return toCredentialGroup(created, await listLinkedMcpServers(created.id, tx))
  })
}

export async function deleteCredentialGroup(
  workspaceId: string,
  groupId: string
): Promise<DeleteCredentialGroupResult> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: credentialGroup.id })
      .from(credentialGroup)
      .where(and(eq(credentialGroup.id, groupId), eq(credentialGroup.workspaceId, workspaceId)))
      .limit(1)
      .for('update')
    if (!existing) {
      return { deleted: false, retiredMcpConnectionIds: [], retiredMcpServerIds: [] }
    }

    const retiredMcp = await retireManagedMcpServersForGroup(workspaceId, groupId, tx)

    await deleteResourcePolicyForResource(
      { workspaceId, resourceType: 'credential_group', resourceId: groupId },
      tx
    )
    const deleted = await tx
      .delete(credentialGroup)
      .where(and(eq(credentialGroup.id, groupId), eq(credentialGroup.workspaceId, workspaceId)))
      .returning({ id: credentialGroup.id })
    if (deleted.length !== 1) throw new Error('Locked Credential Group delete returned no row')
    return {
      deleted: true,
      retiredMcpConnectionIds: retiredMcp.connectionIds,
      retiredMcpServerIds: retiredMcp.serverIds,
    }
  })
}

export async function updateCredentialGroup(
  workspaceId: string,
  groupId: string,
  body: UpdateCredentialGroupInput
): Promise<CredentialGroupMutationResult | null> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(credentialGroup)
      .where(and(eq(credentialGroup.id, groupId), eq(credentialGroup.workspaceId, workspaceId)))
      .limit(1)
      .for('update')
    if (!existing) return null

    const nextOptions =
      body.options !== undefined
        ? await updateOptions(workspaceId, groupId, body.options, existing.options, tx)
        : existing.options
    const keepsSlack = nextOptions.some((option) => option.provider === 'slack')
    const encryptedProviderConfiguration = keepsSlack
      ? existing.encryptedProviderConfiguration
      : null
    const nextOptionById = new Map(nextOptions.map((option) => [option.id, option]))
    const invalidatedOptionIds = existing.options
      .filter((option) => {
        const next = nextOptionById.get(option.id)
        return (
          !next ||
          next.authorizationAppId !== option.authorizationAppId ||
          next.scopeVersion !== option.scopeVersion ||
          !scopesEqual(next.requiredScopes, option.requiredScopes) ||
          body.status === 'disabled'
        )
      })
      .map((option) => option.id)

    const [updated] = await tx
      .update(credentialGroup)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description || null } : {}),
        ...(body.options !== undefined ? { options: nextOptions } : {}),
        ...(body.options !== undefined ? { encryptedProviderConfiguration } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(credentialGroup.id, groupId), eq(credentialGroup.workspaceId, workspaceId)))
      .returning()

    if (!updated) throw new Error('Credential group update returned no row')
    if (invalidatedOptionIds.length > 0) {
      const enrollmentIds = tx
        .select({ id: credentialGroupEnrollment.id })
        .from(credentialGroupEnrollment)
        .where(eq(credentialGroupEnrollment.credentialGroupId, groupId))
      await tx
        .update(credential)
        .set({ managedOauthStatus: 'needs_reauth', updatedAt: new Date() })
        .where(
          and(
            eq(credential.type, 'managed_oauth'),
            inArray(credential.credentialGroupEnrollmentId, enrollmentIds),
            inArray(credential.credentialGroupOptionId, invalidatedOptionIds)
          )
        )
    }
    return {
      credentialGroup: await toCredentialGroup(updated, await listLinkedMcpServers(updated.id, tx)),
      retiredMcpConnectionIds: [],
    }
  })
}
