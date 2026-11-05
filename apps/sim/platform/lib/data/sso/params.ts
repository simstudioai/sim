'use client'

import { useQueryStates } from 'nuqs'
import { ssoSettingsParsers, ssoSettingsUrlKeys } from '@/ee/sso/search-params'

/** The tab, provider and create-flow deep link. */
export function useSsoSettingsParams() {
  return useQueryStates(ssoSettingsParsers, ssoSettingsUrlKeys)
}
