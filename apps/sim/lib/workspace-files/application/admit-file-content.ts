import type { Principal } from '@sim/auth/principal'
import {
  admitContent,
  admitEach,
  ContentRefusedError,
  type ContentView,
  mustClassifyContent,
  requireAdmittedContent,
} from '@/lib/core/application'
import {
  getBoundWorkspaceFileSecretProvenance,
  getBoundWorkspaceFileSecretProvenanceByIdentity,
  type WorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenanceIdentity,
} from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import type { OwnedFileContext, OwnedFileNamespace } from '@/lib/workspace-files/owned-files'

/** What a classification is bound to; a workspace file record satisfies it. */
interface ClassifiableFile {
  id: string
  key: string
  storageContext?: WorkspaceFileSecretProvenanceIdentity['context']
  /** An owned file's namespace, which names the owner context its row is stored under. */
  vfsNamespace?: 'uploads' | OwnedFileNamespace
  contentUpdatedAt?: Date | null
}

const OWNED_CONTEXT_BY_NAMESPACE = {
  tests: 'test',
  changelog: 'changelog',
} as const satisfies Record<OwnedFileNamespace, OwnedFileContext>

/** The identity a classification is bound to: these exact bytes of this exact canonical file. */
export function workspaceFileProvenanceIdentity(
  file: ClassifiableFile
): WorkspaceFileSecretProvenanceIdentity {
  return {
    fileId: file.id,
    key: file.key,
    context:
      file.storageContext ??
      (file.vfsNamespace && file.vfsNamespace !== 'uploads'
        ? OWNED_CONTEXT_BY_NAMESPACE[file.vfsNamespace]
        : 'workspace'),
    contentUpdatedAt: file.contentUpdatedAt ?? undefined,
  }
}

/**
 * Admits one file's content before its bytes load, refusing it with a `403` when the surface's
 * gate does. `provenance` is passed when the caller holds a classification bound to a snapshot
 * other than the current file, such as a historical version. A caller no gate observes is admitted
 * without a provenance read.
 */
export async function requireAdmittedWorkspaceFile(
  principal: Principal,
  workspaceId: string,
  file: ClassifiableFile,
  view: ContentView,
  provenance?: WorkspaceFileSecretProvenance
): Promise<void> {
  if (!mustClassifyContent(principal)) {
    await admitContent(principal, [])
    return
  }
  await requireAdmittedContent(principal, {
    kind: 'workspace-file',
    id: file.id,
    provenance:
      provenance ??
      (await getBoundWorkspaceFileSecretProvenance(
        workspaceId,
        workspaceFileProvenanceIdentity(file)
      )),
    view,
  })
}

/**
 * Admits the other files a render embedded, after it ran and before its bytes leave. A render is
 * one output its contributors cannot be separated from, so it is admitted only when every one is.
 */
export async function admitContributors(
  principal: Principal,
  workspaceId: string,
  contributors: readonly WorkspaceFileSecretProvenanceIdentity[] | undefined,
  view: ContentView
): Promise<boolean> {
  if (!contributors?.length || !mustClassifyContent(principal)) return true
  const provenance = await getBoundWorkspaceFileSecretProvenanceByIdentity(
    workspaceId,
    contributors
  )
  const sources = contributors.map((identity) => ({
    kind: 'workspace-file' as const,
    id: identity.fileId,
    provenance: provenance.get(identity.fileId) ?? { status: 'unknown' as const },
    view,
  }))
  return (await admitContent(principal, sources)).refused.length === 0
}

/** {@link admitContributors} for a single render: a refused contributor refuses it with a `403`. */
export async function requireAdmittedContributors(
  ...args: Parameters<typeof admitContributors>
): Promise<void> {
  if (!(await admitContributors(...args))) {
    throw new ContentRefusedError('workspace-file')
  }
}

/**
 * Admits each of many files on its own, classifying all of them in one batch, and returns the ids
 * admitted. A caller no gate observes gets every id back without a provenance read.
 */
async function admitWorkspaceFileIdentities(
  principal: Principal,
  workspaceId: string,
  identities: readonly WorkspaceFileSecretProvenanceIdentity[],
  view: ContentView
): Promise<Set<string>> {
  const admitted = await admitEach(principal, identities, async (items) => {
    const provenance = await getBoundWorkspaceFileSecretProvenanceByIdentity(workspaceId, items)
    return items.map((identity) => ({
      kind: 'workspace-file' as const,
      id: identity.fileId,
      provenance: provenance.get(identity.fileId) ?? { status: 'unknown' as const },
      view,
    }))
  })
  return new Set(admitted.map((identity) => identity.fileId))
}

/** {@link admitWorkspaceFileIdentities} over file records, returning the admitted records in order. */
export async function admitWorkspaceFiles<F extends ClassifiableFile>(
  principal: Principal,
  workspaceId: string,
  files: readonly F[],
  view: ContentView
): Promise<F[]> {
  const admitted = await admitWorkspaceFileIdentities(
    principal,
    workspaceId,
    files.map(workspaceFileProvenanceIdentity),
    view
  )
  return files.filter((file) => admitted.has(file.id))
}
