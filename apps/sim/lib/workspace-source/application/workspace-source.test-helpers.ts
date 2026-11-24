/**
 * The harness the workspace source integration suites share: named checks with a JSON report,
 * workspaces created and cleaned up per suite, refusals, finding codes, the blob manifest a
 * directory sends, and the staging of blob bytes a CLI does before it applies.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { auditLog, permissions, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { WorkspaceKind } from '@sim/workspace-code'
import { stageBatches } from '@sim/workspace-code/limits'
import { inArray, sql } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import {
  type ApplyWorkspaceSourceInput,
  applyWorkspaceSource,
} from '@/lib/workspace-source/application/apply-workspace-source'
import { WorkspaceSourceRejectedError } from '@/lib/workspace-source/application/errors'
import { readWorkspaceSource } from '@/lib/workspace-source/application/read-workspace-source'
import { stageSourceBlobs } from '@/lib/workspace-source/application/stage-blobs'

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

/** A manifest entry, with the base64 bytes a CLI would stage for it before applying. */
export type ManifestBlob = NonNullable<ApplyWorkspaceSourceInput['blobs']>[number] & {
  content?: string
}

/** What a suite's apply sends: the submission, and who sends it when not the suite's owner. */
export type SourceSubmission = Omit<
  ApplyWorkspaceSourceInput,
  'workspaceId' | 'kinds' | 'blobs'
> & {
  kinds?: WorkspaceKind[]
  blobs?: ManifestBlob[]
  principal?: Principal
}

/**
 * Stages `blobs` (base64 bytes by SHA-256) in `workspaceId` as `principal`, as the CLI does: in
 * the requests `stageBatches` splits them into.
 */
export async function stageBlobsAs(
  principal: Principal,
  workspaceId: string,
  blobs: ReadonlyArray<{ sha256: string; content: string }>
) {
  const decoded = blobs.map((blob) => {
    const content = Buffer.from(blob.content, 'base64')
    return { sha256: blob.sha256, content, size: content.byteLength }
  })
  for (const batch of stageBatches(decoded)) {
    await withPermissionGroupScope(() =>
      stageSourceBlobs.execute({
        principal,
        input: {
          workspaceId,
          blobs: batch.map(({ sha256, content }) => ({ sha256, content })),
        },
      })
    )
  }
}

/**
 * A suite's apply and get, for `kinds`, as `owner` unless a call names another principal, each
 * inside the permission-group scope a request runs in. An apply that writes first stages every
 * blob it carries `content` for, as the CLI does; a dry run stages nothing.
 */
export function sourceRunner(kinds: WorkspaceKind[], owner: Principal) {
  return {
    async apply(workspaceId: string, submission: SourceSubmission) {
      const { principal = owner, blobs, ...input } = submission
      if (!input.dryRun) {
        await stageBlobsAs(
          principal,
          workspaceId,
          (blobs ?? []).flatMap((blob) =>
            blob.content === undefined ? [] : [{ sha256: blob.sha256, content: blob.content }]
          )
        )
      }
      return withPermissionGroupScope(() =>
        applyWorkspaceSource.execute({
          principal,
          input: {
            workspaceId,
            kinds,
            ...input,
            ...(blobs
              ? { blobs: blobs.map(({ path, sha256, size }) => ({ path, sha256, size })) }
              : {}),
          },
        })
      )
    },
    get(workspaceId: string, principal: Principal = owner) {
      return withPermissionGroupScope(() =>
        readWorkspaceSource.execute({ principal, input: { workspaceId, kinds } })
      )
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

/** The blob manifest a directory sends, with the bytes to stage for each path `carry` accepts. */
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
 * Makes Postgres refuse every write binding the source key `key` (a `workspace_resource_key`
 * insert or update), as a key claim that fails after its resource's write would: a crash or a
 * transient database error between the two. Returns the function that lifts the failure.
 */
export async function failKeyClaims(key: string): Promise<() => Promise<void>> {
  if (!/^[a-z0-9-]+$/.test(key)) throw new Error(`Not a source key: ${key}`)
  const name = `fail_key_claim_${key.replaceAll('-', '_')}`
  await db.execute(
    sql.raw(`CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger AS $$
BEGIN
  IF NEW.key = '${key}' THEN RAISE EXCEPTION 'injected key claim failure'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql`)
  )
  await db.execute(
    sql.raw(
      `CREATE OR REPLACE TRIGGER ${name} BEFORE INSERT OR UPDATE ON workspace_resource_key FOR EACH ROW EXECUTE FUNCTION ${name}()`
    )
  )
  return async () => {
    await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${name} ON workspace_resource_key`))
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${name}()`))
  }
}
