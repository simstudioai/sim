import { db } from '@sim/db'
import {
  knowledgeConnectorPermissionImportGrant as grants,
  knowledgeConnectorPermissionImportIdentity as identities,
  knowledgeConnectorPermissionImport as imports,
} from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { isPlainRecord } from '@sim/utils/object'
import { and, eq, sql } from 'drizzle-orm'
import { permissionImportManifestSchema } from '@/lib/api/contracts/v2/source-permission-imports'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import {
  PERMISSION_IMPORT_MAX_BYTES,
  PERMISSION_IMPORT_PART_MAX_BYTES,
  PERMISSION_IMPORT_PART_MAX_ROWS,
} from '@/lib/knowledge/connectors/permission-import-limits'
import {
  GitLabCsvValidationError,
  parseGitLabCsvPart,
} from '@/connectors/gitlab/permission-config/parser'
import { readGitLabPermissionMetadata } from '@/connectors/gitlab/permission-config/repository'
import type { GitLabCsvKind } from '@/connectors/gitlab/permission-config/types'

type PermissionImportRecord = typeof imports.$inferSelect

/** The caller has already locked and authorized this import and its canonical source. */
export async function appendPermissionImportPart(
  tx: DbTransaction,
  record: PermissionImportRecord,
  input: { partNumber: number; field: GitLabCsvKind; content: string }
): Promise<{ nextPart: number }> {
  const manifest = permissionImportManifestSchema.parse(record.manifest)
  const digest = sha256Hex(`${input.field}\n${input.content}`)
  if (input.partNumber < record.partDigests.length) {
    if (record.partDigests[input.partNumber] !== digest)
      throw new OrchestrationError(
        'conflict',
        'This part was already uploaded with different contents.'
      )
    return { nextPart: record.partDigests.length }
  }
  if (record.completedRevision !== null || input.partNumber !== record.partDigests.length)
    throw new OrchestrationError('conflict', 'Upload parts in order before completing the import.')
  const expectedField =
    input.partNumber < manifest.userMapping.parts ? 'userMapping' : 'projectPermissions'
  if (
    input.partNumber >= manifest.userMapping.parts + manifest.projectPermissions.parts ||
    input.field !== expectedField
  )
    throw new OrchestrationError('conflict', 'The part does not match the import manifest.')
  const bytes = Buffer.byteLength(input.content)
  if (
    bytes > PERMISSION_IMPORT_PART_MAX_BYTES ||
    record.bytes + bytes > PERMISSION_IMPORT_MAX_BYTES
  )
    throw new OrchestrationError('validation', 'The permission import exceeds its byte limit.')
  let parsed: ReturnType<typeof parseGitLabCsvPart>
  try {
    parsed = parseGitLabCsvPart(
      { filename: manifest[input.field].filename, content: input.content },
      input.field,
      {
        bytes: PERMISSION_IMPORT_PART_MAX_BYTES,
        rows: PERMISSION_IMPORT_PART_MAX_ROWS,
      }
    )
  } catch (error) {
    if (error instanceof GitLabCsvValidationError)
      throw new OrchestrationError('validation', error.message)
    throw error
  }
  const userRows = record.userRows + (input.field === 'userMapping' ? parsed.recordCount : 0)
  const projectRows =
    record.projectRows + (input.field === 'projectPermissions' ? parsed.recordCount : 0)
  if (
    userRows > manifest.userMapping.rowCount ||
    projectRows > manifest.projectPermissions.rowCount
  )
    throw new OrchestrationError(
      'validation',
      'The CSV contains more rows than declared in the import manifest.'
    )
  if (input.field === 'projectPermissions' && userRows !== manifest.userMapping.rowCount)
    throw new OrchestrationError(
      'validation',
      'Upload the complete user mapping before project permissions.'
    )

  try {
    const groupScoped = isPlainRecord(record.metadata.group)
    const projectGroups = new Map<string, string>()
    if (input.field === 'projectPermissions') {
      if (groupScoped) {
        const paths = [...new Set(parsed.rows.map(([path]) => path))]
        const projects = await tx.execute<{ path: string; id: number }>(sql`
        select project.path, project.id from ${imports}
        cross join lateral jsonb_to_recordset(${imports.metadata} -> 'projects') project(id bigint, path text)
        where ${imports.id} = ${record.id}
          and project.path in (select jsonb_array_elements_text(${JSON.stringify(paths)}::jsonb))`)
        for (const project of projects) projectGroups.set(project.path, `project:${project.id}`)
        if (paths.some((path) => !projectGroups.has(path)))
          throw new OrchestrationError(
            'validation',
            'The CSV contains projects outside the configured GitLab group.'
          )
      } else if (typeof record.metadata.projectPath === 'string') {
        projectGroups.set(record.metadata.projectPath, 'project')
      } else {
        throw new OrchestrationError('internal', 'Could not read the stored source scope.')
      }
    }
    if (input.field === 'userMapping') {
      const rows = parsed.rows.map(([userId, email]) => ({ userId, subjectToken: `u:${email}` }))
      const [conflict] = await tx.execute<{ conflict: boolean }>(sql`
        select exists (
          select 1 from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as incoming("userId" text, "subjectToken" text)
          join ${identities} saved on saved.import_id = ${record.id}
            and (saved.user_id = incoming."userId" or saved.subject_token = incoming."subjectToken")
          where saved.user_id <> incoming."userId" or saved.subject_token <> incoming."subjectToken"
        ) as conflict`)
      if (conflict?.conflict)
        throw new OrchestrationError(
          'validation',
          'User mapping conflicts with another identity in this import.'
        )
      await tx
        .insert(identities)
        .values(rows.map((row) => ({ importId: record.id, ...row })))
        .onConflictDoNothing()
    } else {
      await tx
        .insert(grants)
        .values(
          parsed.rows.map(([projectPath, userId]) => ({
            importId: record.id,
            projectPath,
            userId,
            groupKey: projectGroups.get(projectPath) ?? null,
          }))
        )
        .onConflictDoNothing()
    }
    await tx
      .update(imports)
      .set({
        partDigests: [...record.partDigests, digest],
        userRows,
        projectRows,
        bytes: record.bytes + bytes,
      })
      .where(eq(imports.id, record.id))
  } catch (error) {
    if (error instanceof OrchestrationError) throw error
    throw new OrchestrationError(
      'internal',
      'Could not save this permission import part. Retry the same part.'
    )
  }
  return { nextPart: record.partDigests.length + 1 }
}

/** Checks canonical project identities using a bounded catalog rather than loading uploaded grants. */
export async function validatePermissionImportScope(
  record: PermissionImportRecord,
  metadata: ReturnType<typeof readGitLabPermissionMetadata>
): Promise<void> {
  const previous = readGitLabPermissionMetadata(record.metadata)
  if (
    previous.host !== metadata.host ||
    'group' in previous !== 'group' in metadata ||
    ('group' in previous && 'group' in metadata
      ? previous.group.id !== metadata.group.id
      : !('group' in previous) &&
        !('group' in metadata) &&
        previous.projectId !== metadata.projectId)
  )
    throw new OrchestrationError(
      'validation',
      'The GitLab source scope changed. Start a new permission import.'
    )
  if ('group' in metadata) {
    const catalog = JSON.stringify(metadata.projects)
    const [invalid] = await db
      .execute<{ invalid: boolean }>(sql`
      select exists (
        select 1 from ${grants} grant_row
        left join jsonb_to_recordset(${catalog}::jsonb) project(id bigint, path text)
          on project.path = grant_row.project_path and 'project:' || project.id::text = grant_row.group_key
        where grant_row.import_id = ${record.id} and project.id is null
      ) as invalid`)
      .catch(() => {
        throw new OrchestrationError(
          'internal',
          'Could not validate the permission import. Retry completion.'
        )
      })
    if (invalid?.invalid)
      throw new OrchestrationError(
        'validation',
        'The CSV contains projects outside the configured GitLab group or with changed identities. Export a new snapshot.'
      )
  }
}

/** Counts are small scalar results even when the import holds millions of rows. */
export async function permissionImportSummaries(record: PermissionImportRecord) {
  const manifest = permissionImportManifestSchema.parse(record.manifest)
  const [users, projects] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::integer` })
      .from(identities)
      .where(eq(identities.importId, record.id)),
    db
      .select({ count: sql<number>`count(*)::integer` })
      .from(grants)
      .where(eq(grants.importId, record.id)),
  ])
  const uploadedAt = new Date().toISOString()
  return {
    userMapping: {
      filename: manifest.userMapping.filename,
      uploadedAt,
      rowCount: users[0]?.count ?? 0,
    },
    projectPermissions: {
      filename: manifest.projectPermissions.filename,
      uploadedAt,
      rowCount: projects[0]?.count ?? 0,
    },
  }
}

/** Only canonical source ownership can make a generation available to application code. */
export async function loadPermissionImport(importId: string, connectorId: string) {
  const [record] = await db
    .select()
    .from(imports)
    .where(and(eq(imports.id, importId), eq(imports.connectorId, connectorId)))
    .limit(1)
  return record ?? null
}
