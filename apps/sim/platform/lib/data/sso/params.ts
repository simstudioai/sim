'use client'

import { useQueryStates } from 'nuqs'
import { ssoSettingsParsers, ssoSettingsUrlKeys } from '@/ee/sso/search-params'

/** The tab, provider and create-flow deep link. */
export function useSsoSettingsParams() {
  return useQueryStates(ssoSettingsParsers, ssoSettingsUrlKeys)
}

/** The origin customer callback URLs are written against. */
export function useSsoOrigin() {
  return typeof window === 'undefined' ? '' : window.location.origin
}
