import { Suspense } from 'react'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import {
  getOrganizationSettingsHref,
  UNIFIED_TO_ORGANIZATION_SECTION,
} from '@/components/settings/navigation'
import { getSession } from '@/lib/auth'
import { authorizeWorkspaceSettingsSection } from '@/lib/settings/application/workspace-section-access'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { resolveSettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import { SECTION_PREFETCHERS } from './prefetch'
import { SettingsPage } from './settings'

interface WorkspaceSettingsSectionPageProps {
  params: Promise<{ workspaceId: string; section: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Settings availability varies across workspaces, so a preserved section may
 * need to land on the destination workspace's universally available page.
 */
function redirectToGeneralSettings(workspaceId: string): never {
  redirect(`/workspace/${workspaceId}/settings/general`)
}

export async function generateMetadata({
  params,
}: WorkspaceSettingsSectionPageProps): Promise<Metadata> {
  const { section } = await params
  return { title: resolveSettingsSection(section)?.meta.title ?? 'Settings' }
}

export default async function WorkspaceSettingsSectionPage({
  params,
  searchParams,
}: WorkspaceSettingsSectionPageProps) {
  const session = await getSession()
  if (!session?.user) redirect('/login')

  const { workspaceId, section } = await params
  /** The layout already rejected an unknown segment; this narrows the type and fails safe. */
  const resolved = resolveSettingsSection(section)
  if (!resolved) notFound()
  const parsed = resolved.id

  const access = await authorizeWorkspaceSettingsSection({
    workspaceId,
    userId: session.user.id,
    section: parsed,
  })
  if (!access.allowed) {
    if (access.disposition === 'not-found') notFound()
    redirectToGeneralSettings(workspaceId)
  }

  const organizationSection = UNIFIED_TO_ORGANIZATION_SECTION[parsed]
  if (organizationSection) {
    const hostContext = await getWorkspaceHostContextForViewer(workspaceId, session.user.id)
    if (hostContext?.hostOrganizationId) {
      const query = new URLSearchParams()
      for (const [key, value] of Object.entries((await searchParams) ?? {})) {
        for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
          query.append(key, entry)
        }
      }
      redirect(
        getOrganizationSettingsHref(hostContext.hostOrganizationId, organizationSection, query)
      )
    }
  }

  const queryClient = getQueryClient()
  /**
   * Protected section data starts only after the current server-side section gate succeeds.
   * The promise remains awaited because unsettled queries are omitted from dehydration.
   */
  const sectionPrefetch =
    SECTION_PREFETCHERS[parsed]?.(queryClient, {
      workspaceId,
    }) ?? Promise.resolve()

  await sectionPrefetch

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={null}>
        <SettingsPage section={parsed} />
      </Suspense>
    </HydrationBoundary>
  )
}
