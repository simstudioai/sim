import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { organizationRoutes } from '@/lib/navigation/paths'
import { isSimLinksEnabled } from '@/lib/sim-links/feature-flag'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { LinksSurface } from '@/app/o/[organizationId]/links/links-surface'
import { LinksPage } from '@/platform/app/(shell)/links/_components/links-page/links-page'

export const metadata: Metadata = { title: 'Links' }

interface SimLinksPageProps {
  params: Promise<{ organizationId: string }>
}

export default async function SimLinksPage({ params }: SimLinksPageProps) {
  const { organizationId } = await params
  const session = await getSession()
  if (!session?.user)
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: organizationRoutes(organizationId).simLinks,
        isInviteFlow: false,
      })
    )
  if (!(await isSimLinksEnabled(organizationId))) notFound()
  return (
    <LinksSurface>
      <LinksPage organizationId={organizationId} />
    </LinksSurface>
  )
}
