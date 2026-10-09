import type { DeploymentAuthResource } from '@/lib/core/security/deployment'
import type { DeploymentAuthResult } from '@/lib/core/security/deployment-auth'
import { readSharedFolderPage, resolveSharedFile } from '@/lib/public-shares/folder-reader'
import { resolveActiveResourceShareByToken } from '@/lib/public-shares/share-manager'

interface PublicShareReadInput {
  token: string
  /** The surface verifies its share cookie or SSO session; it grants no workspace identity. */
  authorize: (share: DeploymentAuthResource) => Promise<DeploymentAuthResult>
}

export class PublicShareAccessError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'PublicShareAccessError'
  }
}

async function authorizeShare(input: PublicShareReadInput) {
  const resolved = await resolveActiveResourceShareByToken(input.token)
  if (!resolved) throw new PublicShareAccessError(404, 'Not found')
  const auth = await input.authorize(resolved.share)
  if (!auth.authorized)
    throw new PublicShareAccessError(auth.status ?? 401, auth.error ?? 'auth_required_password')
  return resolved
}

/** Reads metadata for one file after token authentication and live folder containment. */
export async function readPublicSharedFile(input: PublicShareReadInput & { fileId?: string }) {
  const resolved = await authorizeShare(input)
  if (resolved.kind === 'file' && input.fileId === undefined) return resolved
  const file = await resolveSharedFile(resolved, input.fileId)
  if (!file) throw new PublicShareAccessError(404, 'Not found')
  return { ...resolved, file }
}

/** A folder token authorizes only its current subtree, rechecked before every bounded listing. */
export async function readPublicSharedFolder(
  input: PublicShareReadInput & { folderId?: string; cursor?: string }
) {
  const resolved = await authorizeShare(input)
  if (resolved.kind !== 'folder') throw new PublicShareAccessError(404, 'Not found')
  const page = await readSharedFolderPage(resolved, input)
  if (!page) throw new PublicShareAccessError(404, 'Not found')
  return page
}
