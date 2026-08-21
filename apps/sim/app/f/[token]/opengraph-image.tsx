import { COVER_OG_SIZE, createCoverOgImage } from '@/lib/og/cover-image'
import { resolveActiveShareByToken } from '@/lib/public-shares/share-manager'
import { buildProvenance } from '@/app/f/[token]/utils'

export const dynamic = 'force-dynamic'
export const contentType = 'image/png'
export const size = COVER_OG_SIZE

/**
 * Social-preview card for a shared file, on the same brandbook cover template
 * as library posts and docs pages. Public shares show the file name +
 * provenance; protected (password / email / SSO) and unknown shares stay
 * generic so the filename never leaks pre-auth.
 */
export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const resolved = await resolveActiveShareByToken(token)

  if (!resolved || resolved.share.authType !== 'public') {
    return createCoverOgImage({
      title: 'Protected file',
      subtitle: 'Authentication is required to view this file',
    })
  }

  const { file, workspaceName, ownerName } = resolved

  return createCoverOgImage({
    title: file.originalName,
    subtitle: buildProvenance(workspaceName, ownerName) || 'Shared via Sim',
  })
}
