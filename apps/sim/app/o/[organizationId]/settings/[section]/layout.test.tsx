import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/components/settings/settings-header', () => ({
  SettingsHeaderProvider: () => null,
  SettingsHeaderShell: () => null,
}))

import OrganizationSettingsSectionLayout from '@/app/o/[organizationId]/settings/[section]/layout'

describe('organization settings section routing', () => {
  it('rejects unknown sections', async () => {
    await expect(
      OrganizationSettingsSectionLayout({
        children: null,
        params: Promise.resolve({ organizationId: 'target-org', section: 'unknown' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
