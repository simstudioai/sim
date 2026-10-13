/**
 * Real authorization, PostgreSQL, Redis, encryption and policy resolution for Slack member
 * accounts on the shared app with no Search bot; Slack HTTP uses fixtures. The shared app is a
 * hosted rollout, so `isHosted` is the one deployment fixture, paired with an enterprise plan.
 * Run `bun run test:integration lib/credential-groups/__integration__/slack-shared-member-accounts.integration.ts`
 * with INTEGRATION_REPORT_PATH for a caller-selected JSON report.
 */

import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  member,
  organization,
  slackApp,
  slackSearchInstallation,
  subscription,
  user,
} from '@sim/db/schema'
import { readTestRedisUrl } from '@sim/db/testing/test-infrastructure'
import { sha256Hex } from '@sim/security/hash'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '@/lib/core/config/env'
import { closeRedisConnection } from '@/lib/core/config/redis'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  completeSlackCredentialGroupConfiguration,
  startSlackCredentialGroupConfiguration,
} from '@/lib/credential-groups/application/slack-managed-users'
import { lockOrganizationSlackApp } from '@/lib/credential-groups/organization-slack-app'
import { credentialGroupScopePolicyVersion } from '@/lib/credential-groups/provider-adapter'
import {
  decryptCredentialGroupProviderConfiguration,
  emptyCredentialGroupProviderConfiguration,
  encryptCredentialGroupProviderConfiguration,
} from '@/lib/credential-groups/provider-configuration'
import { getCredentialGroup } from '@/lib/credential-groups/service'
import { SLACK_SEARCH_USER_SCOPES } from '@/lib/credential-groups/slack-managed-user-scopes'
import { slackCredentialGroupProviderAdapter } from '@/lib/credential-groups/slack-provider'
import { createOrganizationAccountsGroup } from '@/lib/credential-groups/workspace-accounts'
import { encryptManagedOAuthTokenSet } from '@/lib/credentials/managed-oauth'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import { approveSearchIntegration } from '@/lib/knowledge/application/search-integrations'
import {
  listSlackSearchInstallations,
  removeSlackSearchInstallation,
} from '@/lib/knowledge/application/slack-search/installations'
import { revokeSlackSearchAccess } from '@/lib/knowledge/application/slack-search/lifecycle'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import { getSharedSlackSearchAppConfiguration } from '@/lib/slack-search/shared-app-env'

vi.mock('@/lib/core/config/env-flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/config/env-flags')>()),
  isHosted: true,
}))

const SHARED_APP_ID = 'ASHAREDFIXTURE'
const CUSTOM_APP_ID = 'ACUSTOMFIXTURE'
const MEMBER_TEAM = 'TMEMBERS'
const OTHER_TEAM = 'TOTHER'

describe('Slack member accounts on the shared app without a Search bot', () => {
  const redisUrl = readTestRedisUrl()
  let ids: { organization: string; otherOrganization: string; owner: string }
  let restoreSlackHttp: (() => void) | undefined

  beforeAll(() => {
    if (!redisUrl)
      throw new Error(
        'Set TEST_REDIS_URL to a disposable local Redis or use bun run test:integration'
      )
  })

  beforeEach(async () => {
    Object.assign(env, {
      REDIS_URL: redisUrl,
      SLACK_SEARCH_APP_ID: SHARED_APP_ID,
      SLACK_SEARCH_CLIENT_ID: 'fixture-shared-client',
      SLACK_SEARCH_CLIENT_SECRET: 'fixture-shared-secret',
      SLACK_SEARCH_SIGNING_SECRET: 'fixture-shared-signing',
      SLACK_SEARCH_SHARED_APP: true,
    })
    ids = { organization: generateId(), otherOrganization: generateId(), owner: generateId() }
    await db.insert(user).values({
      id: ids.owner,
      name: 'Slack member fixture',
      email: `${ids.owner}@fixture.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await db.insert(organization).values(
      [ids.organization, ids.otherOrganization].map((id) => ({
        id,
        name: 'Slack member fixture',
        slug: id,
      }))
    )
    await db.insert(member).values({
      id: generateId(),
      organizationId: ids.organization,
      userId: ids.owner,
      role: 'owner',
    })
    await db.insert(subscription).values({
      id: generateId(),
      plan: 'enterprise',
      referenceId: ids.organization,
      status: 'active',
      metadata: { workspaces: 'unlimited' },
    })
  })

  afterEach(async () => {
    restoreSlackHttp?.()
    restoreSlackHttp = undefined
    await db.delete(subscription).where(eq(subscription.referenceId, ids.organization))
    await db
      .delete(organization)
      .where(inArray(organization.id, [ids.organization, ids.otherOrganization]))
    await db.delete(user).where(eq(user.id, ids.owner))
    await db.delete(slackApp).where(eq(slackApp.id, SHARED_APP_ID))
  })
  afterAll(async () => {
    await closeRedisConnection()
    await db.$client.end()
  })

  const principal = () => createSessionPrincipal({ userId: ids.owner, sessionId: generateId() })

  const approveSlack = () =>
    approveSearchIntegration.execute({
      principal: principal(),
      input: {
        organizationId: ids.organization,
        connectorType: 'slack',
        approved: true,
        policy: defaultLiveSearchPolicy(),
      },
    })

  const startSetup = (credentialGroupId: string, app?: { appId: string; teamId: string }) =>
    startSlackCredentialGroupConfiguration.execute({
      principal: principal(),
      input: { organizationId: ids.organization, credentialGroupId, ...app },
    })

  const completeSetup = (state: string) =>
    completeSlackCredentialGroupConfiguration.execute({
      principal: principal(),
      input: { state, code: 'fixture-code' },
    })

  async function installBot(appId: string, teamId: string, executor: DbOrTx = db) {
    const secret = (await encryptSecret('fixture-bot')).encrypted
    await executor
      .insert(slackApp)
      .values(
        appId === SHARED_APP_ID
          ? { id: appId, kind: 'shared', organizationId: null, revision: generateId() }
          : {
              id: appId,
              kind: 'custom',
              organizationId: ids.organization,
              clientId: 'fixture-custom-client',
              encryptedClientSecret: secret,
              encryptedSigningSecret: secret,
              revision: generateId(),
            }
      )
      .onConflictDoNothing()
    const botId = generateId()
    await executor.insert(credential).values({
      id: botId,
      organizationId: ids.organization,
      type: 'service_account',
      providerId: 'slack',
      displayName: 'Fixture Slack bot',
      createdBy: ids.owner,
      encryptedServiceAccountKey: secret,
    })
    const installationId = generateId()
    await executor.insert(slackSearchInstallation).values({
      id: installationId,
      organizationId: ids.organization,
      credentialId: botId,
      appId,
      slackAppId: appId,
      teamId,
      teamName: 'Fixture team',
      botUserId: 'UBOT',
      credentialVersion: generateId(),
      revision: generateId(),
    })
    return installationId
  }

  async function accountsGroup() {
    const [group] = await db
      .select()
      .from(credentialGroup)
      .where(eq(credentialGroup.organizationId, ids.organization))
    return group
  }

  /** Holds the Slack organization lock until `contend` is observed waiting on it, then releases. */
  async function whileOrganizationSlackAppLocked<T>(
    contend: () => Promise<T>,
    holdWith: (tx: DbTransaction) => Promise<unknown> = async () => undefined
  ): Promise<T> {
    const locked = createDeferred<number>()
    const release = createDeferred<void>()
    const holder = db.transaction(async (tx) => {
      await lockOrganizationSlackApp(tx, ids.organization)
      await holdWith(tx)
      const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
      locked.resolve(connection.pid)
      await release.promise
    })
    const holderPid = await Promise.race([
      locked.promise,
      holder.then(() => {
        throw new Error('The lock holder finished before holding the lock')
      }),
    ])
    const contender = contend()
    contender.catch(() => undefined)
    try {
      await vi.waitFor(
        async () => {
          const [waiting] = await db.execute<{ pid: number }>(
            sql`SELECT pid FROM pg_stat_activity
              WHERE ${holderPid} = ANY(pg_blocking_pids(pid)) AND query LIKE '%lock=''slack_org_app''%'`
          )
          expect(waiting).toBeDefined()
        },
        { timeout: 5_000 }
      )
    } finally {
      release.resolve()
      await holder
    }
    return contender
  }

  function provideSlackConsent(teamId: string) {
    restoreSlackHttp?.()
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      switch (url) {
        case 'https://slack.com/api/oauth.v2.access':
          return Response.json({
            ok: true,
            app_id: SHARED_APP_ID,
            team: { id: teamId, name: 'Fixture team' },
            authed_user: {
              id: 'UADMIN',
              access_token: 'fixture-verification-token',
              token_type: 'user',
              scope: SLACK_SEARCH_USER_SCOPES.join(','),
            },
          })
        case 'https://slack.com/api/auth.test':
          return Response.json({ ok: true, team_id: teamId, user_id: 'UADMIN' })
        case 'https://slack.com/api/users.info':
          return Response.json({
            ok: true,
            user: { id: 'UADMIN', profile: { email: 'admin@fixture.test' } },
          })
        case 'https://slack.com/api/auth.revoke':
          return Response.json({ ok: true, revoked: true })
        default:
          throw new Error(`Unexpected Slack fixture request: ${url}`)
      }
    })
    restoreSlackHttp = () => spy.mockRestore()
  }

  it('approves Slack, verifies the workspace from the admin grant, and resolves member sign-in', async () => {
    const approval = await approveSlack()
    expect(approval).toMatchObject({ approved: true })
    const groupId = approval.memberAccounts?.groupId
    if (!groupId) throw new Error('Approval did not provision organization accounts')
    expect((await accountsGroup()).options.some((option) => option.provider === 'slack')).toBe(
      false
    )

    const first = new URL((await startSetup(groupId)).authorizationUrl)
    expect(first.searchParams.get('client_id')).toBe('fixture-shared-client')
    expect(first.searchParams.has('team')).toBe(false)
    expect(first.searchParams.get('user_scope')?.split(',')).toEqual(
      expect.arrayContaining([...SLACK_SEARCH_USER_SCOPES])
    )
    provideSlackConsent(MEMBER_TEAM)
    await expect(completeSetup(first.searchParams.get('state') ?? '')).resolves.toMatchObject({
      ok: true,
      result: { appId: SHARED_APP_ID, teamId: MEMBER_TEAM },
    })

    const group = await accountsGroup()
    const option = group.options.find((entry) => entry.provider === 'slack')
    expect(option).toMatchObject({
      status: 'active',
      authorizationAppId: `slack:${SHARED_APP_ID}:${MEMBER_TEAM}`,
    })
    expect(
      (await decryptCredentialGroupProviderConfiguration(group.encryptedProviderConfiguration))
        .slack
    ).toMatchObject({ source: 'slack_app', appId: SHARED_APP_ID, teamId: MEMBER_TEAM })
    await expect(
      getCredentialGroup({ kind: 'organization', organizationId: ids.organization }, groupId)
    ).resolves.toMatchObject({
      options: expect.arrayContaining([
        expect.objectContaining({ provider: 'slack', configurationStatus: 'ready' }),
      ]),
    })
    await expect(
      slackCredentialGroupProviderAdapter.getPolicy(undefined, {
        organizationId: ids.organization,
        credentialGroupId: groupId,
        credentialGroupOptionId: option?.id,
      })
    ).resolves.toMatchObject({ authorizationAppId: `slack:${SHARED_APP_ID}:${MEMBER_TEAM}` })
    await expect(approveSlack()).resolves.toMatchObject({ memberAccounts: { changed: false } })
    await expect(
      listSlackSearchInstallations.execute({
        principal: principal(),
        input: { organizationId: ids.organization },
      })
    ).resolves.toMatchObject({
      sharedAppAvailable: true,
      memberAppKind: 'shared',
      installations: [],
    })

    const second = new URL((await startSetup(groupId)).authorizationUrl)
    expect(second.searchParams.get('team')).toBe(MEMBER_TEAM)
    provideSlackConsent(OTHER_TEAM)
    await expect(completeSetup(second.searchParams.get('state') ?? '')).rejects.toThrow(
      'different app or workspace'
    )
    expect(await accountsGroup()).toEqual(group)
  })

  it('refuses shared-app member setup when the organization already has a Search bot', async () => {
    const groupId = (await approveSlack()).memberAccounts?.groupId
    if (!groupId) throw new Error('Approval did not provision organization accounts')
    await installBot(SHARED_APP_ID, MEMBER_TEAM)
    await expect(startSetup(groupId)).rejects.toThrow('installed Slack app')
  })

  it('refuses to finish member setup when a custom bot is installed during authorization', async () => {
    const groupId = (await approveSlack()).memberAccounts?.groupId
    if (!groupId) throw new Error('Approval did not provision organization accounts')
    const pending = new URL((await startSetup(groupId)).authorizationUrl)
    const before = await accountsGroup()
    await installBot(CUSTOM_APP_ID, OTHER_TEAM)
    provideSlackConsent(MEMBER_TEAM)
    await expect(completeSetup(pending.searchParams.get('state') ?? '')).rejects.toThrow(
      'installations changed during authorization'
    )
    expect(await accountsGroup()).toEqual(before)
  })

  it('refuses member setup when another bot joins an installed one during authorization', async () => {
    const groupId = (await approveSlack()).memberAccounts?.groupId
    if (!groupId) throw new Error('Approval did not provision organization accounts')
    await installBot(SHARED_APP_ID, MEMBER_TEAM)
    const pending = new URL(
      (await startSetup(groupId, { appId: SHARED_APP_ID, teamId: MEMBER_TEAM })).authorizationUrl
    )
    expect(pending.searchParams.get('team')).toBe(MEMBER_TEAM)
    const before = await accountsGroup()
    await installBot(CUSTOM_APP_ID, OTHER_TEAM)
    provideSlackConsent(MEMBER_TEAM)
    await expect(completeSetup(pending.searchParams.get('state') ?? '')).rejects.toThrow(
      'installations changed during authorization'
    )
    expect(await accountsGroup()).toEqual(before)
  })

  it('waits for an in-flight bot install before finishing member setup', async () => {
    const groupId = (await approveSlack()).memberAccounts?.groupId
    if (!groupId) throw new Error('Approval did not provision organization accounts')
    const pending = new URL((await startSetup(groupId)).authorizationUrl)
    const before = await accountsGroup()
    provideSlackConsent(MEMBER_TEAM)
    await expect(
      whileOrganizationSlackAppLocked(
        () => completeSetup(pending.searchParams.get('state') ?? ''),
        (tx) => installBot(CUSTOM_APP_ID, OTHER_TEAM, tx)
      )
    ).rejects.toThrow('installations changed during authorization')
    expect(await accountsGroup()).toEqual(before)
  })

  it('waits on the Slack organization lock before removing a Search bot', async () => {
    await approveSlack()
    const installationId = await installBot(SHARED_APP_ID, MEMBER_TEAM)
    await expect(
      whileOrganizationSlackAppLocked(() =>
        removeSlackSearchInstallation.execute({
          principal: principal(),
          input: { organizationId: ids.organization, installationId },
        })
      )
    ).resolves.toEqual({ id: installationId })
  })

  it('refuses member setup when a custom app row holds the shared app ID', async () => {
    const groupId = (await approveSlack()).memberAccounts?.groupId
    if (!groupId) throw new Error('Approval did not provision organization accounts')
    const pending = new URL((await startSetup(groupId)).authorizationUrl)
    const before = await accountsGroup()
    const secret = (await encryptSecret('fixture-custom')).encrypted
    await db.insert(slackApp).values({
      id: SHARED_APP_ID,
      kind: 'custom',
      organizationId: ids.organization,
      clientId: 'fixture-custom-client',
      encryptedClientSecret: secret,
      encryptedSigningSecret: secret,
      revision: generateId(),
    })
    provideSlackConsent(MEMBER_TEAM)
    await expect(completeSetup(pending.searchParams.get('state') ?? '')).rejects.toMatchObject({
      code: 'conflict',
      message: 'This Slack app belongs to another installation owner',
    })
    await expect(startSetup(groupId)).rejects.toThrow('belongs to another installation owner')
    expect(await accountsGroup()).toEqual(before)
    const [row] = await db.select().from(slackApp).where(eq(slackApp.id, SHARED_APP_ID))
    expect(row).toMatchObject({ kind: 'custom', organizationId: ids.organization })
  })

  it('reports a custom-app member setup and keeps it off the shared-app path', async () => {
    const groupId = (await approveSlack()).memberAccounts?.groupId
    if (!groupId) throw new Error('Approval did not provision organization accounts')
    const scopes = [...SLACK_SEARCH_USER_SCOPES]
    await db
      .update(credentialGroup)
      .set({
        options: [
          {
            id: generateId(),
            provider: 'slack',
            label: 'Slack',
            authorizationAppId: `slack:${CUSTOM_APP_ID}:${OTHER_TEAM}`,
            requiredScopes: scopes,
            scopeVersion: credentialGroupScopePolicyVersion(scopes),
            required: false,
            status: 'active',
          },
        ],
        encryptedProviderConfiguration: await encryptCredentialGroupProviderConfiguration({
          ...emptyCredentialGroupProviderConfiguration(),
          slack: {
            source: 'slack_app',
            appId: CUSTOM_APP_ID,
            teamId: OTHER_TEAM,
            scopes,
            verifiedAt: new Date().toISOString(),
          },
        }),
      })
      .where(eq(credentialGroup.id, groupId))
    await expect(
      listSlackSearchInstallations.execute({
        principal: principal(),
        input: { organizationId: ids.organization },
      })
    ).resolves.toMatchObject({ memberAppKind: 'custom', installations: [] })
    await expect(startSetup(groupId)).rejects.toThrow('Remove the existing Slack setup')
  })

  it('revokes shared-app member grants in every organization when a workspace has no bot', async () => {
    const groupId = (await approveSlack()).memberAccounts?.groupId
    if (!groupId) throw new Error('Approval did not provision organization accounts')
    const { id: otherGroupId } = await db.transaction((tx) =>
      createOrganizationAccountsGroup(tx, ids.otherOrganization, ids.owner)
    )
    const enrollment = generateId()
    const otherEnrollment = generateId()
    await db.insert(credentialGroupEnrollment).values(
      [
        { id: enrollment, credentialGroupId: groupId },
        { id: otherEnrollment, credentialGroupId: otherGroupId },
      ].map((binding) => ({
        ...binding,
        userId: ids.owner,
        email: `${ids.owner}@fixture.test`,
        status: 'completed' as const,
        invitationTokenHash: sha256Hex(generateId()),
        invitationExpiresAt: new Date(Date.now() + 60_000),
        invitedAt: new Date(),
      }))
    )
    const grantedAt = new Date(Date.now() - 60_000)
    const encryptedOauthTokenSet = await encryptManagedOAuthTokenSet({ accessToken: 'xoxp-member' })
    const grants = [
      { subject: 'UREVOKED', team: MEMBER_TEAM, organizationId: ids.organization, enrollment },
      { subject: 'UKEPT', team: MEMBER_TEAM, organizationId: ids.organization, enrollment },
      { subject: 'UREVOKED', team: OTHER_TEAM, organizationId: ids.organization, enrollment },
      {
        subject: 'UREVOKED',
        team: MEMBER_TEAM,
        organizationId: ids.otherOrganization,
        enrollment: otherEnrollment,
      },
    ].map(({ subject, team, organizationId, enrollment: credentialGroupEnrollmentId }) => ({
      id: generateId(),
      organizationId,
      type: 'managed_oauth' as const,
      providerId: 'slack',
      displayName: subject,
      createdBy: ids.owner,
      authorizationAppId: `slack:${SHARED_APP_ID}:${team}`,
      providerSubjectId: subject,
      credentialGroupEnrollmentId,
      credentialGroupOptionId: generateId(),
      managedOauthScopeVersion: 1,
      managedOauthStatus: 'active' as const,
      grantedScopes: [...SLACK_SEARCH_USER_SCOPES],
      encryptedOauthTokenSet,
      grantedAt,
    }))
    await db.insert(credential).values(grants)
    const shared = getSharedSlackSearchAppConfiguration()
    if (!shared) throw new Error('Shared Slack app fixture is not configured')

    await revokeSlackSearchAccess.execute({
      principal: {
        kind: 'slack_app',
        appId: SHARED_APP_ID,
        appRevision: shared.revision,
        receivedAt: new Date(),
      },
      input: {
        type: 'event_callback',
        api_app_id: SHARED_APP_ID,
        team_id: MEMBER_TEAM,
        event_id: 'EvFixture',
        event_time: Math.floor(Date.now() / 1000),
        event: { type: 'tokens_revoked', tokens: { oauth: ['UREVOKED'] } },
      },
    })

    const rows = await db
      .select({ id: credential.id, status: credential.managedOauthStatus })
      .from(credential)
      .where(
        inArray(
          credential.id,
          grants.map((grant) => grant.id)
        )
      )
    expect(new Map(rows.map((row) => [row.id, row.status]))).toEqual(
      new Map([
        [grants[0].id, 'needs_reauth'],
        [grants[1].id, 'active'],
        [grants[2].id, 'active'],
        [grants[3].id, 'needs_reauth'],
      ])
    )
  })
})
