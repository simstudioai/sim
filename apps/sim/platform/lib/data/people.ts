'use client'

import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { serializeSsoSettings } from '@/ee/sso/search-params'
import { useDebounce } from '@/hooks/use-debounce'
import { useOrganization } from '@/platform/lib/data/organization'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import {
  type PeoplePickerScope,
  usePeoplePicker as useSharedPeoplePicker,
  usePersonProfile as useSharedPersonProfile,
} from '@/platform/shared/people'

/** Who is viewing, and which of the page's administration they may reach. */
export function usePeopleViewer() {
  const surface = useOrganization()
  const { organization, viewer, settingsFeatures } = surface
  const { features, hosted } = useDeploymentShape()
  return {
    organizationName: organization.name,
    isAdmin: viewer.isAdmin,
    canProvision: features.scim && (!hosted || settingsFeatures.hasEnterprisePlan),
    canOpenProvisioningSettings: surface.settingsSections.includes('sso'),
    provisioningSettingsHref: serializeSsoSettings(surfaceHref(surface, '/settings/sso'), {
      tab: 'provisioning',
    }),
  }
}

/** Where People lives on this host. */
export function usePeoplePath(): string {
  return surfaceHref(useOrganization(), '/people')
}

export function usePersonProfile(organizationId: string, memberId: string) {
  return useSharedPersonProfile(usePeoplePath(), organizationId, memberId)
}

function useSettledTerm(term: string): string {
  return useDebounce(term.trim(), SEARCH_DEBOUNCE_MS)
}

export function usePeoplePicker(
  organizationId: string,
  scope?: PeoplePickerScope,
  excludeMemberId?: string
) {
  return useSharedPeoplePicker(organizationId, scope, excludeMemberId, { useSettledTerm })
}
