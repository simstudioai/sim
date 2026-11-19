import { requireBuildNotesEnabled } from '@/lib/build-notes/feature-flag'
import {
  buildNotesFileName,
  parseBuildNotesKey,
  parseBuildNotesReference,
} from '@/lib/build-notes/paths'
import {
  getLiveBuildNotesByFileId,
  getLiveBuildNotesForWorkflow,
} from '@/lib/build-notes/repository'
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
  namespace: 'tests' | 'changelog' | 'build-notes'
  /** The owner key in a reference under this namespace; null for any other reference. */
  parseReference(reference: string): string | null
  /** The body file of the live owner a key names; null when there is none. */
  bodyFileIdForKey(workspaceId: string, key: string): Promise<string | null>
  /** The file's name in its namespace; null when its owner is gone. */
  fileName(fileId: string): Promise<string | null>
  /** Throws unless the file's owner is live and its feature is enabled. */
  assertOwnerAccess(
    fileId: string,
    workspaceOrganizationId: string | null,
    executor?: DbOrTx
  ): Promise<void>
  /** Checks new content before it is stored; the returned step runs in the write transaction. */
  prepareWrite(write: OwnedFileWrite): Promise<((tx: DbOrTx) => Promise<void>) | undefined>
  /** Why the generic file tool cannot create a file at this path, and what to use instead. */
  createHint(path: string): string
  /** Only Copilot reaches these files: people never read or write them, through any surface. */
  agentOnly?: true
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
    async assertOwnerAccess(fileId, workspaceOrganizationId, executor) {
      if (!(await getLiveWorkflowTestByBodyFileId(fileId, executor))) throw fileNotFound()
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
    async assertOwnerAccess(fileId, workspaceOrganizationId, executor) {
      if (!(await getReleaseByBodyFileId(fileId, executor))) throw fileNotFound()
      await requireChangelogEnabled(workspaceOrganizationId)
    },
    async prepareWrite(write) {
      assertChangelogBody(write.content)
      return undefined
    },
    createHint: (path) =>
      `${path} is a release body. Publish a release with the changelog tool (action publish); it returns the ${changelogFilePath('<id>')} path to edit`,
  },
  build_notes: {
    namespace: 'build-notes',
    agentOnly: true,
    parseReference: parseBuildNotesReference,
    async bodyFileIdForKey(workspaceId, key) {
      const { workflowId, file } = parseBuildNotesKey(key)
      const notes = await getLiveBuildNotesForWorkflow(workspaceId, workflowId)
      if (!notes) return null
      return file === 'notes' ? notes.notesFileId : notes.baselineFileId
    },
    async fileName(fileId) {
      const notes = await getLiveBuildNotesByFileId(fileId)
      if (!notes) return null
      return buildNotesFileName(
        notes.workflowId,
        notes.baselineFileId === fileId ? 'baseline' : 'notes'
      )
    },
    async assertOwnerAccess(fileId, workspaceOrganizationId, executor) {
      if (!(await getLiveBuildNotesByFileId(fileId, executor))) throw fileNotFound()
      await requireBuildNotesEnabled(workspaceOrganizationId)
    },
    async prepareWrite(write) {
      const { prepareBuildNotesWrite } = await import('@/lib/build-notes/content')
      return prepareBuildNotesWrite(write)
    },
    createHint: (path) =>
      `${path} belongs to a workflow's build notes. Create them with build-notes create <workflowId>, which returns the notes path to edit; Sim keeps the baseline.`,
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
