import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { withUtcTimestamps } from '@sim/db/timestamps'
import { generateId } from '@sim/utils/id'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { findAllMembersWorkspaceConflict } from '@/lib/permission-groups/application/group-membership'

/** Exercises the actual PostgreSQL view, including live membership and tenant isolation. */
describe('permission group project scopes', () => {
  const connection = postgres(readTestDatabaseUrl(), withUtcTimestamps({ max: 1, connection: {} }))
  afterAll(async () => connection.end())

  it('inherits future environments, deduplicates explicit links, and excludes foreign or archived scope', async () => {
    const ids = Array.from({ length: 9 }, () => generateId())
    const [actor, org, foreignOrg, project, foreignProject, group, prod, staging, foreignEnv] = ids
    const rollback = new Error('rollback test fixtures')
    await connection
      .begin(async (sql) => {
        await sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
        VALUES (${actor}, 'Scope test', ${`${actor}@example.test`}, true, now(), now())`
        await sql`INSERT INTO organization (id, name, slug) VALUES (${org}, 'Scope test', ${org}), (${foreignOrg}, 'Other test', ${foreignOrg})`
        await sql`INSERT INTO project (id, name, organization_id) VALUES (${project}, 'Scope test', ${org}), (${foreignProject}, 'Other test', ${foreignOrg})`
        await sql`INSERT INTO permission_group (id, organization_id, name, created_by, project_ids)
        VALUES (${group}, ${org}, 'Scope test', ${actor}, ${sql.json([project, foreignProject])}::jsonb)`
        const scope = async () =>
          (
            await sql`SELECT workspace_id FROM permission_group_workspace_scope WHERE permission_group_id = ${group} ORDER BY workspace_id`
          ).map((row) => row.workspace_id)
        expect(await scope()).toEqual([])
        for (const [id, tenant] of [
          [prod, org],
          [staging, org],
          [foreignEnv, foreignOrg],
        ]) {
          await sql`INSERT INTO workspace (id, name, owner_id, billed_account_user_id, organization_id) VALUES (${id}, 'Environment', ${actor}, ${actor}, ${tenant})`
        }
        await sql`INSERT INTO project_workspace (project_id, workspace_id, position) VALUES (${project}, ${prod}, 0)`
        expect(await scope()).toEqual([prod])
        await sql`INSERT INTO project_workspace (project_id, workspace_id, position) VALUES (${project}, ${staging}, 1), (${foreignProject}, ${foreignEnv}, 0)`
        expect(await scope()).toEqual([prod, staging].sort())
        await sql`INSERT INTO permission_group_workspace (id, permission_group_id, workspace_id, organization_id) VALUES (${generateId()}, ${group}, ${prod}, ${org})`
        expect(await scope()).toEqual([prod, staging].sort())
        await sql`UPDATE workspace SET archived_at = now() WHERE id = ${staging}`
        expect(await scope()).toEqual([prod])
        await sql`UPDATE project SET archived_at = now() WHERE id = ${project}`
        expect(await scope()).toEqual([prod])
        throw rollback
      })
      .catch((error) => {
        if (error !== rollback) throw error
      })
  })
  it('detects conflicting project rules even before an environment exists', async () => {
    const [actor, org, project, group] = Array.from({ length: 4 }, () => generateId())
    try {
      await connection`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES (${actor}, 'Scope test', ${`${actor}@example.test`}, true, now(), now())`
      await connection`INSERT INTO organization (id, name, slug) VALUES (${org}, 'Scope test', ${org})`
      await connection`INSERT INTO project (id, name, organization_id) VALUES (${project}, 'Scope test', ${org})`
      await connection`INSERT INTO permission_group (id, organization_id, name, created_by, project_ids) VALUES (${group}, ${org}, 'Existing rule', ${actor}, ${connection.json([project])}::jsonb)`
      const result = await findAllMembersWorkspaceConflict(
        {
          organizationId: org,
          excludeGroupId: generateId(),
          workspaceIds: [],
          projectIds: [project],
        },
        drizzle(connection)
      )
      expect(result?.conflictingGroupId).toBe(group)
      expect(
        await findAllMembersWorkspaceConflict(
          {
            organizationId: org,
            excludeGroupId: generateId(),
            workspaceIds: [],
            projectIds: [generateId()],
          },
          drizzle(connection)
        )
      ).toBeNull()
    } finally {
      await connection`DELETE FROM organization WHERE id = ${org}`
      await connection`DELETE FROM "user" WHERE id = ${actor}`
    }
  })
})
