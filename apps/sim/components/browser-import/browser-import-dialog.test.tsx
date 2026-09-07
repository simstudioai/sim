/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import type { BrowserChromeImportResult } from '@sim/desktop-bridge'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { importer, mockBridge } = vi.hoisted(() => ({
  importer: { listChromeProfiles: vi.fn(), importFromChrome: vi.fn() },
  mockBridge: vi.fn(),
}))

vi.mock('@/lib/desktop', () => ({ getDesktopBridge: mockBridge }))

import { toast } from '@sim/emcn'
import { BrowserImportDialog } from '@/components/browser-import/browser-import-dialog'

const PROFILE = {
  id: 'chrome:Default',
  label: 'Chrome',
  browserId: 'chrome',
  browserLabel: 'Chrome',
  profileLabel: 'Default',
}
const SUCCESS: BrowserChromeImportResult = {
  cookies: { cookiesImported: 4, cookiesSkipped: 0 },
  passwords: { passwordsAdded: 2, passwordsUpdated: 1, passwordsSkipped: 0 },
}

let container: HTMLDivElement
let root: Root
const onImported = vi.fn(async () => {})
const onOpenChange = vi.fn()

async function render(open = true) {
  await act(async () => {
    root.render(
      <BrowserImportDialog open={open} onOpenChange={onOpenChange} onImported={onImported} />
    )
  })
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll('button')].find((node) => node.textContent === label)
  if (!match) throw new Error(`Missing button: ${label}`)
  return match
}

async function importProfile() {
  await act(async () => button('Import').click())
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
  mockBridge.mockReturnValue({ browserImport: importer })
  importer.listChromeProfiles.mockResolvedValue([PROFILE])
  importer.importFromChrome.mockResolvedValue(SUCCESS)
  for (const variant of ['success', 'warning', 'error', 'info'] as const) {
    vi.spyOn(toast, variant).mockReturnValue('toast-id')
  }
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('BrowserImportDialog', () => {
  it('discovers profiles only on opening and refreshes them on reopening', async () => {
    await render(false)
    expect(importer.listChromeProfiles).not.toHaveBeenCalled()
    await render()
    expect(importer.listChromeProfiles).toHaveBeenCalledOnce()
    expect(importer.importFromChrome).not.toHaveBeenCalled()
    await render(false)
    await render()
    expect(importer.listChromeProfiles).toHaveBeenCalledTimes(2)
  })

  it('imports directly from the click and refreshes its caller', async () => {
    await render()
    act(() => {
      button('Import').click()
      expect(importer.importFromChrome).toHaveBeenCalledWith('chrome:Default', 'replace')
    })
    await act(async () => {})
    expect(toast.success).toHaveBeenCalledWith('Imported 4 cookies and 3 passwords from Chrome')
    expect(onImported).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it.each(['cookies', 'passwords'] as const)(
    'keeps %s failures visible after partial success',
    async (kind) => {
      importer.importFromChrome.mockResolvedValue({
        ...SUCCESS,
        [kind]:
          kind === 'cookies'
            ? { cookiesImported: 0, cookiesSkipped: 0, error: 'profile-unreadable' }
            : {
                passwordsAdded: 0,
                passwordsUpdated: 0,
                passwordsSkipped: 0,
                error: 'vault-unavailable',
              },
      })
      await render()
      await importProfile()
      expect(toast.warning).toHaveBeenCalledWith(
        expect.stringContaining(kind === 'cookies' ? 'Cookies:' : 'Passwords:')
      )
      expect(toast.success).not.toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalled()
      expect(onImported).toHaveBeenCalledOnce()
    }
  )

  it('does not call an unchanged import a failure', async () => {
    importer.importFromChrome.mockResolvedValue({
      cookies: { cookiesImported: 0, cookiesSkipped: 0 },
      passwords: { passwordsAdded: 0, passwordsUpdated: 0, passwordsSkipped: 3 },
    })
    await render()
    await importProfile()
    expect(toast.info).toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('reports saved passwords alongside a failure to read another password store', async () => {
    importer.importFromChrome.mockResolvedValue({
      ...SUCCESS,
      passwords: { ...SUCCESS.passwords, error: 'unsupported-schema' },
    })
    await render()
    await importProfile()
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining('Imported 4 cookies and 3 passwords from Chrome. Passwords:')
    )
    expect(toast.success).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onImported).toHaveBeenCalledOnce()
  })

  it('blocks duplicate clicks, Escape and Close until import settles', async () => {
    let finish!: (result: BrowserChromeImportResult) => void
    importer.importFromChrome.mockReturnValue(
      new Promise<BrowserChromeImportResult>((resolve) => {
        finish = resolve
      })
    )
    await render()
    act(() => {
      const trigger = button('Import')
      trigger.click()
      trigger.click()
    })
    expect(importer.importFromChrome).toHaveBeenCalledOnce()
    expect(button('Importing...').disabled).toBe(true)
    expect(button('Cancel').disabled).toBe(true)
    expect(button('Close').disabled).toBe(true)
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      )
    )
    expect(onOpenChange).not.toHaveBeenCalled()
    await act(async () => finish(SUCCESS))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('explains discovery failures and disables import', async () => {
    importer.listChromeProfiles.mockRejectedValue(new Error('Unavailable'))
    await render()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not load browser profiles'
    )
    expect(button('Import').disabled).toBe(true)
  })

  it('explains when no supported profiles exist', async () => {
    importer.listChromeProfiles.mockResolvedValue([])
    await render()
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      'No supported browser profiles'
    )
    expect(button('Import').disabled).toBe(true)
  })

  it('reports import failures and allows retry', async () => {
    importer.importFromChrome.mockRejectedValueOnce(new Error('Unavailable'))
    await render()
    await importProfile()
    expect(toast.error).toHaveBeenCalledWith('Could not import from that browser')
    expect(onOpenChange).not.toHaveBeenCalled()
    await importProfile()
    expect(onImported).toHaveBeenCalledOnce()
  })

  it('does not describe a refresh failure as an import failure', async () => {
    onImported.mockRejectedValueOnce(new Error('Unavailable'))
    await render()
    await importProfile()
    expect(toast.success).toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      'Import finished, but the browser could not refresh. Try reopening it.'
    )
  })
})
