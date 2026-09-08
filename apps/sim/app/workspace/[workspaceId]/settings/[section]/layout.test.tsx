/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`)
  },
}))
vi.mock(
  '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header',
  () => ({
    SettingsHeaderProvider: () => null,
    SettingsHeaderShell: () => null,
  })
)

import SettingsSectionLayout from '@/app/workspace/[workspaceId]/settings/[section]/layout'

const layoutProps = (section: string) => ({
  children: null,
  params: Promise.resolve({ workspaceId: 'workspace-a', section }),
})

describe('workspace settings legacy links', () => {
  it.each(['privacy', 'authorized-apps'])(
    'redirects %s before rendering the shell',
    async (view) => {
      await expect(SettingsSectionLayout(layoutProps(view))).rejects.toThrow(
        `NEXT_REDIRECT:/workspace/workspace-a/settings/general?view=${view}`
      )
    }
  )

  it('still rejects unknown sections', async () => {
    await expect(SettingsSectionLayout(layoutProps('unknown'))).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
