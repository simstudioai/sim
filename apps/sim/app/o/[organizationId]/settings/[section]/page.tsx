import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { AccountSettingsRenderer } from '@/components/settings/account-settings-renderer'
import {
  getOrganizationSettingsHref,
  getSettingsSectionMeta,
  ORGANIZATION_SETTINGS_ITEMS,
} from '@/components/settings/navigation'
import { prefetchStandaloneGeneral } from '@/components/settings/prefetch-standalone-general'
import { SettingsSectionProvider } from '@/components/settings/settings-panel'
import { getSession } from '@/lib/auth'
import { organizationRoutes } from '@/lib/navigation/paths'
import { authorizeOrganizationSettingsSection } from '@/lib/settings/application/organization-section-access'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { OrganizationSettings } from '@/app/o/[organizationId]/settings/[section]/settings'
import { resolveOrganizationSurfaceSection } from '@/app/o/[organizationId]/settings/navigation'
import { getLegacyAccessRequestsQuery } from '@/ee/access-requests/lib/navigation'

interface OrganizationSettingsSectionPageProps {
  params: Promise<{ organizationId: string; section: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({
  params,
}: OrganizationSettingsSectionPageProps): Promise<Metadata> {
  const { section } = await params
  const resolved = resolveOrganizationSurfaceSection(section)
  const label =
    resolved?.plane === 'organization'
      ? ORGANIZATION_SETTINGS_ITEMS.find(({ id }) => id === resolved.section)?.label
      : resolved
        ? getSettingsSectionMeta('account', resolved.section)?.label
        : undefined
  return { title: label ?? 'Settings' }
}

/**
 * One settings surface for the organization view. An organization section runs
 * through the organization gate; an account section needs only the sign-in the
 * layout already established, and renders through the account plane's renderer.
 */
export default async function OrganizationSettingsSectionPage({
  params,
  searchParams,
}: OrganizationSettingsSectionPageProps) {
  const { organizationId, section } = await params
  const routes = organizationRoutes(organizationId)
  const resolved = resolveOrganizationSurfaceSection(section)
  if (!resolved) notFound()
  const session = await getSession()
  if (!session?.user) {
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: routes.settingsSection(resolved.section),
        isInviteFlow: false,
      })
    )
  }

  if (resolved.plane === 'organization') {
    const legacyRequestsQuery = getLegacyAccessRequestsQuery(
      resolved.section,
      (await searchParams) ?? {}
    )
    const organizationSection = legacyRequestsQuery ? 'requests' : resolved.section
    if (
      !(await authorizeOrganizationSettingsSection({
        organizationId,
        userId: session.user.id,
        section: organizationSection,
      }))
    ) {
      notFound()
    }
    if (legacyRequestsQuery) {
      redirect(getOrganizationSettingsHref(organizationId, 'requests', legacyRequestsQuery))
    }
    return <OrganizationSettings section={resolved.section} />
  }

  /**
   * No Suspense boundary: a fallback mounted with the section puts React's 300ms reveal floor
   * under every switch (see the workspace section layout).
   */
  const content = (
    <SettingsSectionProvider plane='account' section={resolved.section}>
      <AccountSettingsRenderer section={resolved.section} />
    </SettingsSectionProvider>
  )

  if (resolved.section === 'general') {
    const queryClient = getQueryClient()
    await prefetchStandaloneGeneral(queryClient)
    return <HydrationBoundary state={dehydrate(queryClient)}>{content}</HydrationBoundary>
  }

  return content
}
