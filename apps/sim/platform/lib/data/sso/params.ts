'use client'

import { useQueryStates } from 'nuqs'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { ssoSettingsParsers, ssoSettingsUrlKeys } from '@/ee/sso/search-params'

/** The tab, provider and create-flow deep link. */
export function useSsoSettingsParams() {
  return useQueryStates(ssoSettingsParsers, ssoSettingsUrlKeys)
}

/** The canonical origin customer callback URLs are written against, never the browser's. */
export function useSsoOrigin() {
  return getBaseUrl()
}
