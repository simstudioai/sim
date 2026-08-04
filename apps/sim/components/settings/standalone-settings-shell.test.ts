/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_SETTINGS_ITEMS,
  ACCOUNT_SETTINGS_PATH_ALIASES,
  ORGANIZATION_SETTINGS_ITEMS,
  ORGANIZATION_SETTINGS_PATH_ALIASES,
  parseSettingsPathSection,
  SELFHOST_SETTINGS_ITEMS,
} from '@/components/settings/navigation'

describe('standalone settings section resolution', () => {
  it('keeps Billing active for the static account credit-usage route', () => {
    expect(
      parseSettingsPathSection({
        path: '/account/settings/billing/credit-usage',
        items: ACCOUNT_SETTINGS_ITEMS,
        defaultSection: 'general',
        aliases: ACCOUNT_SETTINGS_PATH_ALIASES,
      })
    ).toBe('billing')
  })

  it('resolves the organization section from its pathname', () => {
    expect(
      parseSettingsPathSection({
        path: '/organization/org-1/settings/audit-logs',
        items: ORGANIZATION_SETTINGS_ITEMS,
        defaultSection: 'members',
        aliases: ORGANIZATION_SETTINGS_PATH_ALIASES,
      })
    ).toBe('audit-logs')
  })

  it('keeps Subscription active for the self-host billing route', () => {
    expect(
      parseSettingsPathSection({
        path: '/selfhost/settings/billing',
        items: SELFHOST_SETTINGS_ITEMS,
        defaultSection: 'general',
      })
    ).toBe('billing')
  })
})
