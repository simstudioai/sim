import { isPlainRecord } from '@sim/utils/object'
import { z } from 'zod'
import { gitLabPermissionSummarySchema } from '@/lib/api/contracts/knowledge/gitlab-permissions'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ConnectorPermissionData,
  loadConnectorPermissionSnapshot,
  readConnectorPermissionMetadata,
} from '@/lib/knowledge/connectors/permission-store'
import {
  GitLabCsvValidationError,
  gitLabCsvSubjects,
  parseGitLabCsv,
} from '@/connectors/gitlab/permission-config/parser'
import {
  GITLAB_CSV_MAX_ROWS,
  type GitLabPermissionInput,
  type GitLabPermissionSummary,
  setGitLabCsvContext,
} from '@/connectors/gitlab/permission-config/types'

const metadataSchema = gitLabPermissionSummarySchema
  .omit({ provider: true, revision: true })
  .extend({
    host: z.string().min(1),
    projectId: z.number().int().positive(),
    projectPath: z.string().min(1),
  })
type RevisionMetadata = z.output<typeof metadataSchema> & { revision: number }
interface StoredRows {
  userMappingRows: [string, string][] | null
  projectPermissionRows: [string, string][] | null
}
type Snapshot = RevisionMetadata & StoredRows

export interface PreparedGitLabPermissions {
  expectedRevision: number
  snapshot: Snapshot
  subjects: string[]
  rewriteAccess: boolean
}

function invalidSnapshot(): never {
  throw new OrchestrationError('internal', 'Could not read the stored GitLab permissions.')
}

/** Validates stored file summaries and the canonical project without loading CSV rows. */
export function readGitLabPermissionMetadata(value: unknown) {
  const parsed = metadataSchema.safeParse(value)
  if (!parsed.success) return invalidSnapshot()
  const result = parsed.data
  if (
    result.mode === 'csv'
      ? !result.userMapping || !result.projectPermissions
      : result.userMapping !== null || result.projectPermissions !== null
  )
    return invalidSnapshot()
  return result
}

/** Validate stored tuples without allocating another copy of a large CSV snapshot. */
function readRows(value: unknown): [string, string][] | null {
  if (value === null) return null
  const isRow = (row: unknown): row is [string, string] =>
    Array.isArray(row) && row.length === 2 && row.every((cell) => typeof cell === 'string')
  if (!Array.isArray(value) || value.length > GITLAB_CSV_MAX_ROWS || !value.every(isRow))
    return invalidSnapshot()
  return value
}

/** Private contents are loaded only when preparing an authorized replacement. */
export async function loadGitLabPermissionSnapshot(connectorId: string): Promise<Snapshot | null> {
  const row = await loadConnectorPermissionSnapshot(connectorId)
  if (!row) return null
  const metadata = readGitLabPermissionMetadata(row.metadata)
  if (!isPlainRecord(row.payload)) return invalidSnapshot()
  const userMappingRows = readRows(row.payload.userMappingRows)
  const projectPermissionRows = readRows(row.payload.projectPermissionRows)
  if (
    metadata.mode === 'csv'
      ? !userMappingRows ||
        !projectPermissionRows ||
        metadata.userMapping?.rowCount !== userMappingRows.length ||
        metadata.projectPermissions?.rowCount !== projectPermissionRows.length
      : userMappingRows !== null || projectPermissionRows !== null
  )
    return invalidSnapshot()
  return {
    revision: row.revision,
    ...metadata,
    userMappingRows,
    projectPermissionRows,
  }
}

export function prepareGitLabPermissions(
  input: GitLabPermissionInput,
  project: { host: string; projectId: number; projectPath: string },
  existing: (RevisionMetadata & Partial<StoredRows>) | null,
  replacing: boolean
): PreparedGitLabPermissions {
  const revision = existing?.revision ?? 0
  if (replacing && input.expectedRevision !== revision) {
    throw new OrchestrationError(
      'conflict',
      'GitLab permissions changed. Reload the connection before saving.'
    )
  }
  if (input.mode === 'administrator' && (input.userMapping || input.projectPermissions)) {
    throw new OrchestrationError('validation', 'CSV uploads require Non-admin token mode.')
  }
  const now = new Date().toISOString()
  const file = (kind: 'userMapping' | 'projectPermissions') => {
    const upload = input[kind]
    if (!upload) {
      const metadata = existing?.mode === 'csv' ? existing[kind] : null
      const rows =
        kind === 'userMapping' ? existing?.userMappingRows : existing?.projectPermissionRows
      return metadata && rows ? { ...metadata, rows } : null
    }
    try {
      return {
        filename: upload.filename.trim(),
        uploadedAt: now,
        rows: parseGitLabCsv(upload, kind),
      }
    } catch (error) {
      if (error instanceof GitLabCsvValidationError)
        throw new OrchestrationError('validation', error.message)
      throw error
    }
  }
  const userMapping = input.mode === 'csv' ? file('userMapping') : null
  const projectPermissions = input.mode === 'csv' ? file('projectPermissions') : null
  if (input.mode === 'csv' && (!userMapping || !projectPermissions)) {
    throw new OrchestrationError('validation', 'Non-admin token mode requires both CSV files.')
  }
  return {
    expectedRevision: revision,
    snapshot: {
      host: project.host,
      projectId: project.projectId,
      projectPath: project.projectPath,
      mode: input.mode,
      revision: revision + 1,
      userMapping: userMapping
        ? {
            filename: userMapping.filename,
            uploadedAt: userMapping.uploadedAt,
            rowCount: userMapping.rows.length,
          }
        : null,
      projectPermissions: projectPermissions
        ? {
            filename: projectPermissions.filename,
            uploadedAt: projectPermissions.uploadedAt,
            rowCount: projectPermissions.rows.length,
          }
        : null,
      userMappingRows: userMapping?.rows ?? null,
      projectPermissionRows: projectPermissions?.rows ?? null,
    },
    subjects:
      userMapping && projectPermissions
        ? gitLabCsvSubjects(userMapping.rows, projectPermissions.rows, project.projectPath)
        : [],
    rewriteAccess:
      replacing &&
      ((existing?.mode ?? 'administrator') !== input.mode ||
        (existing !== null &&
          (existing.host !== project.host || existing.projectId !== project.projectId))),
  }
}

/** Keeps CSV rows in the private payload and stores only the configured project’s reader grants. */
export function gitLabPermissionData(prepared: PreparedGitLabPermissions): ConnectorPermissionData {
  const {
    revision: _revision,
    userMappingRows,
    projectPermissionRows,
    ...metadata
  } = prepared.snapshot
  return {
    metadata,
    payload: { userMappingRows, projectPermissionRows },
    groups: [{ groupKey: 'project', subjects: prepared.subjects }],
  }
}

/** Projects only safe metadata; CSV contents never reach a response or browser draft. */
export async function readGitLabPermissionSummaries(
  connectorIds: readonly string[]
): Promise<Map<string, GitLabPermissionSummary>> {
  const result = new Map<string, GitLabPermissionSummary>()
  for (const row of await readConnectorPermissionMetadata(connectorIds)) {
    const { mode, userMapping, projectPermissions } = readGitLabPermissionMetadata(row.metadata)
    result.set(row.connectorId, { mode, revision: row.revision, userMapping, projectPermissions })
  }
  return result
}

/** Workers load canonical mode without loading the potentially large CSV snapshot. */
export async function seedGitLabCsvContext(
  connectorId: string,
  context: Record<string, unknown>
): Promise<void> {
  const [row] = await readConnectorPermissionMetadata([connectorId])
  if (!row) return
  const { mode, host, projectId, projectPath } = readGitLabPermissionMetadata(row.metadata)
  if (mode === 'csv') setGitLabCsvContext(context, { connectorId, host, projectId, projectPath })
}
