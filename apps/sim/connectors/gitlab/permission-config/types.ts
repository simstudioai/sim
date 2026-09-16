import { connectorPermissionGroupToken } from '@/lib/knowledge/connectors/permission-tokens'

export const GITLAB_CSV_MAX_BYTES = 4 * 1024 * 1024
export const GITLAB_CSV_MAX_ROWS = 100_000
export const GITLAB_PERMISSION_MODES = ['administrator', 'csv'] as const

export type GitLabPermissionMode = (typeof GITLAB_PERMISSION_MODES)[number]
export type GitLabCsvKind = 'userMapping' | 'projectPermissions'

export interface GitLabCsvUpload {
  filename: string
  content: string
}

export interface GitLabPermissionInput {
  mode: GitLabPermissionMode
  /** Required on replacement; zero identifies a legacy administrator connection. */
  expectedRevision?: number
  userMapping?: GitLabCsvUpload
  projectPermissions?: GitLabCsvUpload
}

export interface GitLabCsvFileSummary {
  filename: string
  uploadedAt: string
  rowCount: number
}

export interface GitLabPermissionSummary {
  mode: GitLabPermissionMode
  revision: number
  userMapping: GitLabCsvFileSummary | null
  projectPermissions: GitLabCsvFileSummary | null
}

/** Contains no user identities; only server-loaded configuration may populate this context. */
export interface GitLabCsvSyncContext {
  connectorId: string
  host: string
  projectId: number
  projectPath: string
}

const syncContexts = new WeakMap<Record<string, unknown>, GitLabCsvSyncContext>()

export function setGitLabCsvContext(
  context: Record<string, unknown>,
  configuration: GitLabCsvSyncContext
): void {
  syncContexts.set(context, configuration)
}

export function getGitLabCsvContext(
  context?: Record<string, unknown>
): GitLabCsvSyncContext | undefined {
  return context ? syncContexts.get(context) : undefined
}

/** A connector-local audience prevents another connector's CSV from granting access. */
export function gitLabCsvGroupToken(connectorId: string): string {
  return connectorPermissionGroupToken(connectorId, 'project')
}
