import { resolveActiveShareByToken } from '@/lib/public-shares/share-manager'
import { createLandingOgImage } from '@/app/(landing)/og-utils'
import { buildProvenance } from '@/app/f/[token]/utils'

export const dynamic = 'force-dynamic'
export const contentType = 'image/png'
export const size = {
  width: 1200,
  height: 630,
}

/**
 * Social-preview card for a shared file. Public shares show the file name +
 * provenance; protected (password / email / SSO) and unknown shares stay generic
 * so the filename never leaks pre-auth.
 */
export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const resolved = await resolveActiveShareByToken(token)

  if (!resolved || resolved.share.authType !== 'public') {
    return createLandingOgImage({
      eyebrow: 'Shared file',
      title: 'Protected file',
      subtitle: 'Authentication is required to view this file',
    })
  }

  const { file, workspaceName, ownerName } = resolved
  const subtitle = buildProvenance(workspaceName, ownerName) || 'Shared via Sim'

  return createLandingOgImage({
    eyebrow: 'Shared file',
    title: file.originalName,
    subtitle,
  })
}
