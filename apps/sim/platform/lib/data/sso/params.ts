'use client'

import { useQueryStates } from 'nuqs'
import { ssoSettingsParsers, ssoSettingsUrlKeys } from '@/ee/sso/search-params'
import { useOrganization } from '@/platform/lib/data/organization'

/** The tab, provider and create-flow deep link. */
export function useSsoSettingsParams() {
  return useQueryStates(ssoSettingsParsers, ssoSettingsUrlKeys)
}

/** Customer callback URLs use the organization origin; a preview uses its document. */
export function useSsoOrigin() {
  const { legacyOrigin } = useOrganization()
  return legacyOrigin || (typeof window === 'undefined' ? '' : window.location.origin)
}
