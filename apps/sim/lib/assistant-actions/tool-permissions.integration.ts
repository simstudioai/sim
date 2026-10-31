/**
 * Real authorization and persistence boundary: account/tenant isolation, session-only grants,
 * lost updates, absent defaults, revocation, and unsupported operation escalation.
 */
import {
  AppConfigDataClient,
  StartConfigurationSessionCommand,
} from '@aws-sdk/client-appconfigdata'
import type { OrganizationDelegatedPrincipal, SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  assistantToolPermission,
  copilotAsyncToolCalls,
  copilotChats,
  copilotRuns,
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  member,
  organization,
  organizationSearchIntegration,
  permissionGroup,
  resourcePolicy,
  user,
} from '@sim/db/schema'
import { readTestRedisUrl } from '@sim/db/testing/test-infrastructure'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { toArray, toRecord } from '@sim/utils/object'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  claimOrganizationAssistantAction,
  prepareOrganizationAssistantAction,
} from '@/lib/assistant-actions/application/admission'
import { listOrganizationAssistantActionReceipts } from '@/lib/assistant-actions/application/receipts'
import {
  decideOrganizationAssistantAction,
  listOrganizationAssistantActions,
} from '@/lib/assistant-actions/application/review'
import {
  readOrganizationToolPermissions,
  updateOrganizationToolPermissions,
} from '@/lib/assistant-actions/application/tool-permissions'
import { loadAssistantIntegrationTools } from '@/lib/assistant-actions/catalog'
import {
  requireAssistantActionExecution,
  withAssistantActionExecution,
} from '@/lib/assistant-actions/execution-scope'
import {
  loadAssistantToolPermissions,
  resolveAssistantToolPolicy,
} from '@/lib/assistant-actions/tool-permissions'
import { env } from '@/lib/core/config/env'
import * as envFlags from '@/lib/core/config/env-flags'
import { closeRedisConnection } from '@/lib/core/config/redis'
import * as providerTransport from '@/lib/core/security/input-validation.server'
import type { CredentialGroupOAuthContext } from '@/lib/credential-groups/enrollments'
import {
  completeCredentialGroupOAuth,
  startCredentialGroupOAuth,
} from '@/lib/credential-groups/oauth'
import type { CredentialGroupConnectionIntent } from '@/lib/credential-groups/oauth-intent'
import { consumeCredentialGroupOAuthAttempt } from '@/lib/credential-groups/oauth-state'
import { credentialGroupScopePolicyVersion } from '@/lib/credential-groups/provider-adapter'
import { getCredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-registry'
import {
  decryptManagedOAuthTokenSet,
  encryptManagedOAuthTokenSet,
  rejectManagedOAuthToken,
} from '@/lib/credentials/managed-oauth'
import { loadCopilotSearchIntegrations } from '@/lib/mothership/application/load-search-integrations'
import {
  claimAssistantToolExecution,
  claimToolExecution,
  recordToolPermissionDecision,
  upsertAsyncToolCall,
} from '@/lib/mothership/async-runs/repository'
import { buildIntegrationToolSchemas } from '@/lib/mothership/chat/payload'
import { createStreamingContext } from '@/lib/mothership/request/context/request-context'
import { runStreamLoop } from '@/lib/mothership/request/go/stream'
import { createEvent } from '@/lib/mothership/request/session/event'
import { executeToolAndReport } from '@/lib/mothership/request/tools/executor'
import type {
  ExecutionContext,
  OrchestratorOptions,
  StreamEvent,
  ToolCallState,
} from '@/lib/mothership/request/types'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { executeTool } from '@/tools'
import { getToolMetadata } from '@/tools/metadata'

vi.hoisted(() => {
  Object.assign(process.env, {
    JIRA_CLIENT_ID: 'assistant-fixture-client',
    JIRA_CLIENT_SECRET: 'assistant-fixture-client-secret',
    GOOGLE_CLIENT_ID: 'assistant-google-fixture-client',
    GOOGLE_CLIENT_SECRET: 'assistant-google-fixture-secret',
    SALESFORCE_CLIENT_ID: 'assistant-salesforce-fixture-client',
    SALESFORCE_CLIENT_SECRET: 'assistant-salesforce-fixture-secret',
  })
})

const organizationId = generateId()
const otherOrganizationId = generateId()
const ownerId = generateId()
const otherUserId = generateId()
const credentialId = generateId()
const secondCredentialId = generateId()
const otherCredentialId = generateId()
const jiraCredentialId = generateId()
const docsCredentialId = generateId()
const salesforceCredentialId = generateId()
const groupId = generateId()
const enrollmentId = generateId()
const otherEnrollmentId = generateId()
const chatId = generateId()
const runId = generateId()
const streamId = generateId()
const principal: SessionPrincipal = { kind: 'session', userId: ownerId, sessionId: generateId() }
const input = { organizationId, credentialId }
const delegated: OrganizationDelegatedPrincipal = {
  kind: 'organization_delegated',
  serviceId: 'copilot',
  subjectUserId: ownerId,
  organizationId,
  delegationId: generateId(),
  audience: 'sim:assistant-actions',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 600_000),
  resourceScope: { chatId },
}
const prepare = async (
  toolId = 'gmail_list_labels_v2',
  args: Record<string, unknown> = { credential: credentialId }
) => {
  const invocation = {
    organizationId,
    runId,
    toolCallId: generateId(),
    toolId,
    args,
  }
  const prepared = await prepareOrganizationAssistantAction.execute({
    principal: delegated,
    input: invocation,
  })
  await upsertAsyncToolCall({
    ...invocation,
    toolName: invocation.toolId,
    assistantAction: prepared.binding,
    permissionRequested: prepared.policy === 'ask',
    executionRetryable: prepared.binding.effect === 'read',
  })
  return { ...invocation, ownerToken: generateId() }
}
const claim = (call: Awaited<ReturnType<typeof prepare>>) =>
  claimOrganizationAssistantAction.execute({ principal: delegated, input: call })
const review = () =>
  listOrganizationAssistantActions.execute({ principal, input: { organizationId, chatId } })
const decide = (
  toolCallId: string,
  proposalVersion: string,
  decision: 'allow' | 'skip',
  edits?: Record<string, string>
) =>
  decideOrganizationAssistantAction.execute({
    principal,
    input: { organizationId, chatId, runId, toolCallId, proposalVersion, decision, edits },
  })
const read = () => readOrganizationToolPermissions.execute({ principal, input })
const change = (revision: number, policy: 'allow' | 'ask' | 'block') =>
  updateOrganizationToolPermissions.execute({
    principal,
    input: { ...input, revision, change: { kind: 'tool', toolId: 'gmail_list_labels_v2', policy } },
  })

beforeAll(async () => {
  const jiraPolicy = await getCredentialGroupProviderAdapter('jira').getPolicy(undefined, {})
  const docsPolicy = await getCredentialGroupProviderAdapter('google-docs').getPolicy(undefined, {})
  const salesforcePolicy = await getCredentialGroupProviderAdapter('salesforce').getPolicy(
    undefined,
    {}
  )
  await db.insert(user).values(
    [ownerId, otherUserId].map((id) => ({
      id,
      email: `${id}@example.test`,
      name: 'Assistant permission fixture',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db.insert(organization).values(
    [organizationId, otherOrganizationId].map((id) => ({
      id,
      name: 'Assistant permission fixture',
      slug: id,
      createdAt: new Date(),
    }))
  )
  await db.insert(member).values(
    [ownerId, otherUserId].map((userId) => ({
      id: generateId(),
      userId,
      organizationId,
      role: 'member',
    }))
  )
  await db.insert(credentialGroup).values({
    id: groupId,
    organizationId,
    publicId: generateId(),
    name: 'Connected account fixture',
    options: ['gmail', 'gmail-second', 'jira', 'google-docs', 'salesforce'].map((id) => ({
      id,
      provider:
        id === 'jira'
          ? 'jira'
          : id === 'google-docs'
            ? 'google-docs'
            : id === 'salesforce'
              ? 'salesforce'
              : 'gmail',
      label: 'Gmail',
      authorizationAppId:
        id === 'jira'
          ? jiraPolicy.authorizationAppId
          : id === 'google-docs'
            ? docsPolicy.authorizationAppId
            : id === 'salesforce'
              ? salesforcePolicy.authorizationAppId
              : 'fixture',
      requiredScopes:
        id === 'jira'
          ? jiraPolicy.requiredScopes
          : id === 'google-docs'
            ? docsPolicy.requiredScopes
            : id === 'salesforce'
              ? salesforcePolicy.requiredScopes
              : [],
      scopeVersion:
        id === 'jira'
          ? jiraPolicy.scopeVersion
          : id === 'google-docs'
            ? docsPolicy.scopeVersion
            : id === 'salesforce'
              ? salesforcePolicy.scopeVersion
              : 1,
      required: false,
      status: 'active',
    })),
  })
  await db.insert(credentialGroupEnrollment).values(
    [
      { id: enrollmentId, userId: ownerId },
      { id: otherEnrollmentId, userId: otherUserId },
    ].map(({ id, userId }) => ({
      id,
      userId,
      credentialGroupId: groupId,
      email: `${userId}@example.test`,
      status: 'completed' as const,
      invitationTokenHash: id.replaceAll('-', '').repeat(2),
      invitationExpiresAt: new Date(Date.now() + 60_000),
      invitedAt: new Date(),
    }))
  )
  await db.insert(credential).values({
    id: jiraCredentialId,
    createdBy: ownerId,
    credentialGroupEnrollmentId: enrollmentId,
    credentialGroupOptionId: 'jira',
    organizationId,
    type: 'managed_oauth',
    displayName: 'Fixture Jira account',
    providerId: 'jira',
    managedOauthStatus: 'active',
    managedOauthScopeVersion: jiraPolicy.scopeVersion,
    grantedScopes: jiraPolicy.requiredScopes,
    providerSubjectId: jiraCredentialId,
    authorizationAppId: jiraPolicy.authorizationAppId,
    encryptedOauthTokenSet: await encryptManagedOAuthTokenSet({
      accessToken: 'assistant-fixture-token',
    }),
    grantedAt: new Date(),
  })
  await db.insert(credential).values({
    id: docsCredentialId,
    createdBy: ownerId,
    credentialGroupEnrollmentId: enrollmentId,
    credentialGroupOptionId: 'google-docs',
    organizationId,
    type: 'managed_oauth',
    displayName: 'Fixture Docs account',
    providerId: 'google-docs',
    managedOauthStatus: 'active',
    managedOauthScopeVersion: docsPolicy.scopeVersion,
    grantedScopes: docsPolicy.requiredScopes,
    providerSubjectId: docsCredentialId,
    authorizationAppId: docsPolicy.authorizationAppId,
    encryptedOauthTokenSet: await encryptManagedOAuthTokenSet({
      accessToken: 'assistant-fixture-token',
    }),
    grantedAt: new Date(),
  })
  await db.insert(credential).values({
    id: salesforceCredentialId,
    createdBy: ownerId,
    credentialGroupEnrollmentId: enrollmentId,
    credentialGroupOptionId: 'salesforce',
    organizationId,
    type: 'managed_oauth',
    displayName: 'Fixture Salesforce account',
    providerId: 'salesforce',
    managedOauthStatus: 'active',
    managedOauthScopeVersion: salesforcePolicy.scopeVersion,
    grantedScopes: salesforcePolicy.requiredScopes,
    providerSubjectId: salesforceCredentialId,
    authorizationAppId: salesforcePolicy.authorizationAppId,
    encryptedOauthTokenSet: await encryptManagedOAuthTokenSet({
      accessToken: 'assistant-salesforce-token',
      refreshToken: 'assistant-salesforce-refresh',
    }),
    grantedAt: new Date(),
  })
  await db.insert(credential).values(
    [
      {
        id: credentialId,
        createdBy: ownerId,
        credentialGroupEnrollmentId: enrollmentId,
        credentialGroupOptionId: 'gmail',
      },
      {
        id: secondCredentialId,
        createdBy: ownerId,
        credentialGroupEnrollmentId: enrollmentId,
        credentialGroupOptionId: 'gmail-second',
      },
      {
        id: otherCredentialId,
        createdBy: otherUserId,
        credentialGroupEnrollmentId: otherEnrollmentId,
        credentialGroupOptionId: 'gmail',
      },
    ].map((account) => ({
      ...account,
      organizationId,
      type: 'managed_oauth' as const,
      displayName: 'Fixture Gmail account',
      providerId: 'google-email',
      managedOauthStatus: 'active' as const,
      managedOauthScopeVersion: 1,
      grantedScopes: [],
      providerSubjectId: account.id,
      authorizationAppId: 'fixture',
      encryptedOauthTokenSet: 'fixture-not-a-provider-token',
      grantedAt: new Date(),
      providerMetadata: { email: `${account.id}@example.test` },
    }))
  )
  await db.insert(organizationSearchIntegration).values(
    ['jira', 'google_drive'].map((connectorType) => ({
      organizationId,
      connectorType,
      approved: true,
    }))
  )
  await db.insert(copilotChats).values({
    id: chatId,
    userId: ownerId,
    organizationId,
    type: 'mothership',
    config: { conversationMode: 'assistant' },
    conversationId: streamId,
  })
  await db.insert(copilotRuns).values({
    id: runId,
    chatId,
    userId: ownerId,
    organizationId,
    executionId: generateId(),
    streamId,
    toolExecutionVersion: 3,
  })
})

beforeEach(async () => {
  await db.update(copilotChats).set({ conversationId: streamId }).where(eq(copilotChats.id, chatId))
  const jiraPolicy = await getCredentialGroupProviderAdapter('jira').getPolicy(undefined, {})
  await db
    .update(credential)
    .set({
      grantedScopes: jiraPolicy.requiredScopes,
      managedOauthStatus: 'active',
      managedOauthScopeVersion: jiraPolicy.scopeVersion,
      authorizationAppId: jiraPolicy.authorizationAppId,
    })
    .where(eq(credential.id, jiraCredentialId))
  await db.update(organization).set({ metadata: {} }).where(eq(organization.id, organizationId))
  await db
    .update(organizationSearchIntegration)
    .set({ approved: true })
    .where(eq(organizationSearchIntegration.organizationId, organizationId))
  await db
    .delete(assistantToolPermission)
    .where(eq(assistantToolPermission.organizationId, organizationId))
  await db
    .update(credential)
    .set({ managedOauthStatus: 'active' })
    .where(eq(credential.id, credentialId))
  await db
    .insert(member)
    .values({ id: generateId(), userId: ownerId, organizationId, role: 'member' })
    .onConflictDoNothing()
  await db.delete(copilotAsyncToolCalls).where(eq(copilotAsyncToolCalls.runId, runId))
  await db
    .update(copilotRuns)
    .set({ status: 'active', toolAdmissionClosedAt: null })
    .where(eq(copilotRuns.id, runId))
})

afterAll(async () => {
  await db
    .delete(organization)
    .where(inArray(organization.id, [organizationId, otherOrganizationId]))
  await db.delete(user).where(inArray(user.id, [ownerId, otherUserId]))
})

describe('Assistant discovery for legacy account setup', () => {
  it('leaves legacy grants untouched while returning an empty native catalog', async () => {
    expect(
      await db.select().from(resourcePolicy).where(eq(resourcePolicy.resourceId, groupId))
    ).toEqual([])
    expect(
      await buildIntegrationToolSchemas(ownerId, {
        schemaSurface: 'copilot',
        organizationId,
        personalAccountsOnly: true,
      })
    ).toEqual([])
    expect(
      await db.select().from(resourcePolicy).where(eq(resourcePolicy.resourceId, groupId))
    ).toEqual([])
  })
})

describe('Assistant account and tool discovery', () => {
  it('evaluates admin-gated tools using the current transaction', async () => {
    const originalConfig = {
      APPCONFIG_APPLICATION: env.APPCONFIG_APPLICATION,
      APPCONFIG_ENVIRONMENT: env.APPCONFIG_ENVIRONMENT,
      AWS_REGION: env.AWS_REGION,
    }
    Object.assign(env, {
      APPCONFIG_APPLICATION: generateId(),
      APPCONFIG_ENVIRONMENT: 'assistant-integration',
      AWS_REGION: 'us-east-1',
    })
    const appConfigEnabled = vi.spyOn(envFlags, 'isAppConfigEnabled', 'get').mockReturnValue(true)
    const transport = vi
      .spyOn(AppConfigDataClient.prototype, 'send')
      .mockImplementation(async (command) =>
        command instanceof StartConfigurationSessionCommand
          ? { $metadata: {}, InitialConfigurationToken: 'assistant-fixture' }
          : {
              $metadata: {},
              Configuration: new TextEncoder().encode(
                JSON.stringify({ gmail_v2: { adminEnabled: true } })
              ),
              NextPollConfigurationToken: 'assistant-fixture-next',
            }
      )
    try {
      const [viewer] = await db.select({ role: user.role }).from(user).where(eq(user.id, ownerId))
      if (!viewer) throw new Error('Assistant fixture user is missing')
      const scope = { organizationId, userId: ownerId }
      const before = await loadAssistantIntegrationTools(scope)
      expect(before.tools.some(({ toolId }) => toolId === 'gmail_list_labels_v2')).toBe(false)

      await db.transaction(async (tx) => {
        await tx.update(user).set({ role: 'admin' }).where(eq(user.id, ownerId))
        const during = await loadAssistantIntegrationTools(scope, tx)
        expect(during.tools.some(({ toolId }) => toolId === 'gmail_list_labels_v2')).toBe(true)
        await tx.update(user).set({ role: viewer.role }).where(eq(user.id, ownerId))
      })

      const after = await loadAssistantIntegrationTools(scope)
      expect(after.tools.some(({ toolId }) => toolId === 'gmail_list_labels_v2')).toBe(false)
    } finally {
      transport.mockRestore()
      appConfigEnabled.mockRestore()
      Object.assign(env, originalConfig)
    }
  })

  it('keeps reconnectable accounts but withdraws disabled group accounts from the action inventory', async () => {
    const policyId = generateId()
    await db.insert(resourcePolicy).values({
      id: policyId,
      organizationId,
      resourceType: 'credential_group',
      resourceId: groupId,
      document: {
        version: 2,
        resource: { type: 'credential_group', id: groupId },
        statements: [],
      },
    })
    const inventory = async () =>
      toRecord(
        JSON.parse(
          await loadCopilotSearchIntegrations({
            organizationId,
            userId: ownerId,
            chatId,
            messageId: generateId(),
          })
        )
      )
    try {
      expect((await inventory()).actionAccounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ credentialId: jiraCredentialId, status: 'connected' }),
        ])
      )
      await db
        .update(credential)
        .set({ managedOauthStatus: 'needs_reauth' })
        .where(eq(credential.id, jiraCredentialId))
      expect((await inventory()).actionAccounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ credentialId: jiraCredentialId, status: 'reconnect_needed' }),
        ])
      )

      await db
        .update(credentialGroup)
        .set({ status: 'disabled' })
        .where(eq(credentialGroup.id, groupId))
      const disabled = await inventory()
      expect(disabled.actionAccounts).toEqual([])
      expect(toArray(disabled.connections).map(toRecord)).toContainEqual(
        expect.objectContaining({
          providerId: 'jira',
          connectionStatus: 'unavailable',
          action: null,
          accounts: expect.arrayContaining([
            expect.objectContaining({
              credentialId: jiraCredentialId,
              status: 'reconnect_needed',
              action: null,
            }),
          ]),
        })
      )
    } finally {
      await db
        .update(credentialGroup)
        .set({ status: 'active' })
        .where(eq(credentialGroup.id, groupId))
      await db
        .update(credential)
        .set({ managedOauthStatus: 'active' })
        .where(eq(credential.id, jiraCredentialId))
      await db.delete(resourcePolicy).where(eq(resourcePolicy.id, policyId))
    }
  })
})

describe('organization Assistant tool permissions', () => {
  it.each(['list', 'decide', 'prepare', 'claim', 'owner_claim'] as const)(
    'rejects an orphaned earlier turn at the %s boundary',
    async (boundary) => {
      await change(0, 'ask')
      const call = await prepare()
      const proposal = (await review()).actions[0]
      if (!proposal) throw new Error('Pending action not available for review')
      if (boundary === 'claim' || boundary === 'owner_claim')
        await decide(call.toolCallId, proposal.proposalVersion, 'allow')
      const successorId = generateId()
      const successorStream = generateId()
      await db.transaction(async (tx) => {
        await tx
          .update(copilotChats)
          .set({ conversationId: successorStream })
          .where(eq(copilotChats.id, chatId))
        await tx.insert(copilotRuns).values({
          id: successorId,
          chatId,
          userId: ownerId,
          organizationId,
          executionId: generateId(),
          streamId: successorStream,
          status: 'complete',
          toolExecutionVersion: 3,
        })
      })
      try {
        if (boundary === 'list') {
          expect(
            await listOrganizationAssistantActions.execute({
              principal,
              input: { organizationId, chatId },
            })
          ).toEqual({
            runId: null,
            streamId: null,
            actions: [],
            nextCursor: null,
          })
        } else if (boundary === 'decide') {
          await expect(decide(call.toolCallId, proposal.proposalVersion, 'allow')).rejects.toThrow(
            'no longer accepting actions'
          )
        } else if (boundary === 'prepare') {
          await expect(prepare()).rejects.toThrow('no longer accepting actions')
        } else if (boundary === 'claim') {
          await expect(claim(call)).rejects.toThrow('no longer accepting actions')
        } else {
          expect(
            await db.transaction((tx) =>
              claimAssistantToolExecution({ ...call, userId: ownerId }, tx)
            )
          ).toEqual({ outcome: 'closed' })
        }
        const [record] = await db
          .select({ started: copilotAsyncToolCalls.executionStartedAt })
          .from(copilotAsyncToolCalls)
          .where(eq(copilotAsyncToolCalls.toolCallId, call.toolCallId))
        expect(record?.started).toBeNull()
      } finally {
        await db.delete(copilotRuns).where(eq(copilotRuns.id, successorId))
      }
    }
  )

  it('pages eligible proposals past expired rows and keeps canonical turn metadata', async () => {
    await change(0, 'ask')
    const expired = []
    for (let index = 0; index < 33; index++) expired.push(await prepare())
    await db
      .update(copilotAsyncToolCalls)
      .set({ executionDeadlineAt: new Date(Date.now() + 30_000) })
      .where(
        inArray(
          copilotAsyncToolCalls.toolCallId,
          expired.map((call) => call.toolCallId)
        )
      )
    const eligible = await prepare()
    const result = await listOrganizationAssistantActions.execute({
      principal,
      input: { organizationId, chatId },
    })
    expect(result).toMatchObject({ runId, streamId, nextCursor: null })
    expect(result.actions.map((action) => action.toolCallId)).toEqual([eligible.toolCallId])
    const [expiredProposal] = expired
    if (!expiredProposal) throw new Error('Missing expired proposal')
    const [record] = await db
      .select()
      .from(copilotAsyncToolCalls)
      .where(eq(copilotAsyncToolCalls.toolCallId, expiredProposal.toolCallId))
    expect(record?.executionStartedAt).toBeNull()
  })

  it('keeps a revoked account identifiable and cancellable without offering active access', async () => {
    await change(0, 'ask')
    const call = await prepare()
    await db
      .update(credential)
      .set({ managedOauthStatus: 'revoked' })
      .where(eq(credential.id, credentialId))
    const action = (await review()).actions[0]
    expect(action?.account).toMatchObject({ credentialId, active: false })
    if (!action) throw new Error('Pending action not available for cancellation')
    await expect(decide(call.toolCallId, action.proposalVersion, 'allow')).rejects.toThrow(
      'active connected account'
    )
    expect(await decide(call.toolCallId, action.proposalVersion, 'skip')).toMatchObject({
      decision: 'skip',
      applied: true,
    })
  })

  it('reads safe defaults without persisting a grant', async () => {
    const result = await read()
    expect(result).toMatchObject({ revision: 0, readPolicy: 'allow', writePolicy: 'ask' })
    expect(result.tools.find((tool) => tool.toolId === 'gmail_list_labels_v2')?.policy).toBe(
      'allow'
    )
    expect(
      await db
        .select()
        .from(assistantToolPermission)
        .where(eq(assistantToolPermission.credentialId, credentialId))
    ).toEqual([])
  })

  it.each([
    { organizationId: otherOrganizationId, credentialId },
    { organizationId, credentialId: otherCredentialId },
  ])('conceals an account outside the current own organization grant: %j', async (scope) => {
    await expect(
      readOrganizationToolPermissions.execute({ principal, input: scope })
    ).rejects.toThrow()
    await expect(
      updateOrganizationToolPermissions.execute({
        principal,
        input: {
          ...scope,
          revision: 0,
          change: { kind: 'group', effect: 'read', policy: 'allow' },
        },
      })
    ).rejects.toThrow()
    expect(
      await db
        .select()
        .from(assistantToolPermission)
        .where(eq(assistantToolPermission.userId, ownerId))
    ).toEqual([])
  })

  it('does not let Assistant grant itself permission', async () => {
    await expect(
      updateOrganizationToolPermissions.execute({
        principal: {
          kind: 'organization_delegated',
          serviceId: 'copilot',
          subjectUserId: ownerId,
          organizationId,
          delegationId: generateId(),
          audience: 'sim:assistant-actions',
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          resourceScope: { chatId: generateId() },
        },
        input: {
          ...input,
          revision: 0,
          change: { kind: 'group', effect: 'write', policy: 'allow' },
        },
      })
    ).rejects.toThrow()
  })

  it('keeps account overrides isolated and rejects stale saves', async () => {
    await change(0, 'block')
    expect(
      (await read()).tools.find((tool) => tool.toolId === 'gmail_list_labels_v2')?.policy
    ).toBe('block')
    const second = await readOrganizationToolPermissions.execute({
      principal,
      input: { ...input, credentialId: secondCredentialId },
    })
    expect(second.tools.find((tool) => tool.toolId === 'gmail_list_labels_v2')?.policy).toBe(
      'allow'
    )
    await expect(change(0, 'allow')).rejects.toThrow('changed')
    expect(
      (await read()).tools.find((tool) => tool.toolId === 'gmail_list_labels_v2')?.policy
    ).toBe('block')
  })

  it('commits exactly one concurrent save from the same revision', async () => {
    const results = await Promise.allSettled([change(0, 'ask'), change(0, 'block')])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect((await read()).revision).toBe(1)
  })

  it('limits a bulk Allow to the operations and versions the user could review', async () => {
    await updateOrganizationToolPermissions.execute({
      principal,
      input: { ...input, revision: 0, change: { kind: 'group', effect: 'read', policy: 'allow' } },
    })
    const saved = await loadAssistantToolPermissions({ ...input, userId: ownerId })
    const operation = getToolMetadata('gmail_list_labels_v2')?.assistant
    if (!operation) throw new Error('Fixture operation is unavailable')
    expect(resolveAssistantToolPolicy(saved, 'gmail_list_labels_v2', operation)).toBe('allow')
    expect(
      resolveAssistantToolPolicy(saved, 'gmail_list_labels_v2', {
        ...operation,
        version: operation.version + 1,
      })
    ).toBe('ask')
    expect(resolveAssistantToolPolicy(saved, 'future_operation', operation)).toBe('ask')
  })

  it.each(['ask', 'block'] as const)(
    'replaces hidden tool grants when the group changes to %s',
    async (policy) => {
      await change(0, 'allow')
      const policyGroupId = generateId()
      await db.insert(permissionGroup).values({
        id: policyGroupId,
        organizationId,
        name: 'Hidden operation fixture',
        createdBy: ownerId,
        isDefault: true,
        config: { deniedTools: ['gmail_list_labels_v2'] },
      })
      try {
        expect((await read()).tools.some((tool) => tool.toolId === 'gmail_list_labels_v2')).toBe(
          false
        )
        await updateOrganizationToolPermissions.execute({
          principal,
          input: { ...input, revision: 1, change: { kind: 'group', effect: 'read', policy } },
        })
        await db.delete(permissionGroup).where(eq(permissionGroup.id, policyGroupId))
        expect(
          (await read()).tools.find((tool) => tool.toolId === 'gmail_list_labels_v2')?.policy
        ).toBe(policy)
      } finally {
        await db.delete(permissionGroup).where(eq(permissionGroup.id, policyGroupId))
      }
    }
  )

  it('refuses an unreviewed or unrelated operation', async () => {
    for (const toolId of ['gmail_delete_label', 'jira_get_project', 'unregistered_operation']) {
      await expect(
        updateOrganizationToolPermissions.execute({
          principal,
          input: { ...input, revision: 0, change: { kind: 'tool', toolId, policy: 'allow' } },
        })
      ).rejects.toThrow('unavailable')
    }
  })

  it('rechecks membership after a settings view was loaded', async () => {
    await read()
    await db.delete(member).where(eq(member.userId, ownerId))
    await expect(change(0, 'allow')).rejects.toThrow()
  })

  it('lets a disconnected account be restricted without granting new automatic access', async () => {
    await db
      .update(credential)
      .set({ managedOauthStatus: 'revoked' })
      .where(eq(credential.id, credentialId))
    await expect(change(0, 'allow')).rejects.toThrow('Reconnect')
    await change(0, 'block')
    expect(
      (await read()).tools.find((tool) => tool.toolId === 'gmail_list_labels_v2')?.policy
    ).toBe('block')
  })

  it('requires fresh permission at admission and holds a newly restricted read', async () => {
    const call = await prepare()
    await change(0, 'ask')
    expect(await claim(call)).toMatchObject({ outcome: 'awaiting_permission' })
    expect(await recordToolPermissionDecision(call.toolCallId, 'allow')).toBeNull()
    const proposal = (await review()).actions[0]
    if (!proposal) throw new Error('Pending action not available for review')
    await decide(call.toolCallId, proposal.proposalVersion, 'allow')
    expect(await claim(call)).toMatchObject({ outcome: 'claimed' })
  })

  it('does not let the general execution lane bypass Assistant policy', async () => {
    const call = await prepare()
    expect(await claimToolExecution({ ...call, userId: ownerId })).toMatchObject({
      outcome: 'existing',
    })
    expect(await claim(call)).toMatchObject({ outcome: 'claimed' })
  })

  it.each(['block', 'revoked', 'removed', 'closed', 'version'] as const)(
    'refuses admission after %s without starting the action',
    async (restriction) => {
      const call = await prepare()
      if (restriction === 'block') await change(0, 'block')
      if (restriction === 'revoked')
        await db
          .update(credential)
          .set({ managedOauthStatus: 'revoked' })
          .where(eq(credential.id, credentialId))
      if (restriction === 'removed') await db.delete(member).where(eq(member.userId, ownerId))
      if (restriction === 'closed')
        await db
          .update(copilotRuns)
          .set({ toolAdmissionClosedAt: new Date() })
          .where(eq(copilotRuns.id, runId))
      if (restriction === 'version')
        await db
          .update(copilotAsyncToolCalls)
          .set({ assistantAction: { credentialId, operationVersion: 999, effect: 'read' } })
          .where(eq(copilotAsyncToolCalls.toolCallId, call.toolCallId))
      await expect(claim(call)).rejects.toThrow()
      const [row] = await db
        .select({ started: copilotAsyncToolCalls.executionStartedAt })
        .from(copilotAsyncToolCalls)
        .where(eq(copilotAsyncToolCalls.toolCallId, call.toolCallId))
      expect(row?.started).toBeNull()
    }
  )

  it('admits exactly one owner when two controllers race', async () => {
    const call = await prepare()
    const outcomes = await Promise.all([claim(call), claim({ ...call, ownerToken: generateId() })])
    expect(outcomes.filter((result) => result.outcome === 'claimed')).toHaveLength(1)
  })

  it('binds review to the proposal and commits edits with the decision', async () => {
    const call = await prepare('jira_write', {
      credential: jiraCredentialId,
      domain: 'fixture.atlassian.net',
      projectId: 'APP',
      issueType: 'Task',
      summary: 'Original summary',
      description: 'Original description',
    })
    const proposal = (await review()).actions.find(
      (action) => action.toolCallId === call.toolCallId
    )
    if (!proposal) throw new Error('Pending action not available for review')
    await expect(decide(call.toolCallId, '0'.repeat(64), 'allow')).rejects.toThrow('changed')
    await expect(
      decide(call.toolCallId, proposal.proposalVersion, 'allow', { credential: otherCredentialId })
    ).rejects.toThrow('editable')
    await expect(
      decide(call.toolCallId, proposal.proposalVersion, 'allow', { projectId: 'OTHER' })
    ).rejects.toThrow('editable')
    await decide(call.toolCallId, proposal.proposalVersion, 'allow', {
      summary: 'Reviewed summary',
    })
    expect(await claim(call)).toMatchObject({
      outcome: 'claimed',
      invocation: {
        args: {
          summary: 'Reviewed summary',
          description: 'Original description',
          projectId: 'APP',
          credential: jiraCredentialId,
        },
      },
    })
    expect((await review()).actions).toEqual([])
  })

  it('keeps Cancel available after the account is blocked', async () => {
    await change(0, 'ask')
    const call = await prepare()
    const proposal = (await review()).actions[0]
    if (!proposal) throw new Error('Pending action not available for review')
    await change(1, 'block')
    await expect(decide(call.toolCallId, proposal.proposalVersion, 'allow')).rejects.toThrow(
      'blocked'
    )
    expect(await decide(call.toolCallId, proposal.proposalVersion, 'skip')).toMatchObject({
      decision: 'skip',
      applied: true,
    })
  })

  it('returns the winning decision to two tabs racing on one proposal', async () => {
    await change(0, 'ask')
    const call = await prepare()
    const proposal = (await review()).actions[0]
    if (!proposal) throw new Error('Pending action not available for review')
    const results = await Promise.all([
      decide(call.toolCallId, proposal.proposalVersion, 'allow'),
      decide(call.toolCallId, proposal.proposalVersion, 'skip'),
    ])
    expect(results.filter((result) => result.applied)).toHaveLength(1)
    expect(new Set(results.map((result) => result.decision)).size).toBe(1)
  })
})

function assistantExecutionContext(): ExecutionContext {
  return {
    userId: ownerId,
    workflowId: '',
    organizationId,
    chatOrganizationId: organizationId,
    chatId,
    runId,
    requestMode: 'assistant',
    copilotToolExecution: true,
    resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
  }
}

function deliver(call: Awaited<ReturnType<typeof prepare>>, options?: OrchestratorOptions) {
  const toolCall: ToolCallState = {
    id: call.toolCallId,
    name: call.toolId,
    params: call.args,
    status: 'pending',
  }
  return executeToolAndReport(
    call.toolCallId,
    createStreamingContext({ runId, chatId, toolCalls: new Map([[call.toolCallId, toolCall]]) }),
    assistantExecutionContext(),
    options
  )
}

describe('Managed account identity across Assistant approvals', () => {
  const originalRedisUrl = env.REDIS_URL

  beforeAll(() => {
    const redisUrl = readTestRedisUrl()
    if (!redisUrl) throw new Error('Set TEST_REDIS_URL to a disposable local Redis')
    Object.assign(env, { REDIS_URL: redisUrl })
  })

  afterAll(async () => {
    await closeRedisConnection()
    Object.assign(env, { REDIS_URL: originalRedisUrl })
  })

  it.each([
    {
      name: 'reconnect refuses another subject',
      provider: 'jira',
      mode: 'reconnect',
      changedSubject: true,
      storedTenant: null,
      returnedTenant: null,
      accepted: false,
    },
    {
      name: 'reconnect permits an email rename for the same subject',
      provider: 'jira',
      mode: 'reconnect',
      changedSubject: false,
      storedTenant: null,
      returnedTenant: null,
      accepted: true,
    },
    {
      name: 'legacy enrollment refuses another subject before approval',
      provider: 'jira',
      mode: 'legacy',
      changedSubject: true,
      storedTenant: null,
      returnedTenant: null,
      accepted: false,
    },
    {
      name: 'create refuses another subject in a disconnected account slot',
      provider: 'jira',
      mode: 'restore',
      changedSubject: true,
      storedTenant: null,
      returnedTenant: null,
      accepted: false,
    },
    {
      name: 'create restores the same disconnected account',
      provider: 'jira',
      mode: 'restore',
      changedSubject: false,
      storedTenant: null,
      returnedTenant: null,
      accepted: true,
    },
    {
      name: 'another unused option creates a separate account without moving an approval',
      provider: 'jira',
      mode: 'new',
      changedSubject: true,
      storedTenant: null,
      returnedTenant: null,
      accepted: true,
    },
    {
      name: 'reconnect refuses another tenant for the same subject',
      provider: 'salesforce',
      mode: 'reconnect',
      changedSubject: false,
      storedTenant: 'fixture-tenant',
      returnedTenant: 'another-tenant',
      accepted: false,
    },
    {
      name: 'legacy enrollment does not treat a null tenant as a wildcard',
      provider: 'salesforce',
      mode: 'legacy',
      changedSubject: false,
      storedTenant: null,
      returnedTenant: 'another-tenant',
      accepted: false,
    },
    {
      name: 'reconnect refuses removal of the bound tenant',
      provider: 'salesforce',
      mode: 'reconnect',
      changedSubject: false,
      storedTenant: 'fixture-tenant',
      returnedTenant: null,
      accepted: false,
    },
    {
      name: 'reconnect permits an email rename within the same tenant',
      provider: 'salesforce',
      mode: 'reconnect',
      changedSubject: false,
      storedTenant: 'fixture-tenant',
      returnedTenant: 'fixture-tenant',
      accepted: true,
    },
  ] as const)('$name', async (scenario) => {
    const selectedCredentialId =
      scenario.provider === 'jira' ? jiraCredentialId : salesforceCredentialId
    const [originalCredential] = await db
      .select()
      .from(credential)
      .where(eq(credential.id, selectedCredentialId))
    const [originalEnrollment] = await db
      .select()
      .from(credentialGroupEnrollment)
      .where(eq(credentialGroupEnrollment.id, enrollmentId))
    const [group] = await db.select().from(credentialGroup).where(eq(credentialGroup.id, groupId))
    const configuredOption = group?.options.find((option) => option.id === scenario.provider)
    if (!originalCredential || !originalEnrollment || !group || !configuredOption)
      throw new Error('Managed account fixture is incomplete')

    const option =
      scenario.mode === 'new'
        ? { ...configuredOption, id: generateId(), label: 'Second Jira account' }
        : configuredOption
    const options = scenario.mode === 'new' ? [...group.options, option] : group.options
    const policy = await getCredentialGroupProviderAdapter(scenario.provider).getPolicy(
      undefined,
      {}
    )
    const invitationToken = generateId()
    const chosenSubject = scenario.changedSubject
      ? `another-subject-${generateId()}`
      : selectedCredentialId
    const chosenEmail = 'renamed-account@example.test'
    const freshToken = `fresh-account-token-${generateId()}`
    const requests: Array<{ authorization: string | null; body: unknown }> = []
    const originalFetch = globalThis.fetch
    const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      if (
        request.url === 'https://auth.atlassian.com/oauth/token' ||
        request.url === 'https://login.salesforce.com/services/oauth2/token'
      ) {
        return Response.json({
          access_token: freshToken,
          refresh_token: 'fresh-fixture-refresh-token',
          token_type: 'Bearer',
          scope: policy.requiredScopes.join(' '),
          expires_in: 3600,
        })
      }
      if (request.url === 'https://api.atlassian.com/me') {
        return Response.json({
          account_type: 'atlassian',
          account_id: chosenSubject,
          account_status: 'active',
          email: chosenEmail,
        })
      }
      if (request.url === 'https://login.salesforce.com/services/oauth2/userinfo') {
        return Response.json({
          user_id: chosenSubject,
          email: chosenEmail,
          email_verified: true,
          organization_id: scenario.returnedTenant,
        })
      }
      if (request.url === 'https://api.atlassian.com/oauth/token/accessible-resources') {
        return Response.json([
          { id: '11111111-1111-4111-8111-111111111111', url: 'https://fixture.atlassian.net' },
        ])
      }
      if (
        request.url ===
        'https://api.atlassian.com/ex/jira/11111111-1111-4111-8111-111111111111/rest/api/3/issue'
      ) {
        requests.push({
          authorization: request.headers.get('authorization'),
          body: await request.json(),
        })
        return Response.json({ id: '10001', key: 'SIM-1', self: request.url }, { status: 201 })
      }
      const hostname = new URL(request.url).hostname
      if (hostname !== 'localhost' && hostname !== '127.0.0.1')
        throw new Error(`Unexpected external fixture request: ${request.url}`)
      return originalFetch(input, init)
    })

    try {
      await db
        .update(credential)
        .set({
          providerSubjectId: selectedCredentialId,
          providerTenantId: scenario.storedTenant,
          managedOauthStatus: 'active',
          revokedAt: null,
        })
        .where(eq(credential.id, selectedCredentialId))
      await db
        .update(credentialGroupEnrollment)
        .set({ invitationTokenHash: sha256Hex(invitationToken) })
        .where(eq(credentialGroupEnrollment.id, enrollmentId))
      if (scenario.mode === 'new') {
        await db.update(credentialGroup).set({ options }).where(eq(credentialGroup.id, groupId))
      }

      let pending:
        | { call: Awaited<ReturnType<typeof prepare>>; proposalVersion: string }
        | undefined
      if (scenario.provider === 'jira') {
        const call = await prepare('jira_write', {
          credential: jiraCredentialId,
          domain: 'fixture.atlassian.net',
          projectId: 'SIM',
          issueType: 'Task',
          summary: 'Original proposal',
        })
        const proposal = (await review()).actions.find(
          (action) => action.toolCallId === call.toolCallId
        )
        if (!proposal) throw new Error('Expected a pending action review')
        pending = { call, proposalVersion: proposal.proposalVersion }
        if (scenario.mode !== 'legacy') {
          await decide(call.toolCallId, proposal.proposalVersion, 'allow', {
            summary: 'Reviewed summary',
          })
        }
      }

      if (scenario.mode === 'restore') {
        await db
          .update(credential)
          .set({ managedOauthStatus: 'revoked', revokedAt: new Date() })
          .where(eq(credential.id, selectedCredentialId))
      }
      const [beforeOAuth] = await db
        .select()
        .from(credential)
        .where(eq(credential.id, selectedCredentialId))
      if (!beforeOAuth?.encryptedOauthTokenSet)
        throw new Error('Managed credential token envelope disappeared')
      const context: CredentialGroupOAuthContext = {
        organizationId,
        enrollmentId,
        credentialGroupId: groupId,
        credentialGroupName: group.name,
        workspaceName: 'Assistant permission fixture',
        workspaceOwnerId: null,
        credentialOwnerId: ownerId,
        email: originalEnrollment.email,
        enrollmentStatus: originalEnrollment.status,
        option,
        options,
      }
      const connectionIntent: CredentialGroupConnectionIntent | undefined =
        scenario.mode === 'legacy'
          ? undefined
          : scenario.mode === 'restore' || scenario.mode === 'new'
            ? { kind: 'create' }
            : { kind: 'reconnect', credentialId: selectedCredentialId }
      const authorizationUrl = await startCredentialGroupOAuth(context, invitationToken, {
        connectionIntent,
      })
      const state = new URL(authorizationUrl).searchParams.get('state')
      if (!state) throw new Error('Fixture authorization did not return state')
      const attempt = await consumeCredentialGroupOAuthAttempt(state)
      if (!attempt) throw new Error('Fixture authorization state was unavailable')
      expect(await consumeCredentialGroupOAuthAttempt(state)).toBeNull()
      const completion = completeCredentialGroupOAuth(context, attempt, 'fixture-code')

      if (scenario.accepted) {
        const result = await completion
        expect(result).toMatchObject({
          created: scenario.mode === 'new',
          displayName: chosenEmail,
        })
        if (scenario.mode === 'new') expect(result.credentialId).not.toBe(selectedCredentialId)
        else expect(result.credentialId).toBe(selectedCredentialId)
        const [connected] = await db
          .select()
          .from(credential)
          .where(eq(credential.id, result.credentialId))
        expect(connected).toMatchObject({
          credentialGroupEnrollmentId: enrollmentId,
          credentialGroupOptionId: option.id,
          providerSubjectId: chosenSubject,
          providerTenantId: scenario.returnedTenant,
          displayName: chosenEmail,
          managedOauthStatus: 'active',
          revokedAt: null,
        })
        if (!connected?.encryptedOauthTokenSet)
          throw new Error('Connected account has no token envelope')
        expect(await decryptManagedOAuthTokenSet(connected.encryptedOauthTokenSet)).toMatchObject({
          accessToken: freshToken,
        })
      } else {
        await expect(completion).rejects.toMatchObject({ statusCode: 409 })
      }

      if (!scenario.accepted || scenario.mode === 'new') {
        const [unchanged] = await db
          .select()
          .from(credential)
          .where(eq(credential.id, selectedCredentialId))
        expect(unchanged).toEqual(beforeOAuth)
      }

      if (pending) {
        if (scenario.mode === 'restore' && !scenario.accepted) {
          await expect(claim(pending.call)).rejects.toThrow()
          expect(requests).toEqual([])
        } else {
          if (scenario.mode === 'legacy') {
            await decide(pending.call.toolCallId, pending.proposalVersion, 'allow', {
              summary: 'Reviewed summary',
            })
          }
          const delivered = await deliver(pending.call)
          expect(delivered.status, JSON.stringify(delivered)).toBe('success')
          const originalToken = await decryptManagedOAuthTokenSet(
            beforeOAuth.encryptedOauthTokenSet
          )
          expect(requests).toHaveLength(1)
          expect(requests[0]).toMatchObject({
            authorization: `Bearer ${
              scenario.accepted && scenario.mode !== 'new' ? freshToken : originalToken.accessToken
            }`,
            body: {
              fields: {
                project: { key: 'SIM' },
                summary: 'Reviewed summary',
                issuetype: { name: 'Task' },
              },
            },
          })
        }
        const receipts = await listOrganizationAssistantActionReceipts.execute({
          principal,
          input: { organizationId, chatId, toolCallIds: [pending.call.toolCallId] },
        })
        expect(receipts.receipts[0]?.account).toMatchObject({
          credentialId: selectedCredentialId,
          displayName:
            scenario.accepted && scenario.mode !== 'new' ? chosenEmail : beforeOAuth.displayName,
        })
      }
    } finally {
      provider.mockRestore()
      if (scenario.mode === 'new') {
        await db.delete(credential).where(eq(credential.credentialGroupOptionId, option.id))
        await db
          .update(credentialGroup)
          .set({ options: group.options })
          .where(eq(credentialGroup.id, groupId))
      }
      await db
        .update(credential)
        .set(originalCredential)
        .where(eq(credential.id, selectedCredentialId))
      await db
        .update(credentialGroupEnrollment)
        .set(originalEnrollment)
        .where(eq(credentialGroupEnrollment.id, enrollmentId))
    }
  })
})

describe('Assistant action delivery through the durable executor', () => {
  it.each([
    'allow',
    'skip',
    'block',
    'provider_error',
    'assignment_error',
    'assignment_transport_error',
    'legacy_grant',
    'different_app',
  ] as const)('delivers only the approved action, once, when the result is %s', async (outcome) => {
    const requests: Array<{ url: string; body: unknown; authorization: string | null }> = []
    const originalFetch = globalThis.fetch
    const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      if (new URL(request.url).hostname !== 'api.atlassian.com') return originalFetch(input, init)
      if (request.url.endsWith('/oauth/token/accessible-resources'))
        return Response.json([
          { id: '11111111-1111-4111-8111-111111111111', url: 'https://fixture.atlassian.net' },
        ])
      requests.push({
        url: request.url,
        body: await request.json(),
        authorization: request.headers.get('authorization'),
      })
      if (request.url.endsWith('/assignee') && outcome === 'assignment_transport_error')
        throw new TypeError('Fixture connection closed after assignment request')
      if (request.url.endsWith('/assignee') && outcome === 'assignment_error')
        return Response.json({ errorMessages: ['Assignment denied'] }, { status: 403 })
      return outcome === 'provider_error'
        ? Response.json({ errorMessages: ['Fixture unavailable'] }, { status: 503 })
        : Response.json({ id: '10001', key: 'SIM-1', self: request.url }, { status: 201 })
    })
    try {
      if (outcome === 'legacy_grant') {
        const policy = await getCredentialGroupProviderAdapter('jira').getPolicy(undefined, {})
        const scopes = policy.requiredScopes.filter(
          (scope) => scope !== 'write:sprint:jira-software'
        )
        await db
          .update(credential)
          .set({
            grantedScopes: scopes,
            managedOauthScopeVersion: credentialGroupScopePolicyVersion(scopes),
          })
          .where(eq(credential.id, jiraCredentialId))
      }
      const call = await prepare('jira_write', {
        credential: jiraCredentialId,
        domain: 'fixture.atlassian.net',
        projectId: 'SIM',
        issueType: 'Task',
        summary: 'Original proposal',
        assignee: 'fixture-assignee',
      })
      const proposal = (await review()).actions.find(
        (action) => action.toolCallId === call.toolCallId
      )
      if (!proposal) throw new Error('Expected a pending action review')
      await decide(
        call.toolCallId,
        proposal.proposalVersion,
        outcome === 'skip' ? 'skip' : 'allow',
        outcome === 'skip' ? undefined : { summary: 'Reviewed summary' }
      )
      if (outcome === 'block')
        await updateOrganizationToolPermissions.execute({
          principal,
          input: {
            organizationId,
            credentialId: jiraCredentialId,
            revision: 0,
            change: { kind: 'tool', toolId: 'jira_write', policy: 'block' },
          },
        })
      if (outcome === 'different_app')
        await db
          .update(credential)
          .set({ authorizationAppId: 'jira:other-client' })
          .where(eq(credential.id, jiraCredentialId))
      const execute = () => deliver(call)
      const result = await execute()
      expect(result.status, JSON.stringify(result)).toBe(
        outcome === 'allow' || outcome === 'legacy_grant' || outcome.startsWith('assignment_')
          ? 'success'
          : outcome === 'skip'
            ? 'cancelled'
            : 'error'
      )
      const delivered =
        outcome === 'allow' ||
        outcome === 'legacy_grant' ||
        outcome === 'provider_error' ||
        outcome.startsWith('assignment_')
      const requestCount =
        outcome === 'allow' || outcome === 'legacy_grant' || outcome.startsWith('assignment_')
          ? 2
          : delivered
            ? 1
            : 0
      expect(requests).toHaveLength(requestCount)
      if (outcome === 'block') {
        expect(result).toMatchObject({
          message: 'This tool is blocked in your account permissions.',
          data: { notStarted: true },
        })
        expect(result.data).not.toHaveProperty('outcomeUnknown')
        expect(result.data).not.toHaveProperty('doNotRetry')
        const [receipt] = await db
          .select()
          .from(copilotAsyncToolCalls)
          .where(eq(copilotAsyncToolCalls.toolCallId, call.toolCallId))
        expect(receipt?.executionStartedAt).toBeNull()
        expect(await execute()).toEqual(result)
      }
      if (delivered)
        expect(requests[0]).toMatchObject({
          url: 'https://api.atlassian.com/ex/jira/11111111-1111-4111-8111-111111111111/rest/api/3/issue',
          authorization: 'Bearer assistant-fixture-token',
          body: {
            fields: {
              project: { key: 'SIM' },
              summary: 'Reviewed summary',
              issuetype: { name: 'Task' },
            },
          },
        })
      if (outcome.startsWith('assignment_')) {
        expect(JSON.stringify(result)).toContain('SIM-1')
        expect(JSON.stringify(result)).toContain('Do not recreate the issue.')
      }
      if (requestCount === 2)
        expect(requests[1]).toMatchObject({ body: { accountId: 'fixture-assignee' } })
      if (outcome === 'allow') {
        await updateOrganizationToolPermissions.execute({
          principal,
          input: {
            organizationId,
            credentialId: jiraCredentialId,
            revision: 0,
            change: { kind: 'tool', toolId: 'jira_write', policy: 'block' },
          },
        })
        const events: StreamEvent[] = []
        expect(
          await deliver(call, {
            onEvent: (event) => {
              events.push(event)
            },
          })
        ).toMatchObject({ status: 'success' })
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'tool',
              payload: expect.objectContaining({
                phase: 'result',
                status: 'success',
                success: true,
              }),
            }),
          ])
        )
        const resultEvent = events.find(
          (event) =>
            event.type === 'tool' && 'phase' in event.payload && event.payload.phase === 'result'
        )
        expect(resultEvent?.payload).not.toHaveProperty('error')
      }
      await execute()
      expect(requests).toHaveLength(requestCount)
    } finally {
      provider.mockRestore()
    }
  })
})

describe('Assistant streamed refusals', () => {
  it('reports a blocked call once and continues the stream across retransmission', async () => {
    await change(0, 'block')
    const streamId = generateId()
    const toolCallId = generateId()
    const frame = { streamId, chatId, requestId: generateId() }
    const events = [
      createEvent({
        ...frame,
        seq: 1,
        cursor: '1',
        type: 'tool',
        payload: {
          toolCallId,
          toolName: 'gmail_list_labels_v2',
          arguments: { credential: credentialId },
          executor: 'sim',
          mode: 'async',
          phase: 'call',
        },
      }),
      createEvent({
        ...frame,
        seq: 2,
        cursor: '2',
        type: 'text',
        payload: { channel: 'assistant', text: 'The action was refused.', textOffset: 0 },
      }),
      createEvent({
        ...frame,
        seq: 3,
        cursor: '3',
        type: 'complete',
        payload: { status: 'complete', textLength: 23 },
      }),
    ]
    const workerUrl = 'https://assistant-stream.example.test/stream'
    const providerRequests: string[] = []
    const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      if (url !== workerUrl) {
        providerRequests.push(url)
        throw new Error('Unexpected request')
      }
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    })
    try {
      for (let delivery = 0; delivery < 2; delivery++) {
        const context = createStreamingContext({ runId, chatId, requestId: frame.requestId })
        const forwarded: StreamEvent[] = []
        await runStreamLoop(workerUrl, {}, context, assistantExecutionContext(), {
          flushAfterEvent: false,
          onEvent: (event) => {
            forwarded.push(event)
          },
        })
        await Promise.all(context.pendingToolPromises.values())
        expect(context.accumulatedContent).toBe('The action was refused.')
        expect(forwarded).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'tool',
              payload: expect.objectContaining({
                phase: 'result',
                status: 'error',
              }),
            }),
          ])
        )
      }
      const receipts = await db
        .select()
        .from(copilotAsyncToolCalls)
        .where(eq(copilotAsyncToolCalls.runId, runId))
      expect(receipts).toHaveLength(1)
      expect(receipts[0]).toMatchObject({
        status: 'failed',
        executionStartedAt: null,
        error: 'This tool is blocked in your account permissions.',
      })
      expect(providerRequests).toEqual([])
    } finally {
      transport.mockRestore()
    }
  })
})

describe('Assistant argument refusals', () => {
  it.each([
    { args: {}, message: 'Select one of your connected accounts for this integration.' },
    {
      args: { credential: credentialId, accessToken: 'untrusted-token' },
      message: 'Assistant cannot supply authentication or unsupported parameters.',
    },
  ])('persists a never-started refusal for $args', async ({ args, message }) => {
    const call = {
      organizationId,
      runId,
      toolCallId: generateId(),
      toolId: 'gmail_list_labels_v2',
      args,
      ownerToken: generateId(),
    }
    const provider = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected provider request'))
    try {
      const result = await deliver(call)
      expect(result.status).toBe('error')
      expect(result.message).toContain(message)
      expect(result.data).toMatchObject({ notStarted: true })
      expect(result.data).not.toHaveProperty('outcomeUnknown')
      const [receipt] = await db
        .select()
        .from(copilotAsyncToolCalls)
        .where(eq(copilotAsyncToolCalls.toolCallId, call.toolCallId))
      expect(receipt).toMatchObject({ status: 'failed', executionStartedAt: null })
      expect(await deliver(call)).toEqual(result)
      expect(provider).not.toHaveBeenCalled()
    } finally {
      provider.mockRestore()
    }
  })
})

describe('Assistant Google Docs delivery', () => {
  it.each([false, true])(
    'creates the reviewed content in one write (markdown=%s)',
    async (markdown) => {
      const requests: Request[] = []
      const provider = vi
        .spyOn(providerTransport, 'secureFetchWithPinnedIP')
        .mockImplementation(async (url, _ip, options) => {
          const request = new Request(url, {
            method: options.method,
            headers: options.headers,
            body: typeof options.body === 'string' ? options.body : undefined,
          })
          if (!new URL(request.url).hostname.endsWith('googleapis.com'))
            throw new Error('Unexpected provider request')
          requests.push(request.clone())
          const response = Response.json({ id: 'fixture-document', name: 'Reviewed title' })
          return {
            status: 200,
            statusText: 'OK',
            ok: true,
            url: request.url,
            headers: new providerTransport.SecureFetchHeaders({
              'content-type': 'application/json',
            }),
            body: response.body,
            text: () => response.text(),
            json: () => response.json(),
            arrayBuffer: () => response.arrayBuffer(),
          }
        })
      try {
        const call = await prepare('google_docs_create', {
          credential: docsCredentialId,
          title: 'Original title',
          content: 'Original content',
          folderSelector: 'fixture-folder',
          markdown,
        })
        const proposal = (await review()).actions.find(
          (action) => action.toolCallId === call.toolCallId
        )
        if (!proposal) throw new Error('Expected a pending document review')
        await decide(call.toolCallId, proposal.proposalVersion, 'allow', {
          title: 'Reviewed title',
          content: '# Reviewed content\nKeep the complete text.',
        })
        const result = await deliver(call)
        expect(result.status, JSON.stringify(result)).toBe('success')
        expect(requests).toHaveLength(1)
        const request = requests[0]
        expect(request.url).toContain('/upload/drive/v3/files?uploadType=multipart')
        expect(request.headers.get('authorization')).toBe('Bearer assistant-fixture-token')
        const body = await request.text()
        expect(body).toContain('"name":"Reviewed title"')
        expect(body).toContain('"parents":["fixture-folder"]')
        expect(body).toContain(
          markdown ? 'Content-Type: text/markdown' : 'Content-Type: text/plain'
        )
        expect(body).toContain('# Reviewed content\nKeep the complete text.')
        expect(body).not.toContain('Original content')
        await deliver(call)
        expect(requests).toHaveLength(1)
      } finally {
        provider.mockRestore()
      }
    }
  )
})

describe('Assistant writes cannot escape their admitted invocation', () => {
  it.each(['missing', 'workspace', 'unscoped', 'changed', 'consumed'] as const)(
    'refuses %s execution authority before reaching the provider',
    async (attempt) => {
      const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        throw new Error('The provider must not be contacted')
      })
      const args = {
        credential: jiraCredentialId,
        domain: 'fixture.atlassian.net',
        projectId: 'SIM',
        issueType: 'Task',
        summary: 'Admitted summary',
      }
      const toolCallId = generateId()
      const context = {
        userId: ownerId,
        workflowId: '',
        ...(attempt === 'workspace'
          ? { workspaceId: generateId() }
          : attempt === 'unscoped'
            ? {}
            : { organizationId }),
        chatId,
        toolCallId,
        requestMode: 'assistant' as const,
        copilotToolExecution: true,
      }
      const execute = () =>
        executeTool(
          'jira_write',
          attempt === 'changed' ? { ...args, summary: 'Unreviewed summary' } : args,
          { operationContext: context }
        )
      try {
        if (attempt === 'missing' || attempt === 'workspace' || attempt === 'unscoped') {
          expect(await execute()).toMatchObject({
            success: false,
            error: expect.stringContaining('approved, durable'),
          })
        } else {
          await withAssistantActionExecution(
            {
              userId: ownerId,
              organizationId,
              toolCallId,
              toolId: 'jira_write',
              args,
              binding: { credentialId: jiraCredentialId, effect: 'write', operationVersion: 1 },
            },
            async () => {
              if (attempt === 'consumed') {
                // Consume only authority, then test the provider boundary's refusal to consume it twice.
                await requireAssistantActionExecution(context, 'jira_write', args)
              }
              expect(await execute()).toMatchObject({
                success: false,
                error: expect.stringContaining('does not match'),
              })
            }
          )
        }
        expect(provider).not.toHaveBeenCalled()
      } finally {
        provider.mockRestore()
      }
    }
  )
})

describe('Source restrictions follow native Google Docs accounts', () => {
  it.each(['disabled', 'restricted'] as const)(
    'refuses a reviewed write after Google Drive becomes %s',
    async (policy) => {
      const call = await prepare('google_docs_create', {
        credential: docsCredentialId,
        title: 'Scoped document',
        content: 'Private content',
      })
      const proposal = (await review()).actions.find(
        (action) => action.toolCallId === call.toolCallId
      )
      if (!proposal) throw new Error('Expected a pending document review')
      await decide(call.toolCallId, proposal.proposalVersion, 'allow')
      if (policy === 'disabled') {
        await db
          .update(organizationSearchIntegration)
          .set({ approved: false })
          .where(eq(organizationSearchIntegration.organizationId, organizationId))
      } else {
        await db
          .update(organization)
          .set({
            metadata: {
              liveSearchPolicies: {
                google_drive: {
                  ...defaultLiveSearchPolicy('google_drive'),
                  accessMode: 'service_account',
                  mode: 'selected',
                  included: ['allowed-folder'],
                },
              },
            },
          })
          .where(eq(organization.id, organizationId))
      }
      const provider = vi
        .spyOn(providerTransport, 'secureFetchWithPinnedIP')
        .mockImplementation(async () => {
          throw new Error('The provider must not be contacted')
        })
      try {
        const result = await deliver(call)
        expect(result.status).toBe('error')
        expect(result.message).toMatch(
          policy === 'disabled' ? /approve|disabled/i : /restricts content/i
        )
        expect(provider).not.toHaveBeenCalled()
      } finally {
        provider.mockRestore()
      }
    }
  )
})

describe('Assistant Jira sprint delivery', () => {
  it.each(['current', 'legacy', 'malformed_response', 'incomplete_response'] as const)(
    'creates a sprint only with its grant (%s)',
    async (grant) => {
      const requests: Array<{ url: string; body: unknown }> = []
      const originalFetch = globalThis.fetch
      const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const request = new Request(input, init)
        if (new URL(request.url).hostname !== 'api.atlassian.com') return originalFetch(input, init)
        if (request.url.endsWith('/oauth/token/accessible-resources'))
          return Response.json([
            { id: '11111111-1111-4111-8111-111111111111', url: 'https://fixture.atlassian.net' },
          ])
        requests.push({ url: request.url, body: await request.json() })
        if (grant === 'malformed_response') return new Response('Created', { status: 201 })
        if (grant === 'incomplete_response') return Response.json({ id: 37 }, { status: 201 })
        return Response.json(
          {
            id: 37,
            self: `${request.url}/37`,
            state: 'future',
            name: 'Launch sprint',
            originBoardId: 5,
            goal: 'Reviewed goal',
          },
          { status: 201 }
        )
      })
      try {
        const call = await prepare('jira_create_sprint', {
          credential: jiraCredentialId,
          domain: 'fixture.atlassian.net',
          originBoardId: 5,
          name: 'Launch sprint',
          goal: 'Original goal',
        })
        const proposal = (await review()).actions.find(
          (action) => action.toolCallId === call.toolCallId
        )
        if (!proposal) throw new Error('Expected a pending sprint review')
        await decide(call.toolCallId, proposal.proposalVersion, 'allow', { goal: 'Reviewed goal' })
        if (grant === 'legacy') {
          const policy = await getCredentialGroupProviderAdapter('jira').getPolicy(undefined, {})
          const scopes = policy.requiredScopes.filter(
            (scope) => scope !== 'write:sprint:jira-software'
          )
          await db
            .update(credential)
            .set({
              grantedScopes: scopes,
              managedOauthScopeVersion: credentialGroupScopePolicyVersion(scopes),
            })
            .where(eq(credential.id, jiraCredentialId))
          const result = await deliver(call)
          expect(result.status).toBe('error')
          expect(JSON.stringify(result)).toContain('required scopes')
          expect(requests).toHaveLength(0)
          const [account] = await db
            .select({ status: credential.managedOauthStatus })
            .from(credential)
            .where(eq(credential.id, jiraCredentialId))
          expect(account?.status).toBe('active')
          return
        }
        const result = await deliver(call)
        expect(result).toMatchObject({ status: 'success' })
        if (grant.endsWith('_response'))
          expect(JSON.stringify(result)).toContain('Do not recreate the sprint.')
        expect(requests).toEqual([
          {
            url: 'https://api.atlassian.com/ex/jira/11111111-1111-4111-8111-111111111111/rest/agile/1.0/sprint',
            body: { name: 'Launch sprint', originBoardId: 5, goal: 'Reviewed goal' },
          },
        ])
        await deliver(call)
        expect(requests).toHaveLength(1)
      } finally {
        provider.mockRestore()
      }
    }
  )
})

describe('Assistant Salesforce reviewed updates', () => {
  it('preserves a refreshed grant during rejection without resolving its API destination', async () => {
    const [saved] = await db
      .select({
        encryptedOauthTokenSet: credential.encryptedOauthTokenSet,
        accessTokenExpiresAt: credential.accessTokenExpiresAt,
        refreshTokenExpiresAt: credential.refreshTokenExpiresAt,
        lastRefreshedAt: credential.lastRefreshedAt,
        managedOauthStatus: credential.managedOauthStatus,
        updatedAt: credential.updatedAt,
      })
      .from(credential)
      .where(eq(credential.id, salesforceCredentialId))
    if (!saved?.encryptedOauthTokenSet) throw new Error('Expected a saved Salesforce grant')
    const policy = await getCredentialGroupProviderAdapter('salesforce').getPolicy(undefined, {})
    const requests: string[] = []
    const originalFetch = globalThis.fetch
    const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      if (url.hostname !== 'login.salesforce.com') return originalFetch(input, init)
      requests.push(url.pathname)
      if (url.pathname === '/services/oauth2/token') {
        expect(request.method).toBe('POST')
        expect(new URLSearchParams(await request.text()).get('refresh_token')).toBe(
          'assistant-salesforce-refresh'
        )
        return Response.json({
          access_token: 'refreshed-salesforce-token',
          refresh_token: 'rotated-salesforce-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        })
      }
      return new Response(null, { status: 503 })
    })
    try {
      await expect(
        rejectManagedOAuthToken({
          organizationId,
          credentialId: salesforceCredentialId,
          expectedProviderId: 'salesforce',
          requiredScopes: policy.requiredScopes,
          rejectedAccessToken: 'assistant-salesforce-token',
        })
      ).resolves.toBe(false)
      expect(requests).toEqual(['/services/oauth2/token'])
      const [current] = await db
        .select()
        .from(credential)
        .where(eq(credential.id, salesforceCredentialId))
      if (!current?.encryptedOauthTokenSet) throw new Error('Expected the refreshed grant')
      expect(current.managedOauthStatus).toBe('active')
      expect(current.lastRefreshedAt).toBeInstanceOf(Date)
      expect(current.accessTokenExpiresAt?.getTime()).toBeGreaterThan(Date.now())
      expect(await decryptManagedOAuthTokenSet(current.encryptedOauthTokenSet)).toMatchObject({
        accessToken: 'refreshed-salesforce-token',
        refreshToken: 'rotated-salesforce-refresh',
      })
    } finally {
      provider.mockRestore()
      await db.update(credential).set(saved).where(eq(credential.id, salesforceCredentialId))
    }
  })

  it.each(['clear', 'blank_status', 'blank_priority'] as const)(
    'honors reviewed edits with a real-shaped managed grant: %s',
    async (scenario) => {
      const instanceUrl = 'https://assistant-fixture.my.salesforce.com'
      const taskId = '00T000000000001AAA'
      const requests: Array<{ url: string; body: unknown; authorization: string | null }> = []
      const identity = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const request = new Request(input, init)
        expect(request.url).toBe('https://login.salesforce.com/services/oauth2/userinfo')
        expect(request.headers.get('authorization')).toBe('Bearer assistant-salesforce-token')
        return Response.json({ urls: { rest: `${instanceUrl}/services/data/v{version}/` } })
      })
      const dns = vi
        .spyOn(providerTransport, 'validateUrlWithDNS')
        .mockImplementation(async (url) => {
          if (url !== `${instanceUrl}/services/data/v59.0/sobjects/Task/${taskId}`)
            throw new Error('Unexpected fixture destination')
          return {
            isValid: true,
            resolvedIP: '203.0.113.1',
            originalHostname: new URL(instanceUrl).hostname,
          }
        })
      const transport = vi
        .spyOn(providerTransport, 'secureFetchWithPinnedIP')
        .mockImplementation(async (url, _ip, options) => {
          const request = new Request(url, {
            method: options.method,
            headers: options.headers,
            body: typeof options.body === 'string' ? options.body : undefined,
          })
          requests.push({
            url: request.url,
            body: await request.json(),
            authorization: request.headers.get('authorization'),
          })
          const response = new Response(null, { status: 204 })
          return {
            ok: true,
            status: 204,
            statusText: 'No Content',
            headers: new providerTransport.SecureFetchHeaders({}),
            body: response.body,
            text: () => response.text(),
            json: () => response.json(),
            arrayBuffer: () => response.arrayBuffer(),
          }
        })
      try {
        const call = await prepare('salesforce_update_task', {
          credential: salesforceCredentialId,
          taskId,
          subject: 'Original subject',
          description: 'Original description',
          activityDate: '2026-10-30',
        })
        const proposal = (await review()).actions.find(
          (action) => action.toolCallId === call.toolCallId
        )
        if (!proposal) throw new Error('Expected task update review')
        await decide(
          call.toolCallId,
          proposal.proposalVersion,
          'allow',
          scenario === 'clear'
            ? { subject: '', description: '', activityDate: '' }
            : { [scenario === 'blank_status' ? 'status' : 'priority']: '' }
        )
        const result = await deliver(call)
        expect(result.status).toBe(scenario === 'clear' ? 'success' : 'error')
        if (scenario === 'clear')
          expect(requests).toEqual([
            {
              url: `${instanceUrl}/services/data/v59.0/sobjects/Task/${taskId}`,
              body: { Subject: null, Description: null, ActivityDate: null },
              authorization: 'Bearer assistant-salesforce-token',
            },
          ])
        else {
          expect(result.message).toContain('cannot be empty')
          expect(requests).toEqual([])
        }
        await deliver(call)
        expect(requests).toHaveLength(scenario === 'clear' ? 1 : 0)
      } finally {
        identity.mockRestore()
        dns.mockRestore()
        transport.mockRestore()
      }
    }
  )
})
