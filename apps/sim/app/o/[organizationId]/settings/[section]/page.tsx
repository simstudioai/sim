import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import {
  getOrganizationSettingsHref,
  getSettingsSectionMeta,
  ORGANIZATION_SETTINGS_ITEMS,
} from '@/components/settings/navigation'
import { prefetchStandaloneGeneral } from '@/components/settings/prefetch-standalone-general'
import { getSession } from '@/lib/auth'
import { organizationRoutes } from '@/lib/navigation/paths'
import { resolveOrganizationSurfaceSection } from '@/lib/organizations/settings-sections'
import { isPlatformAdmin } from '@/lib/permissions/super-user'
import { authorizeOrganizationSettingsSection } from '@/lib/settings/application/organization-section-access'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { getLegacyAccessRequestsQuery } from '@/ee/access-requests/lib/navigation'
import { getQueryClient } from '@/hooks/queries/utils/get-query-client'
import { isPlatformSettingsSection } from '@/platform/embedded/app/(shell)/settings/_components/platform-sections'
import { PlatformSettingsSectionHost } from '@/platform/embedded/app/(shell)/settings/_components/settings-section-host'
import { prefetchPermissionEditorCatalog } from '@/platform/embedded/lib/data/prefetch-permission-editor'

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
 * through the organization gate; platform administration is restricted to platform admins.
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
    if (resolved.section === 'access-control') {
      const state = await prefetchPermissionEditorCatalog(organizationId, {
        kind: 'session',
        userId: session.user.id,
        sessionId: session.session.id,
      })
      return (
        <HydrationBoundary state={state}>
          <PlatformSettingsSectionHost section='access-control' />
        </HydrationBoundary>
      )
    }
    if (!isPlatformSettingsSection(resolved.section)) notFound()
    return <PlatformSettingsSectionHost section={resolved.section} />
  }

  if (resolved.section === 'admin' || resolved.section === 'mothership') {
    if (!(await isPlatformAdmin(session.user.id))) notFound()
  }

  if (!isPlatformSettingsSection(resolved.section)) notFound()
  /**
   * No Suspense boundary: a fallback mounted with the section puts React's 300ms reveal floor
   * under every switch (see the workspace section layout).
   */
  const content = <PlatformSettingsSectionHost section={resolved.section} />

  if (resolved.section === 'general') {
    const queryClient = getQueryClient()
    await prefetchStandaloneGeneral(queryClient)
    return <HydrationBoundary state={dehydrate(queryClient)}>{content}</HydrationBoundary>
  }

  return content
}
