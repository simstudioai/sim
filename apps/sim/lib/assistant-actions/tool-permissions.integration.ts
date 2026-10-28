/**
 * Real authorization and persistence boundary: account/tenant isolation, session-only grants,
 * lost updates, absent defaults, revocation, and unsupported operation escalation.
 */
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
  user,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  claimOrganizationAssistantAction,
  prepareOrganizationAssistantAction,
} from '@/lib/assistant-actions/application/admission'
import {
  decideOrganizationAssistantAction,
  listOrganizationAssistantActions,
} from '@/lib/assistant-actions/application/review'
import {
  readOrganizationToolPermissions,
  updateOrganizationToolPermissions,
} from '@/lib/assistant-actions/application/tool-permissions'
import {
  requireAssistantActionExecution,
  withAssistantActionExecution,
} from '@/lib/assistant-actions/execution-scope'
import {
  loadAssistantToolPermissions,
  resolveAssistantToolPolicy,
} from '@/lib/assistant-actions/tool-permissions'
import * as providerTransport from '@/lib/core/security/input-validation.server'
import { credentialGroupScopePolicyVersion } from '@/lib/credential-groups/provider-adapter'
import { getCredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-registry'
import { encryptManagedOAuthTokenSet } from '@/lib/credentials/managed-oauth'
import {
  claimToolExecution,
  recordToolPermissionDecision,
  upsertAsyncToolCall,
} from '@/lib/mothership/async-runs/repository'
import { createStreamingContext } from '@/lib/mothership/request/context/request-context'
import { executeToolAndReport } from '@/lib/mothership/request/tools/executor'
import type { ToolCallState } from '@/lib/mothership/request/types'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { executeTool } from '@/tools'
import { getToolMetadata } from '@/tools/metadata'

vi.hoisted(() => {
  Object.assign(process.env, {
    MSHIP_SEARCH_INTEGRATION_TOOLS: 'true',
    JIRA_CLIENT_ID: 'assistant-fixture-client',
    JIRA_CLIENT_SECRET: 'assistant-fixture-client-secret',
    GOOGLE_CLIENT_ID: 'assistant-google-fixture-client',
    GOOGLE_CLIENT_SECRET: 'assistant-google-fixture-secret',
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
const groupId = generateId()
const enrollmentId = generateId()
const otherEnrollmentId = generateId()
const chatId = generateId()
const runId = generateId()
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
  listOrganizationAssistantActions.execute({ principal, input: { organizationId, chatId, runId } })
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
    options: ['gmail', 'gmail-second', 'jira', 'google-docs'].map((id) => ({
      id,
      provider: id === 'jira' ? 'jira' : id === 'google-docs' ? 'google-docs' : 'gmail',
      label: 'Gmail',
      authorizationAppId:
        id === 'jira'
          ? jiraPolicy.authorizationAppId
          : id === 'google-docs'
            ? docsPolicy.authorizationAppId
            : 'fixture',
      requiredScopes:
        id === 'jira'
          ? jiraPolicy.requiredScopes
          : id === 'google-docs'
            ? docsPolicy.requiredScopes
            : [],
      scopeVersion:
        id === 'jira'
          ? jiraPolicy.scopeVersion
          : id === 'google-docs'
            ? docsPolicy.scopeVersion
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
  })
  await db.insert(copilotRuns).values({
    id: runId,
    chatId,
    userId: ownerId,
    organizationId,
    executionId: generateId(),
    streamId: generateId(),
    toolExecutionVersion: 3,
  })
})

beforeEach(async () => {
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

describe('organization Assistant tool permissions', () => {
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

function deliver(call: Awaited<ReturnType<typeof prepare>>) {
  const toolCall: ToolCallState = {
    id: call.toolCallId,
    name: call.toolId,
    params: call.args,
    status: 'pending',
  }
  return executeToolAndReport(
    call.toolCallId,
    createStreamingContext({ runId, chatId, toolCalls: new Map([[call.toolCallId, toolCall]]) }),
    {
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
  )
}

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
      await execute()
      expect(requests).toHaveLength(requestCount)
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
  it.each(['missing', 'changed', 'consumed'] as const)(
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
        organizationId,
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
        if (attempt === 'missing') {
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
  it.each(['current', 'legacy'] as const)(
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
        expect(await deliver(call)).toMatchObject({ status: 'success' })
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
