import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
  notFound: () => {
    throw new Error('not-found')
  },
}))
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
    ).rejects.toThrow('not-found')
  })
})
