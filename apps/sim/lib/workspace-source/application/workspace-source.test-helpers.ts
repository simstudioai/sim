/**
 * The harness the workspace source integration suites share: named checks with a JSON report,
 * workspaces created and cleaned up per suite, refusals, finding codes, the blob manifest a
 * directory sends, and the CLI's packing of blob content into rounds.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import { auditLog, permissions, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { inArray } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { WorkspaceSourceRejectedError } from '@/lib/workspace-source/application/errors'

interface CheckResult {
  name: string
  status: string
  durationMs: number
  error?: string
}

/**
 * Named checks whose outcomes `writeReport` writes as JSON to the path in `reportEnv`, or to
 * `test-results/<defaultFile>`.
 */
export function sourceChecks(reportEnv: string, defaultFile: string) {
  const checks: CheckResult[] = []
  return {
    check(name: string, run: () => Promise<void>) {
      it(name, async () => {
        const started = performance.now()
        try {
          await run()
          checks.push({ name, status: 'passed', durationMs: performance.now() - started })
        } catch (error) {
          checks.push({
            name,
            status: 'failed',
            durationMs: performance.now() - started,
            error: getErrorMessage(error),
          })
          throw error
        }
      })
    },
    async writeReport() {
      const reportPath = process.env[reportEnv] ?? resolve(`test-results/${defaultFile}`)
      await mkdir(dirname(reportPath), { recursive: true })
      await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
    },
  }
}

interface SourceWorkspaceOptions {
  name: string
  ownerId: string
  /** Other members and their workspace permission. */
  members?: ReadonlyArray<{ userId: string; permission: 'admin' | 'write' | 'read' }>
  organizationId?: string
  /** Sets the workspace's organization mode, as an organization-owned workspace has. */
  organizationMode?: boolean
}

/** Workspaces a suite creates (the owner an admin), all removed with their audit by `cleanup`. */
export function sourceWorkspaces() {
  const ids: string[] = []
  return {
    async create(options: SourceWorkspaceOptions): Promise<string> {
      const workspaceId = generateId()
      ids.push(workspaceId)
      await insertWorkspaceFixture(db, {
        id: workspaceId,
        name: options.name,
        ownerId: options.ownerId,
        billedAccountUserId: options.ownerId,
        ...(options.organizationId ? { organizationId: options.organizationId } : {}),
        ...(options.organizationMode ? { workspaceMode: 'organization' as const } : {}),
      })
      await db.insert(permissions).values(
        [{ userId: options.ownerId, permission: 'admin' as const }, ...(options.members ?? [])].map(
          ({ userId, permission }) => ({
            id: generateId(),
            userId,
            entityType: 'workspace',
            entityId: workspaceId,
            permissionType: permission,
          })
        )
      )
      return workspaceId
    },
    async cleanup() {
      if (ids.length === 0) return
      await db.delete(auditLog).where(inArray(auditLog.workspaceId, ids))
      await deleteWorkspaceFixture(db, inArray(workspace.id, ids))
    },
  }
}

/** The refusal `promise` rejects with; fails the check when it resolves or throws anything else. */
export async function refusal(promise: Promise<unknown>): Promise<WorkspaceSourceRejectedError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  )
  expect(error).toBeInstanceOf(WorkspaceSourceRejectedError)
  return error as WorkspaceSourceRejectedError
}

/** The codes of the findings of one severity, in order. */
export function codes(
  diagnostics: ReadonlyArray<{ code: string; severity: string }>,
  severity = 'error'
): string[] {
  return diagnostics
    .filter((finding) => finding.severity === severity)
    .map((finding) => finding.code)
}

/** The blob manifest a directory sends, carrying the content of each path `carry` accepts. */
export function blobManifest(
  blobs: Readonly<Record<string, Buffer>>,
  carry: (path: string) => boolean
): Array<{ path: string; sha256: string; size: number; content?: string }> {
  return Object.entries(blobs).map(([path, bytes]) => ({
    path,
    sha256: sha256Hex(bytes),
    size: bytes.byteLength,
    ...(carry(path) ? { content: bytes.toString('base64') } : {}),
  }))
}

/**
 * The paths the CLI carries in one round: those the server asked for, in manifest order, while
 * they fit the per-request cap (always at least one).
 */
export function cliRound(
  manifest: ReadonlyArray<{ path: string; size: number }>,
  wanted: readonly string[]
): string[] {
  let bytes = 0
  const carried: string[] = []
  for (const blob of manifest) {
    if (!wanted.includes(blob.path)) continue
    if (bytes > 0 && bytes + blob.size > WORKSPACE_SOURCE_LIMITS.maxBlobBytesPerRequest) continue
    bytes += blob.size
    carried.push(blob.path)
  }
  return carried
}
