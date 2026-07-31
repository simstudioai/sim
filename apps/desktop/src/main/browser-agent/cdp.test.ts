import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { WebContentsView } from 'electron'
import { setColorScheme } from '@/main/browser-agent/cdp'

describe('browser-agent CDP theme', () => {
  it('emulates explicit light and dark preferences', async () => {
    const contents = new WebContentsView().webContents

    await setColorScheme(contents, 'dark')
    await setColorScheme(contents, 'light')

    expect(vi.mocked(contents.debugger.sendCommand).mock.calls).toEqual([
      [
        'Emulation.setEmulatedMedia',
        { features: [{ name: 'prefers-color-scheme', value: 'dark' }] },
      ],
      [
        'Emulation.setEmulatedMedia',
        { features: [{ name: 'prefers-color-scheme', value: 'light' }] },
      ],
    ])
  })

  it('clears the override for the system preference', async () => {
    const contents = new WebContentsView().webContents

    await setColorScheme(contents, 'system')

    expect(contents.debugger.sendCommand).toHaveBeenCalledWith('Emulation.setEmulatedMedia', {
      features: [],
    })
  })
})
