/**
 * Joining a team never fails over what a personal organization holds, against real PostgreSQL.
 * Retiring the personal organization refuses the join if anything would cascade away with it, so
 * every organization-scoped table must be moved, keyed, dropped as meaningless, or refused on a
 * personal organization in the first place. Failure modes: a row in an unclassified table (a Search
 * MCP activity log, an access-request opt-out, a pending workspace invitation, an external
 * directory mirror) locking its owner out of every team; and team-only configuration (BYOK keys,
 * per-member usage limits, Generic Secrets) being writable on a personal organization, where it
 * would do the same.
 */
import { db } from '@sim/db'
import {
  copilotChats,
  invitation,
  knowledgeExternalDirectory,
  member,
  organization,
  organizationAccessRequestSettings,
  organizationBYOKKeys,
  organizationSearchMcpInvocation,
  organizationSecretSource,
  user,
  userStats,
} from '@sim/db/schema'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { createOrganizationWithOwner } from '@/lib/billing/organizations/create-organization'
import { setOrgMemberUsageLimit } from '@/lib/billing/organizations/member-limits'
import {
  addUserToOrganization,
  ensureUserInOrganizationTx,
} from '@/lib/billing/organizations/membership'
import { createPersonalOrganization } from '@/lib/organizations/provision-personal'

const userIds: string[] = []

/** `db:push` never installs the migration-only triggers that refuse team-only rows. */
const [{ migrated }] = await db.execute<{ migrated: boolean }>(sql`
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'organization_byok_keys_team_only'
  ) AS migrated
`)

async function createUser(): Promise<string> {
  const id = `join-user-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Join Test',
    email: `${id}@join.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({ id: generateId(), userId: id, storageUsedBytes: 0 })
  userIds.push(id)
  return id
}

async function personalOrganizationOf(userId: string): Promise<string> {
  const organizationId = await createPersonalOrganization(userId)
  if (!organizationId) throw new Error('expected a personal organization')
  return organizationId
}

async function team(ownerId: string): Promise<string> {
  const { organizationId } = await createOrganizationWithOwner({
    ownerUserId: ownerId,
    name: 'Team',
    slug: `team-${generateId()}`.toLowerCase(),
  })
  return organizationId
}

async function postgresErrorCode(write: Promise<unknown>): Promise<string | undefined> {
  try {
    await write
  } catch (error) {
    return getPostgresErrorCode(error)
  }
  return undefined
}

afterAll(async () => {
  if (userIds.length === 0) return
  const organizations = await db
    .select({ id: member.organizationId })
    .from(member)
    .where(inArray(member.userId, userIds))
  if (organizations.length > 0) {
    await db.delete(organization).where(
      inArray(
        organization.id,
        organizations.map((row) => row.id)
      )
    )
  }
  await db.delete(user).where(inArray(user.id, userIds))
})

describe('joining a team from a personal organization', () => {
  it('takes along or drops every row its personal organization held, and joins', async () => {
    const teamOwnerId = await createUser()
    const joinerId = await createUser()
    const teamId = await team(teamOwnerId)
    const personalId = await personalOrganizationOf(joinerId)
    await db.insert(organizationSearchMcpInvocation).values({
      id: generateId(),
      organizationId: personalId,
      userId: joinerId,
      authKind: 'personal_api_key',
      toolName: 'search',
      outcome: 'success',
      durationMs: 12,
    })
    await db
      .insert(organizationAccessRequestSettings)
      .values({ organizationId: personalId, allowRequests: false })
    const workspaceInvitationId = generateId()
    await db.insert(invitation).values({
      id: workspaceInvitationId,
      kind: 'workspace',
      email: 'guest@join.test',
      inviterId: joinerId,
      organizationId: personalId,
      role: 'member',
      token: generateId(),
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    await db.insert(knowledgeExternalDirectory).values({
      organizationId: personalId,
      providerId: 'google-drive',
      tenantId: `tenant-${generateId()}`,
    })

    const joined = await addUserToOrganization({
      userId: joinerId,
      organizationId: teamId,
      role: 'member',
      skipBillingLogic: true,
      skipSeatValidation: true,
    })

    expect(joined).toMatchObject({ success: true })
    const [pendingInvitation] = await db
      .select({ organizationId: invitation.organizationId, status: invitation.status })
      .from(invitation)
      .where(eq(invitation.id, workspaceInvitationId))
    expect(pendingInvitation).toEqual({ organizationId: null, status: 'pending' })
    const directories = await db
      .select({ organizationId: knowledgeExternalDirectory.organizationId })
      .from(knowledgeExternalDirectory)
      .where(inArray(knowledgeExternalDirectory.organizationId, [personalId, teamId]))
    expect(directories).toEqual([])
  })
})

/** Resolves once some backend sits waiting on a row lock, i.e. the racing statement is parked. */
async function waitForLockWaiter(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const [{ waiting }] = await db.execute<{ waiting: number }>(sql`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `)
    if (waiting > 0) return
    await sleep(25)
  }
  throw new Error('no statement ever waited on a lock')
}

describe('joining a team while the personal organization is still being written to', () => {
  it('keeps a chat committed mid-join instead of cascading it away with the organization', async () => {
    const joinerId = await createUser()
    const teamId = await team(await createUser())
    const personalId = await personalOrganizationOf(joinerId)
    const chatId = generateId()

    let commitChat: () => void = () => undefined
    const chatHeld = new Promise<void>((resolve) => {
      commitChat = resolve
    })
    let chatInserted: () => void = () => undefined
    const inserted = new Promise<void>((resolve) => {
      chatInserted = resolve
    })
    /** Another tab's chat insert: holds `FOR KEY SHARE` on the personal organization until commit. */
    const otherTab = db.transaction(async (tx) => {
      await tx
        .insert(copilotChats)
        .values({ id: chatId, userId: joinerId, organizationId: personalId })
      chatInserted()
      await chatHeld
    })
    await inserted

    const join = addUserToOrganization({
      userId: joinerId,
      organizationId: teamId,
      role: 'member',
      skipBillingLogic: true,
      skipSeatValidation: true,
    })
    await waitForLockWaiter()
    commitChat()
    await otherTab

    expect(await join).toMatchObject({ success: true })
    const chats = await db
      .select({ organizationId: copilotChats.organizationId })
      .from(copilotChats)
      .where(eq(copilotChats.id, chatId))
    expect(chats).toEqual([{ organizationId: teamId }])
    const retired = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, personalId))
    expect(retired).toEqual([])
  })

  it('admits a user accepted by two teams at once to exactly one, moving everything once', async () => {
    const joinerId = await createUser()
    const firstTeamId = await team(await createUser())
    const secondTeamId = await team(await createUser())
    const personalId = await personalOrganizationOf(joinerId)
    await db
      .insert(copilotChats)
      .values({ id: generateId(), userId: joinerId, organizationId: personalId })

    const results = await Promise.all(
      [firstTeamId, secondTeamId].map((organizationId) =>
        addUserToOrganization({
          userId: joinerId,
          organizationId,
          role: 'member',
          skipBillingLogic: true,
          skipSeatValidation: true,
        })
      )
    )

    expect(results.filter((result) => result.success)).toHaveLength(1)
    const memberships = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, joinerId))
    expect(memberships).toHaveLength(1)
    expect([firstTeamId, secondTeamId]).toContain(memberships[0].organizationId)
    const chats = await db
      .select({ organizationId: copilotChats.organizationId })
      .from(copilotChats)
      .where(eq(copilotChats.userId, joinerId))
    expect(chats).toEqual([{ organizationId: memberships[0].organizationId }])
    const personal = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, personalId))
    expect(personal).toEqual([])
  })

  it('leaves a user who joins a team during first-page provisioning in that team alone', async () => {
    const joinerId = await createUser()
    const teamId = await team(await createUser())

    const [joined] = await Promise.all([
      addUserToOrganization({
        userId: joinerId,
        organizationId: teamId,
        role: 'member',
        skipBillingLogic: true,
        skipSeatValidation: true,
      }),
      createPersonalOrganization(joinerId),
    ])

    expect(joined).toMatchObject({ success: true })
    const memberships = await db
      .select({ organizationId: member.organizationId, kind: organization.kind })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(eq(member.userId, joinerId))
    expect(memberships).toEqual([{ organizationId: teamId, kind: 'team' }])
    const orphans = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, `personal-${joinerId.toLowerCase()}`))
    expect(orphans).toEqual([])
  })
})

describe('team-only configuration on a personal organization', () => {
  it('refuses per-member usage limits with a typed error', async () => {
    const ownerId = await createUser()
    const personalId = await personalOrganizationOf(ownerId)

    await expect(setOrgMemberUsageLimit(personalId, ownerId, 25, ownerId)).rejects.toMatchObject({
      code: 'forbidden',
      message: 'Only team organizations can use per-member usage limits.',
    })
  })

  it.runIf(migrated)('refuses BYOK keys and Generic Secrets for every writer', async () => {
    const ownerId = await createUser()
    const personalId = await personalOrganizationOf(ownerId)
    const teamId = await team(await createUser())

    expect(
      await postgresErrorCode(
        db.insert(organizationBYOKKeys).values({
          id: generateId(),
          organizationId: personalId,
          providerId: 'openai',
          encryptedApiKey: 'ciphertext',
        })
      )
    ).toBe('23514')
    expect(
      await postgresErrorCode(
        db
          .insert(organizationSecretSource)
          .values({ id: generateId(), organizationId: personalId, mode: 'member' })
      )
    ).toBe('23514')
    expect(
      await postgresErrorCode(
        db
          .insert(organizationSecretSource)
          .values({ id: generateId(), organizationId: teamId, mode: 'member' })
      )
    ).toBeUndefined()
  })

  it.runIf(migrated)(
    'refuses a join over team-only rows written around the guards, naming no table',
    async () => {
      const joinerId = await createUser()
      const teamId = await team(await createUser())
      const personalId = await personalOrganizationOf(joinerId)
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL session_replication_role = replica`)
        await tx.insert(organizationBYOKKeys).values({
          id: generateId(),
          organizationId: personalId,
          providerId: 'openai',
          encryptedApiKey: 'ciphertext',
        })
      })

      await expect(
        db.transaction((tx) =>
          ensureUserInOrganizationTx(tx, {
            userId: joinerId,
            organizationId: teamId,
            role: 'member',
            skipBillingLogic: true,
            skipSeatValidation: true,
          })
        )
      ).rejects.toMatchObject({
        code: 'conflict',
        message:
          "This account's personal organization holds data that cannot move into another organization.",
      })
      const memberships = await db
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, joinerId))
      expect(memberships).toEqual([{ organizationId: personalId }])
    }
  )

  it.runIf(migrated)('leaves no organization-scoped table unclassified', async () => {
    const rows = await db.execute<{ table_name: string }>(sql`
      SELECT DISTINCT c.conrelid::regclass::text AS table_name
      FROM pg_constraint c
      WHERE c.contype = 'f'
        AND c.confrelid = 'organization'::regclass
        AND c.confdeltype = 'c'
        AND NOT EXISTS (
          SELECT 1 FROM pg_trigger t
          JOIN pg_proc p ON p.oid = t.tgfoid
          WHERE t.tgrelid = c.conrelid
            AND p.proname = 'refuse_personal_organization_configuration'
        )
      ORDER BY 1
    `)

    /** Moved, keyed or dropped by `retirePersonalOrganizationTx`; the membership is deleted. */
    expect(rows.map((row) => row.table_name)).toEqual([
      'assistant_tool_permission',
      'copilot_chats',
      'copilot_organization_request_stops',
      'copilot_runs',
      'credential',
      'invitation',
      'knowledge_base',
      'knowledge_connector_member',
      'knowledge_external_directory',
      'knowledge_external_group',
      'mcp_server_oauth',
      'mcp_servers',
      'member',
      'mothership_benchmarks',
      'mothership_memory_selections',
      'mothership_memory_spaces',
      'organization_access_request_settings',
      'organization_search_history',
      'organization_search_mcp_invocation',
      'pending_credential_draft',
      'permission_access_request',
      'sim_link',
      'workspace_files',
    ])
  })
})
