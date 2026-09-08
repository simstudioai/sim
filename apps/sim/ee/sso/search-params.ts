import { parseAsStringLiteral } from 'nuqs/server'

export const SSO_SETTINGS_TABS = ['sign-in', 'domains', 'provisioning'] as const

export const ssoSettingsParsers = {
  tab: parseAsStringLiteral(SSO_SETTINGS_TABS).withDefault('sign-in'),
}

export const ssoSettingsUrlKeys = { history: 'push', clearOnDefault: true } as const
