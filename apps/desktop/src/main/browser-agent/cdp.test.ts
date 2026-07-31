import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { WebContentsView } from 'electron'
import { ensureInstrumented, setColorScheme } from '@/main/browser-agent/cdp'

describe('browser-agent CDP instrumentation', () => {
  it('leaves file chooser dialogs native so users can upload files', async () => {
    const contents = new WebContentsView().webContents

    await ensureInstrumented(contents, { onDialog: vi.fn() })

    expect(contents.debugger.sendCommand).toHaveBeenCalledWith('Page.enable', undefined)
    expect(contents.debugger.sendCommand).not.toHaveBeenCalledWith(
      'Page.setInterceptFileChooserDialog',
      expect.anything()
    )
  })
})

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
