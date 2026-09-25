import { Suspense } from 'react'
import { ChipLink } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createSearchParamsCache, createSerializer } from 'nuqs/server'
import { EmptyState } from '@/components/empty-state/empty-state'
import { ORGANIZATION_SETTINGS_ITEMS, toSettingsHeaderMeta } from '@/components/settings/navigation'
import { SettingsHeaderProvider, SettingsHeaderShell } from '@/components/settings/settings-header'
import { SettingsSectionProvider } from '@/components/settings/settings-panel'
import { getSession } from '@/lib/auth'
import { APP_ENTRY_PATH, organizationRoutes } from '@/lib/navigation/paths'
import { getOrganizationSettingsAccess } from '@/lib/organizations/settings-access'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { AccessRequestsSettings } from '@/ee/access-requests/components/access-requests-settings'
import { accessRequestEntrySearchParams } from '@/ee/access-requests/components/search-params'
import { getLegacyAccessRequestsSettingsQuery } from '@/ee/access-requests/lib/navigation'

export const metadata: Metadata = {
  title: 'Access requests',
  robots: { index: false, follow: false },
}

interface AccessRequestsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const entrySearchParams = createSearchParamsCache(accessRequestEntrySearchParams)
const serializeEntrySearchParams = createSerializer(accessRequestEntrySearchParams)
const logger = createLogger('AccessRequestsPage')

/** Session-only entry so access requests remain reachable outside the organization Search rollout. */
export default async function AccessRequestsPage({ searchParams }: AccessRequestsPageProps) {
  const [rawParams, session] = await Promise.all([searchParams, getSession()])
  const params = entrySearchParams.parse(rawParams)
  if (!session?.user) {
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: serializeEntrySearchParams('/access-requests', params),
        isInviteFlow: false,
      })
    )
  }

  if (!params.organizationId) {
    return (
      <EmptyState
        title='Choose an organization'
        description='Open Settings → Requests in an organization or workspace.'
        action={<ChipLink href={APP_ENTRY_PATH}>Back to Sim</ChipLink>}
      />
    )
  }

  const query = getLegacyAccessRequestsSettingsQuery(rawParams)
  if (params.view === 'admin' || params.view !== rawParams.view) {
    const normalized = new URLSearchParams(query)
    normalized.set('organizationId', params.organizationId)
    redirect(`/access-requests?${normalized}`)
  }

  const context = await getOrganizationSurfaceContext(params.organizationId, session.user.id).catch(
    (error) => {
      logger.warn('Unable to resolve organization navigation for access requests', { error })
      return null
    }
  )
  if (context?.searchAccess.memberScoped) {
    redirect(organizationRoutes(params.organizationId).settingsSection('requests') + query)
  }

  const access = await getOrganizationSettingsAccess(params.organizationId, session.user.id)
  const meta = ORGANIZATION_SETTINGS_ITEMS.find((item) => item.id === 'requests')!
  return (
    <SettingsHeaderProvider>
      <SettingsHeaderShell meta={toSettingsHeaderMeta(meta)}>
        <SettingsSectionProvider section='requests' meta={meta}>
          <Suspense
            fallback={
              <SettingsEmptyState variant='inline'>
                <span role='status'>Loading requests...</span>
              </SettingsEmptyState>
            }
          >
            <AccessRequestsSettings
              scope={{ kind: 'organization', organizationId: params.organizationId }}
              reviewOrganizationId={access.isAdmin ? params.organizationId : undefined}
              standalone
            />
          </Suspense>
        </SettingsSectionProvider>
      </SettingsHeaderShell>
    </SettingsHeaderProvider>
  )
}
