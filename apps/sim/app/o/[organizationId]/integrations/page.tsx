import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { slackSearchOnboardingInputSchema } from '@/lib/api/contracts/knowledge/slack'
import { getSession } from '@/lib/auth'
import { organizationRoutes } from '@/lib/navigation/paths'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { slackSearchIntegrationsPath } from '@/lib/slack-search/onboarding'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { OrganizationIntegrations } from '@/app/o/[organizationId]/integrations/integrations'

export const metadata: Metadata = {
  title: 'Integrations',
  referrer: 'no-referrer',
}

interface OrganizationIntegrationsPageProps {
  params: Promise<{ organizationId: string }>
  searchParams: Promise<{ slack?: string | string[] }>
}

export default async function OrganizationIntegrationsPage({
  params,
  searchParams,
}: OrganizationIntegrationsPageProps) {
  const { organizationId } = await params
  const { slack } = await searchParams
  const context =
    slack === undefined ? undefined : slackSearchOnboardingInputSchema.safeParse({ token: slack })
  if (context && !context.success) notFound()
  const slackToken = context?.data?.token
  const session = await getSession()
  if (!session?.user)
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: slackToken
          ? slackSearchIntegrationsPath(organizationId, slackToken)
          : organizationRoutes(organizationId).integrations,
        isInviteFlow: false,
      })
    )
  const organizationContext = await getOrganizationSurfaceContext(organizationId, session.user.id)
  if (!organizationContext?.searchAccess.memberScoped) notFound()
  return (
    <OrganizationIntegrations
      slackOnboarding={slackToken ? { token: slackToken, userId: session.user.id } : undefined}
    />
  )
}
