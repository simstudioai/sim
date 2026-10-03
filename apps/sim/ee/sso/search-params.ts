import { parseAsBoolean, parseAsString, parseAsStringLiteral } from 'nuqs/server'

export const SSO_SETTINGS_TABS = ['sign-in', 'domains', 'provisioning'] as const

export const ssoSettingsParsers = {
  tab: parseAsStringLiteral(SSO_SETTINGS_TABS).withDefault('sign-in'),
  /** Provider id being viewed or edited on the sign-in tab; absent shows the list. */
  provider: parseAsString,
  createProvider: parseAsBoolean.withDefault(false),
}

export const ssoSettingsUrlKeys = { history: 'push', clearOnDefault: true } as const
