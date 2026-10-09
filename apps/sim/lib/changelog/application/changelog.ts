import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { changelogOperations } from '@/lib/changelog/application/operations'
import { assertChangelogBody } from '@/lib/changelog/body'
import { requireChangelogEnabled } from '@/lib/changelog/feature-flag'
import { changelogFilePath } from '@/lib/changelog/paths'
import {
  type ChangelogChangeInput,
  type ChangelogChangeView,
  type ChangelogReleaseRow,
  findForeignChangeReferences,
  getHighestReleaseVersion,
  getRelease,
  insertReleaseInTx,
  listChangesByRelease,
  listReleases,
  type ReleaseCursor,
  updateRelease,
} from '@/lib/changelog/repository'
import {
  bumpReleaseVersion,
  formatReleaseVersion,
  parseReleaseVersion,
  type VersionBump,
} from '@/lib/changelog/version'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { createOwnedWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

const authorizationOptions = {
  delegation: { audience: 'sim:workspaces', isWithinScope: () => true },
} as const

const RELEASES_PER_PAGE = 20

/** Revisions are PostgreSQL integers; anything else cannot be a revision from a read. */
const MAX_REVISION = 2_147_483_647

/** A workflow a release changed, with the newest deployment it shipped in. */
interface ChangelogReleaseWorkflow {
  id: string
  name: string
  deploymentVersion: number | null
}

export interface ChangelogReleaseView {
  id: string
  version: string
  title: string
  bumpReason: string
  publishedAt: string
  updatedAt: string
  revision: string
  fileId: string
  path: string
  changes: ChangelogChangeView[]
  workflows: ChangelogReleaseWorkflow[]
}

function releaseWorkflows(changes: ChangelogChangeView[]): ChangelogReleaseWorkflow[] {
  const byWorkflow = new Map<string, ChangelogReleaseWorkflow>()
  for (const change of changes) {
    if (!change.workflowId || !change.workflowName) continue
    const previous = byWorkflow.get(change.workflowId)?.deploymentVersion ?? null
    const shipped = change.deploymentVersion
    byWorkflow.set(change.workflowId, {
      id: change.workflowId,
      name: change.workflowName,
      deploymentVersion:
        previous === null ? shipped : shipped === null ? previous : Math.max(previous, shipped),
    })
  }
  return [...byWorkflow.values()]
}

function presentRelease(
  row: ChangelogReleaseRow,
  changes: ChangelogChangeView[]
): ChangelogReleaseView {
  return {
    id: row.id,
    version: formatReleaseVersion({
      major: row.versionMajor,
      minor: row.versionMinor,
      patch: row.versionPatch,
    }),
    title: row.title,
    bumpReason: row.bumpReason,
    publishedAt: row.publishedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    revision: String(row.revision),
    fileId: row.bodyFileId,
    path: changelogFilePath(row.id),
    changes,
    workflows: releaseWorkflows(changes),
  }
}

async function presentReleases(rows: ChangelogReleaseRow[]): Promise<ChangelogReleaseView[]> {
  const changes = await listChangesByRelease(rows.map((row) => row.id))
  return rows.map((row) => presentRelease(row, changes.get(row.id) ?? []))
}

function parseRevision(revision: string): number {
  const parsed = /^\d+$/.test(revision) ? Number(revision) : Number.NaN
  if (!(parsed >= 1 && parsed <= MAX_REVISION))
    throw new OrchestrationError('validation', 'expectedRevision must be the revision from a read')
  return parsed
}

function encodeCursor(row: ChangelogReleaseRow): string {
  return `${row.publishedAt.getTime()}:${row.id}`
}

function decodeCursor(cursor: string): ReleaseCursor {
  const separator = cursor.indexOf(':')
  const millis = Number(cursor.slice(0, separator))
  const id = cursor.slice(separator + 1)
  if (separator < 1 || !Number.isSafeInteger(millis) || id.length === 0)
    throw new OrchestrationError('validation', 'cursor must be the nextCursor from a list')
  return { publishedAt: new Date(millis), id }
}

async function assertChangesInWorkspace(
  workspaceId: string,
  changes: ChangelogChangeInput[]
): Promise<void> {
  const foreign = await findForeignChangeReferences(workspaceId, changes)
  if (foreign.length > 0)
    throw new OrchestrationError(
      'validation',
      `Not found in this workspace: ${foreign.join(', ')}. A deployment version must belong to the change's workflow.`
    )
}

const resolveWorkspace = ({ input }: { input: { workspaceId: string } }) =>
  resolveActiveWorkspaceApplicationContext(input.workspaceId)

export const listChangelogReleases = defineAuthorizedWorkspaceUseCase({
  operation: changelogOperations.read,
  resolveContext: ({ input }: { input: { workspaceId: string; cursor?: string } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions,
  authorizeResource: ({ context }) => requireChangelogEnabled(context.workspaceOrganizationId),
  async execute({ input, context }) {
    const cursor = input.cursor ? decodeCursor(input.cursor) : null
    const rows = await listReleases(context.workspaceId, RELEASES_PER_PAGE + 1, cursor)
    const page = rows.slice(0, RELEASES_PER_PAGE)
    const last = page.at(-1)
    return {
      releases: await presentReleases(page),
      nextCursor: rows.length > RELEASES_PER_PAGE && last ? encodeCursor(last) : null,
    }
  },
})

/** One release; Sim reads and edits its body at `release.path` with the file tools. */
export const getChangelogRelease = defineAuthorizedWorkspaceUseCase({
  operation: changelogOperations.read,
  resolveContext: ({ input }: { input: { workspaceId: string; releaseId: string } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions,
  authorizeResource: ({ context }) => requireChangelogEnabled(context.workspaceOrganizationId),
  async execute({ input, context }) {
    const row = await getRelease(context.workspaceId, input.releaseId)
    if (!row) throw new OrchestrationError('not_found', 'Release not found')
    const [release] = await presentReleases([row])
    return { release }
  },
})

export interface PublishChangelogReleaseInput {
  workspaceId: string
  title: string
  body: string
  bump: VersionBump
  bumpReason: string
  changes: ChangelogChangeInput[]
}

/**
 * Publishes a release: its row, its changes, and its body file commit together. The version is
 * the workspace's highest plus the bump, read in the insert transaction; a concurrent publish
 * that takes the same number fails on the unique index and is reported as a conflict.
 */
export const publishChangelogRelease = defineAuthorizedWorkspaceUseCase({
  operation: changelogOperations.publish,
  resolveContext: ({ input }: { input: PublishChangelogReleaseInput }) =>
    resolveWorkspace({ input }),
  authorizationOptions,
  authorizeResource: ({ context }) => requireChangelogEnabled(context.workspaceOrganizationId),
  async execute({ input, context, principal }) {
    assertChangelogBody(Buffer.from(input.body, 'utf-8'))
    await assertChangesInWorkspace(context.workspaceId, input.changes)
    const userId = requirePrincipalSubjectUserId(principal)
    const releaseId = generateId()
    try {
      const { owner } = await createOwnedWorkspaceFile({
        context: 'changelog',
        workspaceId: context.workspaceId,
        userId,
        content: input.body,
        contentType: 'text/markdown',
        fileName: () => `${releaseId}.md`,
        insertOwner: async (tx, bodyFileId) => {
          const highest = await getHighestReleaseVersion(context.workspaceId, tx)
          const version = bumpReleaseVersion(highest, input.bump)
          return insertReleaseInTx(
            tx,
            {
              id: releaseId,
              workspaceId: context.workspaceId,
              title: input.title,
              versionMajor: version.major,
              versionMinor: version.minor,
              versionPatch: version.patch,
              bumpReason: input.bumpReason,
              bodyFileId,
              createdBy: userId,
              updatedBy: userId,
            },
            input.changes
          )
        },
      })
      const [release] = await presentReleases([owner])
      return { release }
    } catch (error) {
      if (getPostgresErrorCode(error) === '23505')
        throw new OrchestrationError(
          'conflict',
          'Another release took that version at the same time; publish again'
        )
      throw error
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.CHANGELOG_RELEASE_PUBLISHED,
    resourceType: AuditResourceType.CHANGELOG_RELEASE,
    resourceId: result.release.id,
    resourceName: `${result.release.version} ${result.release.title}`,
    description: `Published changelog release ${result.release.version}`,
  }),
})

export interface UpdateChangelogReleaseInput {
  workspaceId: string
  releaseId: string
  expectedRevision: string
  title?: string
  bumpReason?: string
  version?: string
  changes?: ChangelogChangeInput[]
}

/** Edits a release's own fields under its revision; the body is edited as its file. */
export const updateChangelogRelease = defineAuthorizedWorkspaceUseCase({
  operation: changelogOperations.update,
  resolveContext: ({ input }: { input: UpdateChangelogReleaseInput }) =>
    resolveWorkspace({ input }),
  authorizationOptions,
  authorizeResource: ({ context }) => requireChangelogEnabled(context.workspaceOrganizationId),
  async execute({ input, context, principal }) {
    const revision = parseRevision(input.expectedRevision)
    if (
      input.title === undefined &&
      input.bumpReason === undefined &&
      input.version === undefined &&
      input.changes === undefined
    )
      throw new OrchestrationError(
        'validation',
        'Pass at least one of title, bumpReason, version, or changes'
      )
    const version = input.version === undefined ? undefined : parseReleaseVersion(input.version)
    const existing = await getRelease(context.workspaceId, input.releaseId)
    if (!existing) throw new OrchestrationError('not_found', 'Release not found')
    if (input.changes) await assertChangesInWorkspace(context.workspaceId, input.changes)
    const userId = requirePrincipalSubjectUserId(principal)
    try {
      const updated = await updateRelease(
        existing.id,
        revision,
        userId,
        { title: input.title, bumpReason: input.bumpReason, version },
        input.changes
      )
      if (!updated)
        throw new OrchestrationError(
          'conflict',
          'The release changed after it was read; read it again and reapply your edit'
        )
      return { release: presentRelease(updated.row, updated.changes) }
    } catch (error) {
      if (getPostgresErrorCode(error) === '23505' && version)
        throw new OrchestrationError(
          'conflict',
          `Version ${formatReleaseVersion(version)} is already used by another release`
        )
      throw error
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.CHANGELOG_RELEASE_UPDATED,
    resourceType: AuditResourceType.CHANGELOG_RELEASE,
    resourceId: result.release.id,
    resourceName: `${result.release.version} ${result.release.title}`,
    description: `Updated changelog release ${result.release.version}`,
  }),
})
