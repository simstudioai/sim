import { parseAsString, parseAsStringLiteral } from 'nuqs/server'

export const SSO_SETTINGS_TABS = ['sign-in', 'domains', 'provisioning'] as const

/** The value of `provider` that opens the add-provider form rather than an existing one. */
export const NEW_SSO_PROVIDER = 'new'

export const ssoSettingsParsers = {
  tab: parseAsStringLiteral(SSO_SETTINGS_TABS).withDefault('sign-in'),
  /** Provider id being viewed or edited on the sign-in tab; absent shows the list. */
  provider: parseAsString,
}

export const ssoSettingsUrlKeys = { history: 'push', clearOnDefault: true } as const
