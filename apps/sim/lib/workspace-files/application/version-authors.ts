import { chunkArray } from '@sim/utils/helpers'
import type { DbOrTx } from '@/lib/db/types'
import type { WorkspaceFileVersionRecord } from '@/lib/uploads/contexts/workspace/workspace-file-versions'
import { findUserEmailsByIds } from '@/lib/users/queries'

export type AuthoredFileVersion = WorkspaceFileVersionRecord & {
  authors: { id: string; email: string | null }[]
}

/** Resolves attribution only after the caller has authorized the selected file history. */
export async function projectFileVersionAuthors(
  versions: WorkspaceFileVersionRecord[],
  executor?: DbOrTx
): Promise<AuthoredFileVersion[]> {
  const ids = [...new Set(versions.flatMap((version) => version.authorUserIds))]
  const emails = new Map<string, string>()
  for (const batch of chunkArray(ids, 1000)) {
    for (const [id, email] of await findUserEmailsByIds(batch, executor)) emails.set(id, email)
  }
  return versions.map((version) => ({
    ...version,
    authors: version.authorUserIds.map((id) => ({ id, email: emails.get(id) ?? null })),
  }))
}
