import { db } from '@sim/db'
import {
  type CredentialGroupOptionConfig,
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  knowledgeBase,
  knowledgeConnector,
  mcpServers,
  resourcePolicy,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decodeCredentialGroupWorkflowAccessPolicy } from '@/lib/credential-groups/application/workflow-access-policy'
import { getManagedMcpConnector } from '@/lib/credential-groups/managed-mcp-connectors'
import { credentialGroupScopePolicyVersion } from '@/lib/credential-groups/provider-adapter'
import { decryptCredentialGroupProviderConfiguration } from '@/lib/credential-groups/provider-configuration'
import { getCredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-registry'
import { isCredentialGroupProvider } from '@/lib/credential-groups/providers'
import { resolveSlackManagedUserScopes } from '@/lib/credential-groups/slack-managed-user-scopes'
import type {
  CredentialGroupMcpServer,
  CredentialGroupOptionInput,
  CredentialGroupRecord,
  UpdateCredentialGroupInput,
} from '@/lib/credential-groups/types'
import { createWorkspaceAccountsGroup } from '@/lib/credential-groups/workspace-accounts'
import type { DbOrTx } from '@/lib/db/types'

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
        { ...input, requiredScopes: existing.requiredScopes },
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
        requiredScopes: resolveSlackManagedUserScopes(option.requiredScopes),
        configurationStatus:
          !providerConfiguration.slack ||
          providerConfiguration.slack.slackBotCredentialId !== option.slackBotCredentialId
            ? ('not_configured' as const)
            : option.scopeVersion !==
                  credentialGroupScopePolicyVersion(
                    resolveSlackManagedUserScopes(option.requiredScopes)
                  ) ||
                !resolveSlackManagedUserScopes(option.requiredScopes).every((scope) =>
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

export async function getWorkspaceAccountsGroup(
  workspaceId: string
): Promise<CredentialGroupRecord | null> {
  const [row] = await db
    .select()
    .from(credentialGroup)
    .where(eq(credentialGroup.workspaceId, workspaceId))
    .limit(1)
  return row ? toCredentialGroup(row, await listLinkedMcpServers(row.id)) : null
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

/**
 * Settings and Search share the workspace container, provisioned on demand for older workspaces.
 * Provider policy is resolved before the transaction; only database provisioning holds the lock.
 */
export async function ensureWorkspaceAccountsGroup(
  workspaceId: string,
  userId: string,
  option?: CredentialGroupOptionInput
): Promise<CredentialGroupRecord & { created: boolean }> {
  if (option?.provider === 'slack') {
    throw new OrchestrationError('validation', 'Configure Slack sign-in in Connected accounts')
  }
  const preparedOption = option
    ? await buildOption(workspaceId, { ...option, required: false })
    : null
  let wasCreated = false
  const row = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`search-accounts:${workspaceId}`}, 0))`
    )
    const [existing] = await tx
      .select()
      .from(credentialGroup)
      .where(eq(credentialGroup.workspaceId, workspaceId))
      .limit(1)
      .for('update')
    if (existing) {
      if (existing.status !== 'active') {
        throw new OrchestrationError(
          'validation',
          'Connected accounts is disabled. Enable it in Settings before connecting a source.'
        )
      }
      if (!preparedOption) return existing
      const matching = existing.options.filter(
        (candidate) => candidate.provider === preparedOption.provider
      )
      if (matching.length > 1) {
        throw new OrchestrationError(
          'conflict',
          `Connected accounts contains duplicate ${preparedOption.provider} settings`
        )
      }
      if (matching[0]) {
        if (
          matching[0].status !== 'active' ||
          matching[0].authorizationAppId !== preparedOption.authorizationAppId ||
          matching[0].scopeVersion !== preparedOption.scopeVersion ||
          !scopesEqual(matching[0].requiredScopes, preparedOption.requiredScopes)
        ) {
          throw new OrchestrationError(
            'validation',
            `Update ${preparedOption.label} in Connected accounts before connecting this source`
          )
        }
        return existing
      }
      const [policy] = await tx
        .select({ document: resourcePolicy.document })
        .from(resourcePolicy)
        .where(
          and(
            eq(resourcePolicy.resourceType, 'credential_group'),
            eq(resourcePolicy.resourceId, existing.id),
            eq(resourcePolicy.workspaceId, workspaceId)
          )
        )
        .limit(1)
        .for('update')
      if (!policy) throw new Error('Connected accounts has no resource policy')
      const workflowAccess = decodeCredentialGroupWorkflowAccessPolicy(policy.document, existing.id)
      const linkedMcpServers = await listLinkedMcpServers(existing.id, tx)
      if (workflowAccess.length > 0 || linkedMcpServers.length > 0) {
        throw new OrchestrationError(
          'validation',
          `Cannot automatically add ${preparedOption.label}: ${existing.name} has ${workflowAccess.length > 0 ? 'workflow' : 'MCP'} access. Review its grants and add the provider explicitly in Settings.`
        )
      }
      if (
        existing.options.some(
          (candidate) => candidate.label.toLowerCase() === preparedOption.label.toLowerCase()
        )
      ) {
        throw new OrchestrationError(
          'conflict',
          `An account option already uses the name ${preparedOption.label}. Rename it in Settings.`
        )
      }
      const [updated] = await tx
        .update(credentialGroup)
        .set({
          options: [...existing.options, preparedOption],
          updatedAt: new Date(),
        })
        .where(eq(credentialGroup.id, existing.id))
        .returning()
      if (!updated) throw new Error('Search accounts update returned no row')
      return updated
    }
    const created = await createWorkspaceAccountsGroup(
      tx,
      workspaceId,
      userId,
      preparedOption ? [preparedOption] : []
    )
    wasCreated = true
    return created
  })
  return {
    ...(await toCredentialGroup(row, await listLinkedMcpServers(row.id))),
    created: wasCreated,
  }
}

/**
 * Refuses to remove account options while a knowledge
 * connector syncs per member through one of them: the connector would be left
 * bound to nothing, and its members' documents dark, without anyone choosing
 * that.
 *
 * Runs under the caller's `FOR UPDATE` on the group row. Every write that binds
 * a connector row to an option (`lockCredentialGroupOption`) takes that same
 * lock and re-checks the option under it, so a binding is either visible here
 * or refused once this transaction commits; the check reads only the rows.
 */
async function refuseIfServingMemberConnectors(
  executor: DbOrTx,
  workspaceId: string,
  groupId: string,
  optionIds: readonly string[]
): Promise<void> {
  if (optionIds.length === 0) return
  const serving = await executor
    .select({
      knowledgeBaseName: knowledgeBase.name,
      connectorType: knowledgeConnector.connectorType,
    })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
    .where(
      and(
        eq(knowledgeBase.workspaceId, workspaceId),
        eq(knowledgeConnector.accessMode, 'members'),
        eq(knowledgeConnector.credentialGroupId, groupId),
        inArray(knowledgeConnector.credentialGroupOptionId, [...optionIds]),
        isNull(knowledgeConnector.deletedAt)
      )
    )
    .limit(5)
  if (serving.length === 0) return
  const names = serving
    .map((row) => `the ${row.connectorType} connector in "${row.knowledgeBaseName}"`)
    .join(', ')
  throw new OrchestrationError(
    'conflict',
    `These accounts are used by ${names}. Remove ${serving.length === 1 ? 'that source' : 'those sources'} or change their account access before removing these accounts.`
  )
}

export async function updateCredentialGroup(
  workspaceId: string,
  groupId: string,
  body: UpdateCredentialGroupInput
): Promise<CredentialGroupRecord | null> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(credentialGroup)
      .where(and(eq(credentialGroup.id, groupId), eq(credentialGroup.workspaceId, workspaceId)))
      .limit(1)
      .for('update')
    if (!existing) return null

    if (body.options !== undefined) {
      const keptOptionIds = new Set(body.options.map((option) => option.id))
      await refuseIfServingMemberConnectors(
        tx,
        workspaceId,
        groupId,
        existing.options
          .filter((option) => !keptOptionIds.has(option.id))
          .map((option) => option.id)
      )
    }
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
    return toCredentialGroup(updated, await listLinkedMcpServers(updated.id, tx))
  })
}
