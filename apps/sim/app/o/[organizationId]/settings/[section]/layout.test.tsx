/**
 * @vitest-environment node
 */
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
  it('redirects legacy authorized-app links before the section loading boundary', async () => {
    await expect(
      OrganizationSettingsSectionLayout({
        children: null,
        params: Promise.resolve({ organizationId: 'target-org', section: 'authorized-apps' }),
      })
    ).rejects.toThrow('redirect:/o/target-org/settings/general?view=authorized-apps')
  })

  it('rejects unknown sections', async () => {
    await expect(
      OrganizationSettingsSectionLayout({
        children: null,
        params: Promise.resolve({ organizationId: 'target-org', section: 'unknown' }),
      })
    ).rejects.toThrow('not-found')
  })
})
