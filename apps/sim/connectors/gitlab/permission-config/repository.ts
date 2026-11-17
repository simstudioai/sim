import { isPlainRecord } from '@sim/utils/object'
import { z } from 'zod'
import { gitLabPermissionSummarySchema } from '@/lib/api/contracts/knowledge/gitlab-permissions'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ConnectorPermissionData,
  loadConnectorPermissionSnapshot,
  readConnectorPermissionMetadata,
} from '@/lib/knowledge/connectors/permission-store'
import { type GitLabGroupScope, gitLabGroupScopeSchema } from '@/connectors/gitlab/group'
import {
  GitLabCsvValidationError,
  parseGitLabCsv,
} from '@/connectors/gitlab/permission-config/parser'
import {
  GITLAB_CSV_MAX_ROWS,
  type GitLabPermissionInput,
  type GitLabPermissionSummary,
  setGitLabCsvContext,
} from '@/connectors/gitlab/permission-config/types'

const summarySchema = gitLabPermissionSummarySchema.omit({ provider: true, revision: true })
const metadataSchema = z.union([
  summarySchema.merge(gitLabGroupScopeSchema),
  summarySchema.extend({
    host: z.string().min(1),
    projectId: z.number().int().positive(),
    projectPath: z.string().min(1),
  }),
])
type RevisionMetadata = z.output<typeof metadataSchema> & { revision: number }
interface StoredRows {
  userMappingRows: [string, string][] | null
  projectPermissionRows: [string, string][] | null
}
type Snapshot = RevisionMetadata & StoredRows

export interface PreparedGitLabPermissions {
  expectedRevision: number
  snapshot: Snapshot
  groups: ConnectorPermissionData['groups']
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
  project: { host: string; projectId: number; projectPath: string } | GitLabGroupScope,
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
  if ('group' in project && userMapping && projectPermissions) {
    const paths = new Set(project.projects.map((entry) => entry.path))
    if (projectPermissions.rows.some(([path]) => !paths.has(path)))
      throw new OrchestrationError(
        'validation',
        'The CSV contains projects outside the configured GitLab group.'
      )
    if (existing && 'group' in existing) {
      const previousIds = new Map(existing.projects.map((entry) => [entry.path, entry.id]))
      if (
        project.projects.some(
          (entry) => previousIds.has(entry.path) && previousIds.get(entry.path) !== entry.id
        )
      )
        throw new OrchestrationError(
          'validation',
          'A GitLab project identity changed. Create a new connection before granting access to a replacement project.'
        )
    }
  }
  const paths =
    'group' in project ? project.projects.map((entry) => entry.path) : [project.projectPath]
  const grants = new Map(paths.map((path) => [path, new Set<string>()]))
  if (userMapping && projectPermissions) {
    const identities = new Map(userMapping.rows)
    for (const [path, id] of projectPermissions.rows) {
      const email = identities.get(id)
      if (email) grants.get(path)?.add(`u:${email}`)
    }
  }
  const subjects = (path: string) => [...(grants.get(path) ?? [])].sort()
  return {
    expectedRevision: revision,
    snapshot: {
      ...project,
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
    groups:
      'group' in project
        ? project.projects.map((entry) => ({
            groupKey: `project:${entry.id}`,
            subjects: subjects(entry.path),
          }))
        : [{ groupKey: 'project', subjects: subjects(project.projectPath) }],
    rewriteAccess:
      replacing &&
      ((existing?.mode ?? 'administrator') !== input.mode ||
        (existing !== null &&
          (existing.host !== project.host ||
            ('group' in existing || 'group' in project
              ? JSON.stringify('group' in existing ? existing.group : null) !==
                JSON.stringify('group' in project ? project.group : null)
              : existing.projectId !== project.projectId)))),
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
    groups: prepared.groups,
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
export async function seedGitLabPermissionContext(
  connectorId: string,
  context: Record<string, unknown>
): Promise<void> {
  const [row] = await readConnectorPermissionMetadata([connectorId])
  if (!row) return
  const metadata = readGitLabPermissionMetadata(row.metadata)
  if ('group' in metadata) {
    const { host, group, projects } = metadata
    context.gitLabGroupScope = { host, group, projects }
    context.gitLabPermissionMode = metadata.mode
  } else if (metadata.mode === 'csv') setGitLabCsvContext(context, { connectorId, ...metadata })
}
