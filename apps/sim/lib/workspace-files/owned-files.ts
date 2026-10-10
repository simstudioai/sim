import { assertChangelogBody } from '@/lib/changelog/body'
import { requireChangelogEnabled } from '@/lib/changelog/feature-flag'
import {
  CHANGELOG_FILE_SUFFIX,
  changelogFilePath,
  parseChangelogFileReference,
} from '@/lib/changelog/paths'
import { getRelease, getReleaseByBodyFileId } from '@/lib/changelog/repository'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { requireWorkflowTestsEnabled } from '@/lib/workflow-tests/feature-flag'
import { parseTestFileReference, TEST_FILE_SUFFIX } from '@/lib/workflow-tests/paths'
import {
  getLiveWorkflowTestByBodyFileId,
  getLiveWorkflowTestByName,
} from '@/lib/workflow-tests/repository'

interface OwnedFileWrite {
  fileId: string
  workspaceId: string
  content: Buffer
}

/**
 * A workspace file another resource owns. It lives at its owner's VFS path, stays out of the
 * Files listing, and follows its owner's policy: it needs a live owner with its feature enabled.
 */
interface OwnedFileKind {
  /** The VFS namespace the file is read under, as `<namespace>/<fileName>`. */
  namespace: 'tests' | 'changelog'
  /** The owner key in a reference under this namespace; null for any other reference. */
  parseReference(reference: string): string | null
  /** The body file of the live owner a key names; null when there is none. */
  bodyFileIdForKey(workspaceId: string, key: string): Promise<string | null>
  /** The file's name in its namespace; null when its owner is gone. */
  fileName(fileId: string): Promise<string | null>
  /** Throws unless the file's owner is live and its feature is enabled. */
  assertOwnerAccess(fileId: string, workspaceOrganizationId: string | null): Promise<void>
  /** Checks new content before it is stored; the returned step runs in the write transaction. */
  prepareWrite(write: OwnedFileWrite): Promise<((tx: DbOrTx) => Promise<void>) | undefined>
  /** Why the generic file tool cannot create a file at this path, and what to use instead. */
  createHint(path: string): string
}

const fileNotFound = () => new OrchestrationError('not_found', 'File not found')

/** `workspace_files.context` → the resource that owns files of that context. */
const OWNED_FILE_KINDS = {
  test: {
    namespace: 'tests',
    parseReference: parseTestFileReference,
    async bodyFileIdForKey(workspaceId, name) {
      return (await getLiveWorkflowTestByName(workspaceId, name))?.bodyFileId ?? null
    },
    async fileName(fileId) {
      const owner = await getLiveWorkflowTestByBodyFileId(fileId)
      return owner ? `${owner.name}${TEST_FILE_SUFFIX}` : null
    },
    async assertOwnerAccess(fileId, workspaceOrganizationId) {
      if (!(await getLiveWorkflowTestByBodyFileId(fileId))) throw fileNotFound()
      await requireWorkflowTestsEnabled(workspaceOrganizationId)
    },
    async prepareWrite(write) {
      const { prepareWorkflowTestSourceWrite } = await import('@/lib/workflow-tests/source-write')
      return prepareWorkflowTestSourceWrite(write)
    },
    createHint: (path) =>
      `Create a test with the tests tool (action create), then write its cases into ${path}`,
  },
  changelog: {
    namespace: 'changelog',
    parseReference: parseChangelogFileReference,
    async bodyFileIdForKey(workspaceId, releaseId) {
      return (await getRelease(workspaceId, releaseId))?.bodyFileId ?? null
    },
    async fileName(fileId) {
      const release = await getReleaseByBodyFileId(fileId)
      return release ? `${release.id}${CHANGELOG_FILE_SUFFIX}` : null
    },
    async assertOwnerAccess(fileId, workspaceOrganizationId) {
      if (!(await getReleaseByBodyFileId(fileId))) throw fileNotFound()
      await requireChangelogEnabled(workspaceOrganizationId)
    },
    async prepareWrite(write) {
      assertChangelogBody(write.content)
      return undefined
    },
    createHint: (path) =>
      `${path} is a release body. Publish a release with the changelog tool (action publish); it returns the ${changelogFilePath('<id>')} path to edit`,
  },
} as const satisfies Record<string, OwnedFileKind>

export type OwnedFileContext = keyof typeof OWNED_FILE_KINDS
export type OwnedFileNamespace = (typeof OWNED_FILE_KINDS)[OwnedFileContext]['namespace']

export const OWNED_FILE_CONTEXTS = Object.keys(OWNED_FILE_KINDS) as OwnedFileContext[]

export function ownedFileKind(fileContext: string): OwnedFileKind | null {
  return Object.hasOwn(OWNED_FILE_KINDS, fileContext)
    ? OWNED_FILE_KINDS[fileContext as OwnedFileContext]
    : null
}

/** The owned-file kind whose namespace a reference is under, with the owner key it names. */
export function parseOwnedFileReference(
  reference: string
): { kind: OwnedFileKind; key: string } | null {
  for (const kind of Object.values(OWNED_FILE_KINDS)) {
    const key = kind.parseReference(reference)
    if (key !== null) return { kind, key }
  }
  return null
}
