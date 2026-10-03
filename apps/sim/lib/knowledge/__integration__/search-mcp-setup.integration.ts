import { db, runOutsideTransactionContext } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  knowledgeBase,
  knowledgeConnector,
  mcpServers,
  member,
  organization,
  organizationSearchIntegration,
  resourcePolicy,
  slackApp,
  slackSearchInstallation,
  user,
} from '@sim/db/schema'
import { readTestRedisUrl } from '@sim/db/testing/test-infrastructure'
import * as dns from '@sim/security/dns'
import { sha256Hex } from '@sim/security/hash'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { listSearchIntegrationsContract } from '@/lib/api/contracts/knowledge/search-integrations'
import { env } from '@/lib/core/config/env'
import { closeRedisConnection } from '@/lib/core/config/redis'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  completeSlackCredentialGroupConfiguration,
  startSlackCredentialGroupConfiguration,
} from '@/lib/credential-groups/application/slack-managed-users'
import { credentialGroupScopePolicyVersion } from '@/lib/credential-groups/provider-adapter'
import {
  decryptCredentialGroupProviderConfiguration,
  emptyCredentialGroupProviderConfiguration,
  encryptCredentialGroupProviderConfiguration,
} from '@/lib/credential-groups/provider-configuration'
import { getCredentialGroup } from '@/lib/credential-groups/service'
import {
  SLACK_MANAGED_USER_SCOPES,
  SLACK_SEARCH_USER_SCOPES,
} from '@/lib/credential-groups/slack-managed-user-scopes'
import { createOrganizationAccountsGroup } from '@/lib/credential-groups/workspace-accounts'
import { deleteConnectionCredential } from '@/lib/credentials/deletion'
import {
  encryptManagedOAuthTokenSet,
  resolveManagedOAuthToken,
} from '@/lib/credentials/managed-oauth'
import { acquireAdvisoryXactLock, tryAcquireAdvisoryXactLock } from '@/lib/db/advisory-locks'
import { deleteKnowledgeConnector } from '@/lib/knowledge/application/connectors'
import {
  approveSearchIntegration,
  listSearchIntegrations,
} from '@/lib/knowledge/application/search-integrations'
import { deleteKnowledgeBase, restoreKnowledgeBase } from '@/lib/knowledge/service'
import {
  GITHUB_INSTALLATION_PROVIDER_ID,
  type GitHubInstallationBinding,
} from '@/lib/oauth/github-installation-types'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'

/**
 * Real authorization, PostgreSQL, Redis and token resolution; DNS and Slack HTTP use fixtures.
 * Run `bun run test:integration lib/knowledge/__integration__/search-mcp-setup.integration.ts`
 * with INTEGRATION_REPORT_PATH for a caller-selected JSON report. Direct Vitest runs require
 * TEST_DATABASE_URL and TEST_REDIS_URL naming disposable local services.
 */
describe('atomic organization live Search MCP setup', () => {
  const redisUrl = readTestRedisUrl()
  let restoreSlackHttp: (() => void) | undefined
  let ids: { organization: string; owner: string; member: string; outsider: string }

  beforeAll(() => {
    if (!redisUrl)
      throw new Error(
        'Set TEST_REDIS_URL to a disposable local Redis or use bun run test:integration'
      )
    vi.spyOn(dns, 'resolveHostAddresses').mockImplementation(async (hostname) => {
      if (
        !['api.fireflies.ai', 'mcp.granola.ai', 'mcp.notion.com', 'mcp.lucid.app'].includes(
          hostname
        )
      )
        throw new Error(`Unexpected DNS lookup in setup fixture: ${hostname}`)
      return { addresses: ['93.184.216.34'], preferred: '93.184.216.34' }
    })
  })

  beforeEach(async () => {
    Object.assign(env, {
      ZOOM_SEARCH: false,
      REDIS_URL: redisUrl,
    })
    ids = {
      organization: generateId(),
      owner: generateId(),
      member: generateId(),
      outsider: generateId(),
    }
    await db.insert(user).values(
      [ids.owner, ids.member, ids.outsider].map((id) => ({
        id,
        name: 'Search setup fixture',
        email: `${id}@fixture.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    )
    await db.insert(organization).values({
      id: ids.organization,
      name: 'Search setup fixture',
      slug: ids.organization,
      metadata: { preserved: 'organization setting' },
    })
    await db.insert(member).values([
      { id: generateId(), organizationId: ids.organization, userId: ids.owner, role: 'owner' },
      { id: generateId(), organizationId: ids.organization, userId: ids.member, role: 'member' },
    ])
  })

  afterEach(async () => {
    restoreSlackHttp?.()
    restoreSlackHttp = undefined
    await db.delete(organization).where(eq(organization.id, ids.organization))
    await db.delete(user).where(inArray(user.id, [ids.owner, ids.member, ids.outsider]))
  })
  afterAll(async () => {
    await closeRedisConnection()
    await db.$client.end()
  })

  const approve = (provider: string, userId = ids.owner) =>
    approveSearchIntegration.execute({
      principal: createSessionPrincipal({ userId, sessionId: generateId() }),
      input: {
        organizationId: ids.organization,
        connectorType: provider,
        approved: true,
        policy: defaultLiveSearchPolicy(),
      },
    })

  async function snapshot() {
    const [groups, servers, approvals, policies, organizations, credentials] = await Promise.all([
      db.select().from(credentialGroup).where(eq(credentialGroup.organizationId, ids.organization)),
      db.select().from(mcpServers).where(eq(mcpServers.organizationId, ids.organization)),
      db
        .select()
        .from(organizationSearchIntegration)
        .where(eq(organizationSearchIntegration.organizationId, ids.organization)),
      db.select().from(resourcePolicy).where(eq(resourcePolicy.organizationId, ids.organization)),
      db
        .select({ metadata: organization.metadata })
        .from(organization)
        .where(eq(organization.id, ids.organization)),
      db.select().from(credential).where(eq(credential.organizationId, ids.organization)),
    ])
    return {
      groups,
      servers,
      approvals,
      policies,
      credentials,
      metadata: toRecord(organizations[0]?.metadata),
    }
  }

  async function seedWorkflowSlack(scopes: readonly string[] = SLACK_MANAGED_USER_SCOPES) {
    const option = {
      id: generateId(),
      provider: 'slack',
      label: 'Slack',
      authorizationAppId: 'slack:A_FIXTURE:T_FIXTURE',
      requiredScopes: [...scopes],
      scopeVersion: credentialGroupScopePolicyVersion([...scopes]),
      required: false,
      status: 'active' as const,
    }
    const other = { ...option, id: generateId(), provider: 'gmail', label: 'Gmail' }
    const group = await db.transaction((tx) =>
      createOrganizationAccountsGroup(tx, ids.organization, ids.owner, [option, other])
    )
    await db
      .update(credentialGroup)
      .set({
        encryptedProviderConfiguration: await encryptCredentialGroupProviderConfiguration({
          ...emptyCredentialGroupProviderConfiguration(),
          slack: {
            clientId: 'fixture-client',
            clientSecret: 'fixture-secret',
            appId: 'A_FIXTURE',
            teamId: 'T_FIXTURE',
            scopes: [...scopes],
            verifiedAt: new Date().toISOString(),
          },
        }),
      })
      .where(eq(credentialGroup.id, group.id))
    const enrollmentId = generateId()
    await db.insert(credentialGroupEnrollment).values({
      id: enrollmentId,
      credentialGroupId: group.id,
      userId: ids.owner,
      email: `${ids.owner}@fixture.test`,
      status: 'completed',
      invitationTokenHash: sha256Hex(generateId()),
      invitationExpiresAt: new Date(Date.now() + 60_000),
      invitedAt: new Date(),
    })
    const encrypted = await encryptManagedOAuthTokenSet({ accessToken: 'fixture-token' })
    await db.insert(credential).values(
      [option, other].map((entry) => ({
        id: generateId(),
        organizationId: ids.organization,
        type: 'managed_oauth' as const,
        providerId: entry.provider,
        displayName: entry.label,
        createdBy: ids.owner,
        authorizationAppId: entry.authorizationAppId,
        providerSubjectId: ids.owner,
        credentialGroupEnrollmentId: enrollmentId,
        credentialGroupOptionId: entry.id,
        managedOauthStatus: 'active' as const,
        managedOauthScopeVersion: entry.scopeVersion,
        grantedScopes: [...scopes],
        encryptedOauthTokenSet: encrypted,
        grantedAt: new Date(),
      }))
    )
    return { groupId: group.id, optionId: option.id, otherOptionId: other.id }
  }

  async function seedSlackAuthorization(scopes: readonly string[] = SLACK_MANAGED_USER_SCOPES) {
    const seeded = await seedWorkflowSlack(scopes)
    const secret = (await encryptSecret('fixture-secret')).encrypted
    await db.insert(slackApp).values({
      id: 'A_FIXTURE',
      organizationId: ids.organization,
      kind: 'custom',
      clientId: 'fixture-client',
      encryptedClientSecret: secret,
      encryptedSigningSecret: secret,
      revision: generateId(),
    })
    const botId = generateId()
    await db.insert(credential).values({
      id: botId,
      organizationId: ids.organization,
      type: 'service_account',
      providerId: 'slack',
      displayName: 'Fixture Slack bot',
      createdBy: ids.owner,
      encryptedServiceAccountKey: secret,
    })
    await db.insert(slackSearchInstallation).values({
      id: generateId(),
      organizationId: ids.organization,
      credentialId: botId,
      appId: 'A_FIXTURE',
      slackAppId: 'A_FIXTURE',
      teamId: 'T_FIXTURE',
      teamName: 'Fixture team',
      botUserId: 'B_FIXTURE',
      credentialVersion: generateId(),
      revision: generateId(),
    })
    const before = await snapshot()
    const connection = before.credentials.find(
      (entry) => entry.credentialGroupOptionId === seeded.optionId
    )!
    const principal = createSessionPrincipal({ userId: ids.owner, sessionId: generateId() })
    return {
      ...seeded,
      before,
      resolveToken: () =>
        resolveManagedOAuthToken({
          credentialId: connection.id,
          organizationId: ids.organization,
          expectedProviderId: 'slack',
          requiredScopes: ['chat:write'],
        }),
      start: () =>
        startSlackCredentialGroupConfiguration.execute({
          principal,
          input: {
            organizationId: ids.organization,
            credentialGroupId: seeded.groupId,
            appId: 'A_FIXTURE',
            teamId: 'T_FIXTURE',
          },
        }),
      complete: (state: string, providerError?: string) =>
        completeSlackCredentialGroupConfiguration.execute({
          principal,
          input: { state, ...(providerError ? { providerError } : { code: 'fixture-code' }) },
        }),
    }
  }

  function provideSlackConsent(scopes: readonly string[]) {
    restoreSlackHttp?.()
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      switch (url) {
        case 'https://slack.com/api/oauth.v2.access':
          return Response.json({
            ok: true,
            app_id: 'A_FIXTURE',
            team: { id: 'T_FIXTURE', name: 'Fixture team' },
            authed_user: {
              id: 'U_FIXTURE',
              access_token: 'fixture-verification-token',
              token_type: 'user',
              scope: scopes.join(','),
            },
          })
        case 'https://slack.com/api/auth.test':
          return Response.json({ ok: true, team_id: 'T_FIXTURE', user_id: 'U_FIXTURE' })
        case 'https://slack.com/api/users.info':
          return Response.json({
            ok: true,
            user: { id: 'U_FIXTURE', profile: { email: 'member@fixture.test' } },
          })
        case 'https://slack.com/api/auth.revoke':
          return Response.json({ ok: true, revoked: true })
        default:
          throw new Error(`Unexpected OAuth fixture request: ${url}`)
      }
    })
    restoreSlackHttp = () => spy.mockRestore()
  }

  async function seedImplicitSlackApproval() {
    const knowledgeBaseId = generateId()
    const connectorId = generateId()
    await db.insert(knowledgeBase).values({
      id: knowledgeBaseId,
      userId: ids.owner,
      organizationId: ids.organization,
      isSearchIndex: true,
      name: 'Slack Search fixture',
    })
    await db.insert(knowledgeConnector).values({
      id: connectorId,
      knowledgeBaseId,
      connectorType: 'slack',
      status: 'active',
      sourceConfig: {},
    })
    return connectorId
  }

  it.each([false, true])(
    'verifies implicitly approved Search permissions unless explicitly disabled (disabled: %s)',
    async (disabled) => {
      const setup = await seedSlackAuthorization()
      await seedImplicitSlackApproval()
      if (disabled)
        await approveSearchIntegration.execute({
          principal: createSessionPrincipal({ userId: ids.owner, sessionId: generateId() }),
          input: { organizationId: ids.organization, connectorType: 'slack', approved: false },
        })
      expect(await integrationStatus('slack')).toMatchObject({ approved: !disabled })
      const pending = await setup.start()
      const scopes = disabled
        ? [...SLACK_MANAGED_USER_SCOPES]
        : [...new Set([...SLACK_MANAGED_USER_SCOPES, ...SLACK_SEARCH_USER_SCOPES])]
      expect(new URL(pending.authorizationUrl).searchParams.get('user_scope')!.split(',')).toEqual(
        expect.arrayContaining(scopes)
      )
      if (disabled)
        expect(new URL(pending.authorizationUrl).searchParams.get('user_scope')).not.toContain(
          'search:read.public'
        )
      provideSlackConsent(scopes)
      await expect(setup.complete(pending.state)).resolves.toMatchObject({ ok: true })
      const state = await snapshot()
      expect(
        state.groups[0].options.find((entry) => entry.id === setup.optionId)?.requiredScopes
      ).toEqual(expect.arrayContaining(scopes))
      if (disabled)
        await expect(setup.resolveToken()).resolves.toMatchObject({ accessToken: 'fixture-token' })
    }
  )

  it.each(['added', 'removed'] as const)(
    'rejects pending authorization when implicit Search approval is %s',
    async (change) => {
      const setup = await seedSlackAuthorization()
      const connectorId = change === 'removed' ? await seedImplicitSlackApproval() : null
      const pending = await setup.start()
      if (connectorId)
        await db
          .update(knowledgeConnector)
          .set({ archivedAt: new Date() })
          .where(eq(knowledgeConnector.id, connectorId))
      else await seedImplicitSlackApproval()
      provideSlackConsent([...SLACK_MANAGED_USER_SCOPES, ...SLACK_SEARCH_USER_SCOPES])
      await expect(setup.complete(pending.state)).rejects.toThrow('Search approval changed')
      expect((await snapshot()).groups).toEqual(setup.before.groups)
      await expect(setup.resolveToken()).resolves.toMatchObject({ accessToken: 'fixture-token' })
    }
  )

  it('stops granting implicit Search approval when a connector is removed with documents kept', async () => {
    const setup = await seedSlackAuthorization()
    const connectorId = await seedImplicitSlackApproval()
    await deleteKnowledgeConnector.execute({
      principal: createSessionPrincipal({ userId: ids.owner, sessionId: generateId() }),
      input: { connectorId, assertedOrganizationId: ids.organization, deleteDocuments: false },
    })
    expect(await integrationStatus('slack')).toMatchObject({ approved: false })
    const pending = await setup.start()
    expect(new URL(pending.authorizationUrl).searchParams.get('user_scope')).not.toContain(
      'search:read.public'
    )
    await setup.complete(pending.state, 'access_denied')
    await expect(setup.resolveToken()).resolves.toMatchObject({ accessToken: 'fixture-token' })
  })

  it.each(['remove connector', 'archive index', 'disable approval', 'restore index'] as const)(
    'serializes the Slack consent commit with Search lifecycle changes: %s',
    async (change) => {
      const setup = await seedSlackAuthorization()
      const connectorId = await seedImplicitSlackApproval()
      const [index] = await db
        .select()
        .from(knowledgeBase)
        .where(eq(knowledgeBase.organizationId, ids.organization))
      if (change === 'restore index')
        await deleteKnowledgeBase(index.id, generateId(), { allowSearchIndexDelete: true })
      const pending = await setup.start()
      provideSlackConsent([...SLACK_MANAGED_USER_SCOPES, ...SLACK_SEARCH_USER_SCOPES])
      const probe = `slack_consent_${generateId().replace(/-/g, '')}`
      const lockKey = `slack-consent-fixture:${setup.groupId}`
      await db.$client.unsafe(`CREATE FUNCTION ${probe}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM pg_advisory_xact_lock(hashtextextended('${lockKey}', 0));
          RETURN NEW;
        END $$`)
      await db.$client.unsafe(`CREATE TRIGGER ${probe} BEFORE UPDATE ON credential_group
        FOR EACH ROW WHEN (OLD.id = '${setup.groupId}') EXECUTE FUNCTION ${probe}()`)
      const locked = createDeferred<number>()
      const release = createDeferred<void>()
      const blocker = db.transaction(async (tx) => {
        await acquireAdvisoryXactLock(tx, 'slack_consent_fixture', lockKey)
        const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        locked.resolve(connection.pid)
        await release.promise
      })
      const blockerPid = await locked.promise
      const callback = setup.complete(pending.state).catch((error: unknown) => error)
      let mutation: Promise<unknown> | undefined
      try {
        let callbackPid: number | undefined
        await vi.waitFor(
          async () => {
            const [waiting] = await db.execute<{ pid: number }>(sql`
            SELECT pid FROM pg_stat_activity WHERE ${blockerPid} = ANY(pg_blocking_pids(pid))
          `)
            expect(waiting).toBeDefined()
            callbackPid = waiting?.pid
          },
          { timeout: 5_000 }
        )
        mutation = (
          change === 'remove connector'
            ? deleteKnowledgeConnector.execute({
                principal: createSessionPrincipal({ userId: ids.owner, sessionId: generateId() }),
                input: {
                  connectorId,
                  assertedOrganizationId: ids.organization,
                  deleteDocuments: false,
                },
              })
            : change === 'archive index'
              ? deleteKnowledgeBase(index.id, generateId(), { allowSearchIndexDelete: true })
              : change === 'restore index'
                ? restoreKnowledgeBase(index.id, generateId())
                : approveSearchIntegration.execute({
                    principal: createSessionPrincipal({
                      userId: ids.owner,
                      sessionId: generateId(),
                    }),
                    input: {
                      organizationId: ids.organization,
                      connectorType: 'slack',
                      approved: false,
                    },
                  })
        ).catch((error: unknown) => error)
        await vi.waitFor(
          async () => {
            const [state] = await db.execute<{ waiting: boolean }>(sql`
            SELECT EXISTS (SELECT 1 FROM pg_stat_activity
              WHERE ${callbackPid!} = ANY(pg_blocking_pids(pid))) AS waiting
          `)
            expect(state.waiting).toBe(true)
          },
          { timeout: 3_000 }
        )
      } finally {
        release.resolve()
        await blocker
        const callbackResult = await callback
        const mutationResult = await mutation
        await db.$client.unsafe(`DROP TRIGGER ${probe} ON credential_group`)
        await db.$client.unsafe(`DROP FUNCTION ${probe}()`)
        expect(callbackResult).toMatchObject({ ok: true })
        expect(mutationResult).not.toBeInstanceOf(Error)
      }
      expect(await integrationStatus('slack')).toMatchObject({
        approved: change === 'restore index',
      })
    }
  )

  it.each([
    { name: 'workflow policy', scopes: SLACK_MANAGED_USER_SCOPES },
    { name: 'custom policy', scopes: ['chat:write', 'users:read', 'users:read.email'] },
  ])('preserves a Slack $name until Search consent is verified', async ({ scopes }) => {
    const setup = await seedSlackAuthorization(scopes)
    await expect(setup.resolveToken()).resolves.toMatchObject({ accessToken: 'fixture-token' })
    const originalAttempt = await setup.start()
    expect(
      new URL(originalAttempt.authorizationUrl).searchParams.get('user_scope')!.split(',')
    ).not.toContain('search:read.public')
    await setup.complete(originalAttempt.state, 'access_denied')
    await approve('slack')
    await expect(approve('slack')).resolves.toMatchObject({ memberAccounts: { changed: false } })
    const pending = await snapshot()
    expect(pending.groups).toEqual(setup.before.groups)
    expect(pending.credentials).toEqual(setup.before.credentials)
    expect(pending.policies).toEqual(setup.before.policies)
    await expect(setup.resolveToken()).resolves.toMatchObject({ accessToken: 'fixture-token' })

    const desiredScopes = [...new Set([...scopes, ...SLACK_SEARCH_USER_SCOPES])]
    const cancelled = await setup.start()
    expect(new URL(cancelled.authorizationUrl).searchParams.get('user_scope')!.split(',')).toEqual(
      expect.arrayContaining(desiredScopes)
    )
    await expect(setup.complete(cancelled.state, 'access_denied')).resolves.toEqual({
      ok: false,
      reason: 'provider_error',
    })
    await expect(setup.resolveToken()).resolves.toMatchObject({ accessToken: 'fixture-token' })
    expect((await snapshot()).groups).toEqual(setup.before.groups)

    const incomplete = await setup.start()
    provideSlackConsent(scopes)
    await expect(setup.complete(incomplete.state)).rejects.toThrow('did not grant every permission')
    expect((await snapshot()).groups).toEqual(setup.before.groups)
    await expect(setup.resolveToken()).resolves.toMatchObject({ accessToken: 'fixture-token' })

    const verified = await setup.start()
    provideSlackConsent(desiredScopes)
    await expect(setup.complete(verified.state)).resolves.toMatchObject({
      ok: true,
      reason: 'authorized',
    })
    const state = await snapshot()
    const upgraded = state.groups[0].options.find((option) => option.id === setup.optionId)!
    expect(upgraded.requiredScopes).toEqual(expect.arrayContaining(desiredScopes))
    expect(upgraded.scopeVersion).not.toBe(setup.before.groups[0].options[0].scopeVersion)
    const configuration = await decryptCredentialGroupProviderConfiguration(
      state.groups[0].encryptedProviderConfiguration
    )
    expect(configuration.slack?.scopes).toEqual(expect.arrayContaining(desiredScopes))
    expect(
      state.credentials.find((entry) => entry.credentialGroupOptionId === setup.optionId)
        ?.managedOauthStatus
    ).toBe('needs_reauth')
    expect(
      state.credentials.find((entry) => entry.credentialGroupOptionId === setup.otherOptionId)
    ).toEqual(
      setup.before.credentials.find(
        (entry) => entry.credentialGroupOptionId === setup.otherOptionId
      )
    )
    expect(state.groups[0].options.find((option) => option.id === setup.otherOptionId)).toEqual(
      setup.before.groups[0].options[1]
    )
    await expect(
      getCredentialGroup({ kind: 'organization', organizationId: ids.organization }, setup.groupId)
    ).resolves.toMatchObject({
      options: expect.arrayContaining([
        expect.objectContaining({ id: setup.optionId, configurationStatus: 'ready' }),
      ]),
    })
    await expect(setup.complete(verified.state)).rejects.toThrow('invalid or expired')
  })

  it.each(['missing', 'disabled'] as const)(
    'rejects workflow-only authorization when Search becomes approved (previous approval: %s)',
    async (previousApproval) => {
      const setup = await seedSlackAuthorization()
      if (previousApproval === 'disabled')
        await db.insert(organizationSearchIntegration).values({
          organizationId: ids.organization,
          connectorType: 'slack',
          approved: false,
        })
      const pending = await setup.start()
      await approve('slack')
      provideSlackConsent(SLACK_MANAGED_USER_SCOPES)
      await expect(setup.complete(pending.state)).rejects.toThrow('Search approval changed')
      expect((await snapshot()).groups).toEqual(setup.before.groups)
      await expect(setup.resolveToken()).resolves.toMatchObject({ accessToken: 'fixture-token' })
    }
  )

  it.each([false, true])(
    'rejects a pending Search upgrade after approval changes (reapproved: %s)',
    async (reapproved) => {
      const setup = await seedSlackAuthorization()
      await approve('slack')
      const pending = await setup.start()
      await approveSearchIntegration.execute({
        principal: createSessionPrincipal({ userId: ids.owner, sessionId: generateId() }),
        input: { organizationId: ids.organization, connectorType: 'slack', approved: false },
      })
      if (reapproved) await approve('slack')
      provideSlackConsent([...SLACK_MANAGED_USER_SCOPES, ...SLACK_SEARCH_USER_SCOPES])
      await expect(setup.complete(pending.state)).rejects.toThrow('Search approval changed')
      expect((await snapshot()).groups).toEqual(setup.before.groups)
      await expect(setup.resolveToken()).resolves.toMatchObject({ accessToken: 'fixture-token' })
    }
  )

  async function seedServiceSource(provider: 'google_drive' | 'github' | 'gitlab') {
    const knowledgeBaseId = generateId()
    const connectorId = generateId()
    const credentialId = generateId()
    const installation = {
      type: 'github_app_installation',
      version: 1,
      appId: '1',
      appClientId: 'fixture-github-app',
      installationId: '21',
      accountId: '11',
      accountType: 'Organization',
      accountLogin: 'fixture-owner',
      repositorySelection: 'selected',
    } satisfies GitHubInstallationBinding
    const encryptedInstallation =
      provider === 'github' ? await encryptSecret(JSON.stringify(installation)) : undefined
    await db.insert(knowledgeBase).values({
      id: knowledgeBaseId,
      userId: ids.owner,
      organizationId: ids.organization,
      isSearchIndex: true,
      name: 'Service source fixture',
    })
    await db.insert(credential).values({
      id: credentialId,
      organizationId: ids.organization,
      type: 'service_account',
      providerId: provider === 'github' ? GITHUB_INSTALLATION_PROVIDER_ID : 'google-drive',
      ...(encryptedInstallation
        ? {
            encryptedServiceAccountKey: encryptedInstallation.encrypted,
            providerSubjectId: installation.installationId,
            providerTenantId: installation.accountId,
            authorizationAppId: installation.appClientId,
          }
        : {}),
      displayName: 'Service source fixture',
      createdBy: ids.owner,
    })
    await db.insert(knowledgeConnector).values({
      id: connectorId,
      knowledgeBaseId,
      connectorType: provider,
      credentialId,
      encryptedApiKey: provider === 'gitlab' ? 'synthetic-encrypted-key' : null,
      sourceConfig:
        provider === 'github'
          ? { repository: 'fixture-owner/repository', githubRepositoryId: '101' }
          : {},
      accessMode: provider === 'github' ? 'members' : 'admin',
      status: 'active',
    })
    await db.insert(organizationSearchIntegration).values({
      organizationId: ids.organization,
      connectorType: provider,
      approved: true,
    })
    await db
      .update(organization)
      .set({
        metadata: {
          liveSearchPolicies: {
            [provider]: {
              ...defaultLiveSearchPolicy(provider),
              accessMode: 'service_account',
              ...(provider === 'google_drive' ? { sourceId: connectorId } : {}),
            },
          },
        },
      })
      .where(eq(organization.id, ids.organization))
    return { knowledgeBaseId, connectorId, credentialId }
  }

  async function integrationStatus(provider: string) {
    const data = await listSearchIntegrations.execute({
      principal: createSessionPrincipal({ userId: ids.member, sessionId: generateId() }),
      input: { organizationId: ids.organization },
    })
    return listSearchIntegrationsContract.response.schema
      .parse({ success: true, data })
      .data.find((entry) => entry.connectorType === provider)
  }

  it.each(['google_drive', 'github', 'gitlab'] as const)(
    'reports a configured %s service source without requiring a member account',
    async (provider) => {
      const source = await seedServiceSource(provider)
      expect((await snapshot()).groups).toEqual([])
      expect(await integrationStatus(provider)).toMatchObject({ configuredServiceSource: true })
      await db
        .update(knowledgeConnector)
        .set({ status: 'disabled' })
        .where(eq(knowledgeConnector.id, source.connectorId))
      expect(await integrationStatus(provider)).toMatchObject({ configuredServiceSource: false })
      await db
        .update(knowledgeConnector)
        .set({ status: 'active', archivedAt: new Date() })
        .where(eq(knowledgeConnector.id, source.connectorId))
      expect(await integrationStatus(provider)).toMatchObject({ configuredServiceSource: false })
      await db
        .update(knowledgeConnector)
        .set({ archivedAt: null })
        .where(eq(knowledgeConnector.id, source.connectorId))
      await db
        .update(knowledgeBase)
        .set({ deletedAt: new Date() })
        .where(eq(knowledgeBase.id, source.knowledgeBaseId))
      expect(await integrationStatus(provider)).toMatchObject({ configuredServiceSource: false })
      await db
        .update(knowledgeBase)
        .set({ deletedAt: null })
        .where(eq(knowledgeBase.id, source.knowledgeBaseId))
      await db
        .update(organizationSearchIntegration)
        .set({ approved: false })
        .where(eq(organizationSearchIntegration.organizationId, ids.organization))
      expect(await integrationStatus(provider)).toMatchObject({ configuredServiceSource: false })
    }
  )

  it('stops reporting a service source as configured after its credential is deleted', async () => {
    const source = await seedServiceSource('google_drive')
    expect(await integrationStatus('google_drive')).toMatchObject({ configuredServiceSource: true })
    await deleteConnectionCredential({
      credentialId: source.credentialId,
      organizationId: ids.organization,
      reason: 'user_delete',
    })
    expect(await integrationStatus('google_drive')).toMatchObject({
      configuredServiceSource: false,
    })
  })

  it('requires the selected service source to belong to this organization and provider', async () => {
    const source = await seedServiceSource('google_drive')
    const otherOrganizationId = generateId()
    await db.insert(organization).values({
      id: otherOrganizationId,
      name: 'Other service fixture',
      slug: otherOrganizationId,
    })
    try {
      await db
        .update(knowledgeBase)
        .set({ organizationId: otherOrganizationId })
        .where(eq(knowledgeBase.id, source.knowledgeBaseId))
      expect(await integrationStatus('google_drive')).toMatchObject({
        configuredServiceSource: false,
      })
      await db
        .update(knowledgeBase)
        .set({ organizationId: ids.organization })
        .where(eq(knowledgeBase.id, source.knowledgeBaseId))
      await db
        .update(knowledgeConnector)
        .set({ connectorType: 'confluence' })
        .where(eq(knowledgeConnector.id, source.connectorId))
      expect(await integrationStatus('google_drive')).toMatchObject({
        configuredServiceSource: false,
      })
      await db
        .update(knowledgeConnector)
        .set({ connectorType: 'google_drive' })
        .where(eq(knowledgeConnector.id, source.connectorId))
      await db
        .update(organization)
        .set({
          metadata: {
            liveSearchPolicies: {
              google_drive: {
                ...defaultLiveSearchPolicy(),
                accessMode: 'service_account',
                sourceId: generateId(),
              },
            },
          },
        })
        .where(eq(organization.id, ids.organization))
      expect(await integrationStatus('google_drive')).toMatchObject({
        configuredServiceSource: false,
      })
    } finally {
      await db.delete(organization).where(eq(organization.id, otherOrganizationId))
    }
  })

  it('does not count a GitHub member source without its active installation credential', async () => {
    const source = await seedServiceSource('github')
    await db
      .update(credential)
      .set({ revokedAt: new Date() })
      .where(eq(credential.id, source.credentialId))
    expect(await integrationStatus('github')).toMatchObject({ configuredServiceSource: false })
    await db
      .update(credential)
      .set({ revokedAt: null })
      .where(eq(credential.id, source.credentialId))
    await db
      .update(knowledgeConnector)
      .set({ memberSyncStatus: 'disabled' })
      .where(eq(knowledgeConnector.id, source.connectorId))
    expect(await integrationStatus('github')).toMatchObject({ configuredServiceSource: false })
    await db
      .update(knowledgeConnector)
      .set({ memberSyncStatus: 'idle', sourceConfig: {} })
      .where(eq(knowledgeConnector.id, source.connectorId))
    expect(await integrationStatus('github')).toMatchObject({ configuredServiceSource: false })
  })

  it('rejects an oversized combined permission request without changing existing connections', async () => {
    const scopes = [
      'chat:write',
      'users:read',
      'users:read.email',
      ...Array.from({ length: 97 }, (_, index) => `custom:${index}`),
    ]
    const setup = await seedSlackAuthorization(scopes)
    await approve('slack')
    await expect(setup.start()).rejects.toThrow('too many permissions')
    expect((await snapshot()).groups).toEqual(setup.before.groups)
    await expect(setup.resolveToken()).resolves.toMatchObject({ accessToken: 'fixture-token' })
  })

  it('keeps disabled Zoom approvals visible and removable without permitting reapproval', async () => {
    const connectorType = 'zoom'
    await db.insert(organizationSearchIntegration).values({
      organizationId: ids.organization,
      connectorType,
      approved: true,
    })
    const principal = createSessionPrincipal({ userId: ids.owner, sessionId: generateId() })
    const data = await listSearchIntegrations.execute({
      principal,
      input: { organizationId: ids.organization },
    })
    const response = listSearchIntegrationsContract.response.schema.parse({ success: true, data })
    expect(response.data).toContainEqual(
      expect.objectContaining({ connectorType, approved: true, available: false })
    )
    expect(response.data).toContainEqual(
      expect.objectContaining({ connectorType: 'gmail', available: true })
    )
    await approveSearchIntegration.execute({
      principal,
      input: { organizationId: ids.organization, connectorType, approved: false },
    })
    await expect(approve(connectorType)).rejects.toThrow(/Search.*not available/)
    const state = await snapshot()
    expect(state.approvals).toEqual([expect.objectContaining({ connectorType, approved: false })])
    expect(state.groups).toEqual([])
    expect(state.policies).toEqual([])
  })

  it.each([
    ['fireflies', 'https://api.fireflies.ai/mcp'],
    ['granola', 'https://mcp.granola.ai/mcp'],
    ['notion', 'https://mcp.notion.com/mcp'],
    ['lucid', 'https://mcp.lucid.app/mcp/readonly'],
  ])(
    'approves %s with an organization-owned sign-in server and access policy',
    async (provider, url) => {
      const result = await approve(provider)
      const state = await snapshot()
      expect(state.groups).toHaveLength(1)
      const group = state.groups[0]
      expect(group).toMatchObject({
        organizationId: ids.organization,
        workspaceId: null,
        status: 'active',
        createdBy: ids.owner,
      })
      expect(state.servers).toEqual([
        expect.objectContaining({
          credentialGroupId: group.id,
          organizationId: ids.organization,
          workspaceId: null,
          managedConnectorId: provider,
          url,
          enabled: true,
          authType: 'oauth',
          createdBy: ids.owner,
        }),
      ])
      expect(state.approvals).toEqual([
        expect.objectContaining({ connectorType: provider, approved: true }),
      ])
      expect(state.policies).toEqual([
        expect.objectContaining({
          resourceType: 'credential_group',
          resourceId: group.id,
          document: {
            version: 2,
            resource: { type: 'credential_group', id: group.id },
            statements: [],
          },
        }),
      ])
      expect(toRecord(state.metadata.liveSearchPolicies)[provider]).toMatchObject({
        accessMode: 'member',
      })
      expect(state.metadata.preserved).toBe('organization setting')
      expect(result.memberAccounts?.groupId).toBe(group.id)
    }
  )

  it('rejects Zoom approval when rollout is disabled while waiting for the accounts lock', async () => {
    const group = await db.transaction((tx) =>
      createOrganizationAccountsGroup(tx, ids.organization, ids.owner)
    )
    await db.insert(mcpServers).values({
      id: generateId(),
      organizationId: ids.organization,
      credentialGroupId: group.id,
      managedConnectorId: 'zoom',
      name: 'Zoom',
      transport: 'streamable-http',
      url: 'https://mcp.zoom.us/mcp/meeting/streamable',
      authType: 'oauth',
      enabled: true,
      createdBy: ids.owner,
    })
    Object.assign(env, { ZOOM_SEARCH: true })
    const before = await snapshot()
    const locked = createDeferred<number>()
    const release = createDeferred<void>()
    const blocker = db.transaction(async (tx) => {
      await acquireAdvisoryXactLock(
        tx,
        'search_accounts',
        `search-accounts:organization:${ids.organization}`
      )
      const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
      locked.resolve(connection.pid)
      await release.promise
    })
    const blockerPid = await locked.promise
    const attempt = approve('zoom').catch((error: unknown) => error)
    try {
      await vi.waitFor(
        async () => {
          const [state] = await db.execute<{ waiting: boolean }>(sql`
            SELECT EXISTS (
              SELECT 1 FROM pg_stat_activity
              WHERE ${blockerPid} = ANY(pg_blocking_pids(pid))
            ) AS waiting
          `)
          expect(state.waiting).toBe(true)
        },
        { timeout: 5_000 }
      )
      Object.assign(env, { ZOOM_SEARCH: false })
    } finally {
      release.resolve()
      await blocker
      await attempt
    }
    expect(await attempt).toMatchObject({ code: 'forbidden' })
    expect(await snapshot()).toEqual(before)
    Object.assign(env, { ZOOM_SEARCH: true })
    await expect(approve('zoom')).resolves.toMatchObject({ approved: true })
  })

  it('resolves the sign-in server before the approval takes the accounts lock', async () => {
    const lockHeldDuringLookup: boolean[] = []
    vi.mocked(dns.resolveHostAddresses).mockImplementationOnce(async () => {
      /** A separate connection: the lookup must not run inside the approval's transaction. */
      const acquired = await runOutsideTransactionContext(() =>
        db.transaction((tx) =>
          tryAcquireAdvisoryXactLock(
            tx,
            'search_accounts',
            `search-accounts:organization:${ids.organization}`
          )
        )
      )
      lockHeldDuringLookup.push(!acquired)
      return { addresses: ['93.184.216.34'], preferred: '93.184.216.34' }
    })
    await approve('fireflies')
    expect(lockHeldDuringLookup).toEqual([false])
    expect((await snapshot()).servers).toHaveLength(1)
  })

  it('approves an already-configured provider while DNS is unavailable', async () => {
    const first = await approve('fireflies')
    const before = (await snapshot()).servers
    const lookup = vi.mocked(dns.resolveHostAddresses)
    const fixture = lookup.getMockImplementation()
    lookup.mockRejectedValue(new Error('DNS unavailable'))
    try {
      const again = await approve('fireflies')
      expect(again.memberAccounts?.groupId).toBe(first.memberAccounts?.groupId)
    } finally {
      if (fixture) lookup.mockImplementation(fixture)
    }
    expect((await snapshot()).servers).toEqual(before)
  })

  it('approves a provider a concurrent approval configured while this lookup failed', async () => {
    vi.mocked(dns.resolveHostAddresses).mockImplementationOnce(async () => {
      await approve('fireflies')
      throw new Error('DNS unavailable')
    })
    await approve('fireflies')
    expect((await snapshot()).servers).toHaveLength(1)
  })

  it('serializes concurrent approvals into one group and one server per provider', async () => {
    const providers = ['fireflies', 'granola', 'notion']
    const results = await Promise.all(
      [...providers, ...providers].map((provider) => approve(provider))
    )
    const state = await snapshot()
    expect(state.groups).toHaveLength(1)
    expect(state.servers).toHaveLength(3)
    expect(new Set(state.servers.map(({ managedConnectorId }) => managedConnectorId)).size).toBe(3)
    expect(
      state.servers.every(({ credentialGroupId }) => credentialGroupId === state.groups[0].id)
    ).toBe(true)
    expect(
      results.every(({ memberAccounts }) => memberAccounts?.groupId === state.groups[0].id)
    ).toBe(true)
    const serverIds = state.servers.map(({ id }) => id).sort()
    await Promise.all(providers.map((provider) => approve(provider)))
    expect((await snapshot()).servers.map(({ id }) => id).sort()).toEqual(serverIds)
  })

  it('refuses to reactivate a disabled connected-accounts group while approving Search', async () => {
    const group = await db.transaction((tx) =>
      createOrganizationAccountsGroup(tx, ids.organization, ids.owner)
    )
    await db
      .update(credentialGroup)
      .set({ status: 'disabled' })
      .where(eq(credentialGroup.id, group.id))
    const before = await snapshot()
    await expect(approve('fireflies')).rejects.toThrow(/disabled|enable/i)
    expect(await snapshot()).toEqual(before)
  })

  it('refuses to reactivate a disabled managed server while approving Search', async () => {
    const group = await db.transaction((tx) =>
      createOrganizationAccountsGroup(tx, ids.organization, ids.owner)
    )
    await db.insert(mcpServers).values({
      id: generateId(),
      organizationId: ids.organization,
      credentialGroupId: group.id,
      managedConnectorId: 'fireflies',
      name: 'Fireflies',
      transport: 'streamable-http',
      url: 'https://api.fireflies.ai/mcp',
      authType: 'oauth',
      enabled: false,
      createdBy: ids.owner,
    })
    const before = await snapshot()
    await expect(approve('fireflies')).rejects.toThrow(/disabled|enable/i)
    expect(await snapshot()).toEqual(before)
  })

  it.each(['member', 'outsider'] as const)(
    'denies a %s without creating approval or sign-in resources',
    async (actor) => {
      const before = await snapshot()
      await expect(approve('fireflies', ids[actor])).rejects.toMatchObject({
        code: actor === 'member' ? 'forbidden' : 'not_found',
      })
      expect(await snapshot()).toEqual(before)
    }
  )

  it.each(['fireflies', 'slack'])(
    'rolls back %s sign-in policy and credentials when the final approval write fails',
    async (provider) => {
      if (provider === 'slack') await seedWorkflowSlack()
      const constraint = `search_setup_${generateId().replace(/-/g, '')}`
      await db.execute(
        sql`ALTER TABLE organization_search_integration ADD CONSTRAINT ${sql.identifier(constraint)} CHECK (organization_id <> ${sql.raw(`'${ids.organization}'`)}) NOT VALID`
      )
      const before = await snapshot()
      try {
        let failure: unknown
        try {
          await approve(provider)
        } catch (error) {
          failure = error
        }
        expect(getPostgresErrorCode(failure)).toBe('23514')
        expect(await snapshot()).toEqual(before)
      } finally {
        await db.execute(
          sql`ALTER TABLE organization_search_integration DROP CONSTRAINT ${sql.identifier(constraint)}`
        )
      }
    }
  )
})
