import {
  foldedEmail,
  member,
  peopleDirectoryStage,
  scimConnection,
  scimUser,
  user,
} from '@sim/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { PEOPLE_IMPORT_MAX_ROWS } from '@/lib/api/contracts/people'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import { DIRECTORY_TEXT_MAX_LENGTH, PROFILE_TEXT_MAX_LENGTH } from '@/lib/people/validation'
import { isScimEntitledForOrganization } from '@/ee/scim/lib/entitlement'

/** One character beyond a valid SCIM resource ID keeps oversized PATCH values unresolved. */
const UNRESOLVED_MANAGER_LENGTH = 257

function projectedPeople(
  tx: DbTransaction,
  organizationId: string,
  connectionId: string,
  memberOnly: boolean
) {
  const max = PROFILE_TEXT_MAX_LENGTH + 1
  return tx
    .select({
      id: scimUser.id,
      email: sql<string>`left(${foldedEmail(user.email)},321)`,
      name: sql<string>`left(coalesce(nullif(case when ${scimUser.attributes}->>'displayNameSource' = 'provider'
      then ${scimUser.attributes}->>'displayName' end,''),nullif(${scimUser.attributes} #>> '{name,formatted}',''),${user.name}),512)`,
      location: memberOnly
        ? sql<null>`null`
        : sql<string | null>`(select left(coalesce(
        nullif(concat_ws(', ',nullif(address->>'locality',''),nullif(address->>'region',''),nullif(address->>'country','')),''),
        nullif(address->>'formatted','')), ${max})
      from jsonb_array_elements(case when jsonb_typeof(${scimUser.attributes} #> '{extra,addresses}')='array'
        then ${scimUser.attributes} #> '{extra,addresses}' else '[]'::jsonb end) with ordinality as a(address,idx)
      where lower(address->>'type')='work' order by case when address->>'primary'='true' then 0 else 1 end, idx limit 1)`,
      title: sql<string | null>`(select left(trim(entry.value #>> '{}'),${max})
      from jsonb_each(${scimUser.attributes}->'extra') entry
      where lower(entry.key)='title' and jsonb_typeof(entry.value)='string' order by entry.key limit 1)`,
      department: sql<
        string | null
      >`left(trim(${scimUser.attributes} #>> '{enterprise,department}'),${memberOnly ? max : DIRECTORY_TEXT_MAX_LENGTH + 1})`,
      manager: sql<
        string | null
      >`left(${scimUser.attributes} #>> '{enterprise,manager,value}',${UNRESOLVED_MANAGER_LENGTH})`,
    })
    .from(scimUser)
    .innerJoin(user, eq(user.id, scimUser.userId))
    .where(
      and(
        eq(scimUser.connectionId, connectionId),
        eq(scimUser.active, true),
        isNull(user.suspendedAt),
        memberOnly
          ? sql`exists(select 1 from ${member} where ${member.userId}=${scimUser.userId} and ${member.organizationId}=${organizationId})`
          : undefined
      )
    )
}

export async function readProvisionedProfiles(
  tx: DbTransaction,
  organizationId: string,
  apply: boolean
) {
  const connectionQuery = tx
    .select({ id: scimConnection.id })
    .from(scimConnection)
    .where(
      and(eq(scimConnection.organizationId, organizationId), eq(scimConnection.status, 'active'))
    )
  const [connection] = await (apply ? connectionQuery.for('share') : connectionQuery)
  if (!connection)
    throw new OrchestrationError(
      apply ? 'conflict' : 'validation',
      apply
        ? 'The provisioning connection is no longer active. Reconnect the directory and preview the import again.'
        : 'Enable directory provisioning before importing profiles'
    )
  const profiles = await projectedPeople(tx, organizationId, connection.id, true)
    .orderBy(scimUser.orderKey, scimUser.id)
    .limit(PEOPLE_IMPORT_MAX_ROWS + 1)
  if (profiles.length > PEOPLE_IMPORT_MAX_ROWS)
    throw new OrchestrationError(
      'validation',
      'One-time imports support up to 10,000 people. Use Directory sync for a larger directory.'
    )
  const emails = new Map(profiles.map((profile) => [profile.id, profile.email]))
  const rows = profiles.map((profile) => {
    const row: Record<string, string> = { email: profile.email }
    if (profile.title?.trim()) row.title = profile.title
    if (profile.department?.trim()) row.department = profile.department
    if (profile.manager)
      row.managerEmail = emails.get(profile.manager) ?? '(unavailable in this directory)'
    return row
  })
  return {
    rows,
    headers: ['email', 'title', 'department', 'managerEmail'],
    sourceId: connection.id,
  }
}

/** Holds provisioning status through publication; null means an administrator paused the source. */
export async function stageScimDirectory(
  tx: DbTransaction,
  organizationId: string,
  runId: string,
  expectedConnectionId: string
): Promise<number | null> {
  const [connection] = await tx
    .select({ status: scimConnection.status })
    .from(scimConnection)
    .where(
      and(
        eq(scimConnection.id, expectedConnectionId),
        eq(scimConnection.organizationId, organizationId)
      )
    )
    .for('share')
  if (!connection || (connection.status !== 'active' && connection.status !== 'disabled'))
    throw new OrchestrationError(
      'conflict',
      'The provisioning connection changed. Reconnect the directory.'
    )
  if (connection.status === 'disabled') return null
  if (!(await isScimEntitledForOrganization(organizationId, tx)))
    throw new OrchestrationError(
      'forbidden',
      'Directory provisioning is unavailable for this organization.'
    )
  const source = projectedPeople(tx, organizationId, expectedConnectionId, false)
  const [result] = await tx.execute<{
    complete: boolean
    oversized: boolean
    total: string
  }>(sql`
    WITH source(external_id,email,name,location,title,department,manager_external_id) AS (${source}),
    staged AS (
      INSERT INTO ${peopleDirectoryStage} (organization_id,run_id,external_id,proposed_id,email,name,title,department,location,manager_external_id,reports_complete)
      SELECT ${organizationId},${runId},external_id,gen_random_uuid()::text,email,
             coalesce(nullif(btrim(name),''),email),nullif(title,''),nullif(department,''),nullif(location,''),nullif(manager_external_id,''),true
      FROM source WHERE char_length(external_id) BETWEEN 1 AND 512 AND char_length(email) <= 320 AND email ~ ${z.regexes.email.source}
      ON CONFLICT DO NOTHING RETURNING 1
    ), counts AS (SELECT (SELECT count(*) FROM source) AS expected,(SELECT count(*) FROM staged) AS actual)
    SELECT expected=actual AS complete, actual::text AS total,
      EXISTS (SELECT 1 FROM source WHERE char_length(department) > ${DIRECTORY_TEXT_MAX_LENGTH}) AS oversized FROM counts
  `)
  if (result?.oversized)
    throw new OrchestrationError(
      'validation',
      `A SCIM department exceeds ${DIRECTORY_TEXT_MAX_LENGTH} characters. Shorten it in the directory and sync again.`
    )
  if (!result?.complete)
    throw new OrchestrationError(
      'validation',
      'Each directory user needs a unique ID and valid, unique email. Correct the source and sync again.'
    )
  return Number(result.total)
}
