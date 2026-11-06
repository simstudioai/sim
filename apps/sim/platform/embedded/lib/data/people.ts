'use client'

import { isOrganizationSettingsSectionAvailable } from '@/components/settings/navigation'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { organizationRoutes } from '@/lib/navigation/paths'
import { useOrganization } from '@/lib/organizations/provider'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { serializeSsoSettings } from '@/ee/sso/search-params'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'
import {
  type PeoplePickerScope,
  personHref as personHrefFrom,
  usePeoplePicker as useSharedPeoplePicker,
  usePersonProfile as useSharedPersonProfile,
} from '@/platform/shared/people'

/** Who is viewing, and which of the page's administration they may reach. */
export function usePeopleViewer() {
  const { organization, viewer, settingsFeatures } = useOrganization()
  const { features, hosted } = useDeploymentShape()
  return {
    organizationName: organization.name,
    isAdmin: viewer.isAdmin,
    canProvision: features.scim && (!hosted || settingsFeatures.hasEnterprisePlan),
    canOpenProvisioningSettings: isOrganizationSettingsSectionAvailable('sso', settingsFeatures),
    provisioningSettingsHref: serializeSsoSettings(
      organizationRoutes(organization.id).settingsSection('sso'),
      { tab: 'provisioning' }
    ),
  }
}

export function personHref(organizationId: string, memberId: string, originQuery = ''): string {
  return personHrefFrom(organizationRoutes(organizationId).people, memberId, originQuery)
}

export function usePersonProfile(organizationId: string, memberId: string) {
  return useSharedPersonProfile(organizationRoutes(organizationId).people, organizationId, memberId)
}

function useSettledTerm(term: string): string {
  return useSearchFilterValue(term, SEARCH_DEBOUNCE_MS).trim()
}

function pickerEmptyMessage(scope: PeoplePickerScope | undefined, term: string): string {
  return scope === 'roots' && !term.trim()
    ? 'No top-level teams with reporting lines yet'
    : 'No matching people'
}

export function usePeoplePicker(
  organizationId: string,
  scope?: PeoplePickerScope,
  excludeMemberId?: string
) {
  return useSharedPeoplePicker(organizationId, scope, excludeMemberId, {
    useSettledTerm,
    emptyMessage: pickerEmptyMessage,
  })
}
