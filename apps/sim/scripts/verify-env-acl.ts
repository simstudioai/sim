/**
 * Live-Postgres verification for the non-secret env-var ACL bypass.
 *
 * `getAccessibleEnvCredentials` gains a clause letting `env_workspace` rows
 * marked `variable` skip the per-key credential ACL. That clause is the single
 * line separating "workspace member" from "can read this value", and the unit
 * suites all run against a mocked `@sim/db`, so nothing else exercises the
 * actual SQL. This seeds a real workspace and asserts what the query must
 * REFUSE, not just what it allows.
 *
 * Run against a throwaway database:
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/simstudio_acl_test \
 *     bun run apps/sim/scripts/verify-env-acl.ts
 */
import { db } from '@sim/db'
import { credential, credentialMember, permissions, user, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import { getAccessibleEnvCredentials } from '@/lib/credentials/environment'

const ids = {
  owner: generateId(),
  member: generateId(),
  outsider: generateId(),
  wsA: generateId(),
  wsB: generateId(),
}

let failures = 0

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log(`  PASS  ${label}`)
    return
  }
  failures++
  console.log(`  FAIL  ${label}\n        expected ${e}\n        actual   ${a}`)
}

async function seedUser(id: string, email: string) {
  await db.insert(user).values({
    id,
    name: email,
    email,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

async function seedWorkspace(id: string, name: string, ownerId: string) {
  await db.insert(workspace).values({
    id,
    name,
    ownerId,
    billedAccountUserId: ownerId,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

async function grant(
  userId: string,
  workspaceId: string,
  permissionType: 'read' | 'write' | 'admin'
) {
  await db.insert(permissions).values({
    id: generateId(),
    userId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

async function seedEnvCredential(opts: {
  workspaceId: string
  envKey: string
  type: 'env_workspace' | 'env_personal'
  visibility: 'secret' | 'variable'
  createdBy: string
  envOwnerUserId?: string
}) {
  const id = generateId()
  await db.insert(credential).values({
    id,
    workspaceId: opts.workspaceId,
    type: opts.type,
    displayName: opts.envKey,
    envKey: opts.envKey,
    envVisibility: opts.visibility,
    ...(opts.envOwnerUserId ? { envOwnerUserId: opts.envOwnerUserId } : {}),
    createdBy: opts.createdBy,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return id
}

async function keysFor(workspaceId: string, userId: string, isWorkspaceAdmin: boolean) {
  const rows = await getAccessibleEnvCredentials(workspaceId, userId, { isWorkspaceAdmin })
  return rows.map((r) => r.envKey).sort()
}

async function main() {
  console.log('Seeding...')
  await seedUser(ids.owner, 'owner@test.local')
  await seedUser(ids.member, 'member@test.local')
  await seedUser(ids.outsider, 'outsider@test.local')
  await seedWorkspace(ids.wsA, 'Workspace A', ids.owner)
  await seedWorkspace(ids.wsB, 'Workspace B', ids.owner)
  await grant(ids.owner, ids.wsA, 'admin')
  await grant(ids.member, ids.wsA, 'read')
  await grant(ids.outsider, ids.wsB, 'admin')

  // Workspace A: a secret nobody is a member of, and a non-secret variable.
  await seedEnvCredential({
    workspaceId: ids.wsA,
    envKey: 'STRIPE_KEY',
    type: 'env_workspace',
    visibility: 'secret',
    createdBy: ids.owner,
  })
  await seedEnvCredential({
    workspaceId: ids.wsA,
    envKey: 'SUPPORT_EMAIL',
    type: 'env_workspace',
    visibility: 'variable',
    createdBy: ids.owner,
  })
  // A personal secret owned by the OWNER, shared into workspace A.
  await seedEnvCredential({
    workspaceId: ids.wsA,
    envKey: 'OWNER_PERSONAL',
    type: 'env_personal',
    visibility: 'secret',
    createdBy: ids.owner,
    envOwnerUserId: ids.owner,
  })
  // Workspace B has a same-named variable, to prove workspace isolation holds.
  await seedEnvCredential({
    workspaceId: ids.wsB,
    envKey: 'SUPPORT_EMAIL',
    type: 'env_workspace',
    visibility: 'variable',
    createdBy: ids.outsider,
  })

  console.log('\nWhat the bypass must ALLOW:')
  check(
    'read-only member with no credential membership sees the variable',
    await keysFor(ids.wsA, ids.member, false),
    ['SUPPORT_EMAIL']
  )

  console.log('\nWhat the bypass must REFUSE:')
  check(
    'that same member does NOT see the workspace secret (bypass did not widen secrets)',
    (await keysFor(ids.wsA, ids.member, false)).includes('STRIPE_KEY'),
    false
  )
  check(
    "member does NOT see another user's personal secret",
    (await keysFor(ids.wsA, ids.member, false)).includes('OWNER_PERSONAL'),
    false
  )
  check(
    "workspace B's variable does not leak into workspace A",
    await keysFor(ids.wsA, ids.outsider, false),
    []
  )
  check(
    'a non-member of workspace A sees nothing there, variable included',
    await keysFor(ids.wsA, ids.outsider, false),
    []
  )

  console.log('\nAdmin path unchanged:')
  check(
    'workspace admin still sees every workspace key plus their own personal',
    await keysFor(ids.wsA, ids.owner, true),
    ['OWNER_PERSONAL', 'STRIPE_KEY', 'SUPPORT_EMAIL']
  )

  console.log('\nCredential membership still grants a secret:')
  const [secretRow] = await db
    .select({ id: credential.id })
    .from(credential)
    .where(eq(credential.envKey, 'STRIPE_KEY'))
    .limit(1)
  await db.insert(credentialMember).values({
    id: generateId(),
    credentialId: secretRow.id,
    userId: ids.member,
    role: 'member',
    status: 'active',
    joinedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  check(
    'member with an active membership now sees the secret too',
    await keysFor(ids.wsA, ids.member, false),
    ['STRIPE_KEY', 'SUPPORT_EMAIL']
  )

  console.log('\nDB constraint — a personal secret can never be non-secret:')
  let constraintHeld = false
  let constraintName = ''
  try {
    await db.execute(sql`
      INSERT INTO credential (id, workspace_id, type, display_name, env_key, env_owner_user_id, env_visibility, created_by, created_at, updated_at)
      VALUES (${generateId()}, ${ids.wsA}, 'env_personal', 'SNEAKY', 'SNEAKY', ${ids.member}, 'variable', ${ids.owner}, now(), now())
    `)
  } catch (error) {
    constraintHeld = true
    // Drizzle wraps the driver error, so the constraint name is on `cause`.
    const e = error as { cause?: { constraint_name?: string } }
    constraintName = String(e.cause?.constraint_name ?? '')
  }
  check('insert rejected', constraintHeld, true)
  check(
    'rejected by the intended constraint',
    constraintName,
    'credential_env_visibility_scope_check'
  )

  let updateHeld = false
  try {
    await db.execute(sql`
      UPDATE credential SET env_visibility = 'variable' WHERE env_key = 'OWNER_PERSONAL'
    `)
  } catch {
    updateHeld = true
  }
  check('UPDATE to variable on an existing personal secret also rejected', updateHeld, true)

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
