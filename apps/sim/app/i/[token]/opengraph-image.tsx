import { buildProvenance } from '@/lib/public-shares/provenance'
import { resolveActiveInterfaceShareByToken } from '@/lib/public-shares/share-manager'
import { createLandingOgImage } from '@/app/(landing)/og-utils'

export const dynamic = 'force-dynamic'
export const contentType = 'image/png'
export const size = {
  width: 1200,
  height: 630,
}

/**
 * Social-preview card for a shared interface. Public shares show the interface
 * name + provenance; protected (password / email / SSO) and unknown shares stay
 * generic so the name never leaks pre-auth.
 */
export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const resolved = await resolveActiveInterfaceShareByToken(token)

  if (!resolved || resolved.share.authType !== 'public') {
    return createLandingOgImage({
      eyebrow: 'Shared interface',
      title: 'Protected interface',
      subtitle: 'Authentication is required to use this interface',
    })
  }

  const { definition, workspaceName, ownerName } = resolved
  const subtitle = buildProvenance(workspaceName, ownerName) || 'Shared via Sim'

  return createLandingOgImage({
    eyebrow: 'Shared interface',
    title: definition.name,
    subtitle,
  })
}
