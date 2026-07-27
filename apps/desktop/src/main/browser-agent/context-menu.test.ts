import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { Menu, WebContentsView } from 'electron'
import {
  attachAgentContextMenu,
  BASE_ZOOM_FACTOR,
  buildAgentContextMenuTemplate,
  steppedZoomFactor,
  zoomPercentOf,
} from '@/main/browser-agent/context-menu'

const EDIT_FLAGS: ContextMenuParams['editFlags'] = {
  canUndo: false,
  canRedo: false,
  canCut: false,
  canCopy: false,
  canPaste: false,
  canDelete: false,
  canSelectAll: false,
  canEditRichly: false,
}

type Params = Parameters<typeof buildAgentContextMenuTemplate>[0]
type Page = Parameters<typeof buildAgentContextMenuTemplate>[1]
type Handlers = Parameters<typeof buildAgentContextMenuTemplate>[2]

function params(overrides: Partial<Params> = {}): Params {
  return { selectionText: '', linkURL: '', isEditable: false, editFlags: EDIT_FLAGS, ...overrides }
}

function page(overrides: Partial<Page> = {}): Page {
  // A fresh tab sits at the panel's baseline, which the menu reports as 100%.
  return { canGoBack: true, canGoForward: true, zoomFactor: BASE_ZOOM_FACTOR, ...overrides }
}

function handlers(): Handlers {
  return {
    copy: vi.fn(),
    paste: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    reload: vi.fn(),
    openTab: vi.fn(),
    copyLink: vi.fn(),
    setZoomFactor: vi.fn(),
  }
}

const labels = (template: MenuItemConstructorOptions[]) =>
  template.filter((item) => item.type !== 'separator').map((item) => item.label)

const item = (template: MenuItemConstructorOptions[], label: string) =>
  template.find((entry) => entry.label === label)

describe('buildAgentContextMenuTemplate', () => {
  it('always offers navigation and zoom, whatever was clicked', () => {
    const template = buildAgentContextMenuTemplate(params(), page(), handlers())

    // Unlike the main window's menu, an empty template is not an option here:
    // the page has no menu of its own to fall back to.
    expect(labels(template)).toEqual([
      'Back',
      'Forward',
      'Reload',
      'Zoom In',
      'Zoom Out',
      'Actual Size (100%)',
    ])
  })

  it('offers clipboard items only where the click can use them', () => {
    expect(labels(buildAgentContextMenuTemplate(params(), page(), handlers()))).not.toContain(
      'Copy'
    )

    const withSelection = buildAgentContextMenuTemplate(
      params({ selectionText: '  hello  ' }),
      page(),
      handlers()
    )
    expect(labels(withSelection)).toContain('Copy')

    const inField = buildAgentContextMenuTemplate(
      params({ isEditable: true, editFlags: { ...EDIT_FLAGS, canPaste: true } }),
      page(),
      handlers()
    )
    expect(labels(inField)).toContain('Paste')

    // A read-only field can report canPaste; both signals have to agree.
    const readOnly = buildAgentContextMenuTemplate(
      params({ isEditable: false, editFlags: { ...EDIT_FLAGS, canPaste: true } }),
      page(),
      handlers()
    )
    expect(labels(readOnly)).not.toContain('Paste')
  })

  it('offers link items for http(s) targets only', () => {
    const handled = handlers()
    const template = buildAgentContextMenuTemplate(
      params({ linkURL: 'https://example.com/docs' }),
      page(),
      handled
    )
    expect(labels(template)).toContain('Open Link in New Tab')

    item(template, 'Open Link in New Tab')?.click?.({} as never, undefined as never, {} as never)
    expect(handled.openTab).toHaveBeenCalledWith('https://example.com/docs')

    // The actions open a tab or copy an address; neither means anything for a
    // script or mail target, so the menu must not offer them.
    for (const linkURL of ['javascript:alert(1)', 'mailto:a@b.com', 'file:///etc/passwd']) {
      const other = buildAgentContextMenuTemplate(params({ linkURL }), page(), handlers())
      expect(labels(other)).not.toContain('Open Link in New Tab')
      expect(labels(other)).not.toContain('Copy Link Address')
    }
  })

  it('disables navigation the page cannot do', () => {
    const template = buildAgentContextMenuTemplate(
      params(),
      page({ canGoBack: false, canGoForward: false }),
      handlers()
    )

    expect(item(template, 'Back')?.enabled).toBe(false)
    expect(item(template, 'Forward')?.enabled).toBe(false)
    expect(item(template, 'Reload')?.enabled).toBeUndefined()
  })

  it('reports the current zoom and disables the ends of the ladder', () => {
    // Two rungs up from the baseline, reported against the baseline rather than
    // against Chromium's native scale (where this factor would read 110%).
    const twoUp = steppedZoomFactor(steppedZoomFactor(BASE_ZOOM_FACTOR, 1), 1)
    const stepped = buildAgentContextMenuTemplate(params(), page({ zoomFactor: twoUp }), handlers())
    expect(item(stepped, 'Actual Size (121%)')?.enabled).toBe(true)

    const atMax = buildAgentContextMenuTemplate(params(), page({ zoomFactor: 3 }), handlers())
    expect(item(atMax, 'Zoom In')?.enabled).toBe(false)
    expect(item(atMax, 'Zoom Out')?.enabled).toBe(true)

    const atMin = buildAgentContextMenuTemplate(params(), page({ zoomFactor: 0.5 }), handlers())
    expect(item(atMin, 'Zoom Out')?.enabled).toBe(false)

    // Nothing to reset to at 100%.
    expect(
      item(buildAgentContextMenuTemplate(params(), page(), handlers()), 'Actual Size (100%)')
        ?.enabled
    ).toBe(false)
  })

  it('resets to exactly the baseline, undoing accumulated drift', () => {
    const handled = handlers()
    // Three rungs of float multiplication up, so the factor no longer sits on a
    // clean value — reset has to restore the baseline exactly, not step back.
    const drifted = [1, 1, 1].reduce((factor) => steppedZoomFactor(factor, 1), BASE_ZOOM_FACTOR)
    const template = buildAgentContextMenuTemplate(params(), page({ zoomFactor: drifted }), handled)

    item(template, 'Actual Size (133%)')?.click?.({} as never, undefined as never, {} as never)

    expect(handled.setZoomFactor).toHaveBeenCalledWith(BASE_ZOOM_FACTOR)
  })

  it('never leaves a separator with nothing above it', () => {
    for (const p of [
      params(),
      params({ selectionText: 'hi' }),
      params({ linkURL: 'https://example.com' }),
      params({ isEditable: true, editFlags: { ...EDIT_FLAGS, canPaste: true } }),
    ]) {
      const template = buildAgentContextMenuTemplate(p, page(), handlers())
      expect(template[0].type).not.toBe('separator')
      expect(template[template.length - 1].type).not.toBe('separator')
      expect(
        template.some(
          (entry, index) => entry.type === 'separator' && template[index - 1]?.type === 'separator'
        )
      ).toBe(false)
    }
  })
})

describe('attachAgentContextMenu', () => {
  type ContextMenuListener = (event: unknown, params: Params) => void

  it('pops a menu built from the page that was right-clicked', () => {
    const contents = new WebContentsView().webContents
    vi.mocked(contents.navigationHistory.canGoBack).mockReturnValue(true)
    attachAgentContextMenu(contents, { openTab: vi.fn() })

    const listeners = vi.mocked(contents.on).mock.calls as unknown as [
      string,
      ContextMenuListener,
    ][]
    const onContextMenu = listeners.find(([event]) => event === 'context-menu')?.[1]
    expect(onContextMenu).toBeDefined()
    onContextMenu?.({}, params())

    const template = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)?.[0] as
      | MenuItemConstructorOptions[]
      | undefined
    // The template is read off the live page, not a snapshot of it.
    expect(item(template ?? [], 'Back')?.enabled).toBe(true)
    expect(item(template ?? [], 'Forward')?.enabled).toBe(false)
  })
})

describe('steppedZoomFactor', () => {
  it('steps up and down from the current factor', () => {
    expect(steppedZoomFactor(1, 1)).toBe(1.1)
    expect(steppedZoomFactor(1, -1)).toBe(1 / 1.1)
  })

  it('clamps at both ends so a step never runs away', () => {
    expect(steppedZoomFactor(3, 1)).toBe(3)
    expect(steppedZoomFactor(0.5, -1)).toBe(0.5)
  })

  it('treats a nonsense factor as the baseline', () => {
    // One rung up from the baseline is Chromium's native 1.0.
    expect(steppedZoomFactor(Number.NaN, 1)).toBe(1)
    expect(steppedZoomFactor(0, 1)).toBe(1)
  })
})

describe('BASE_ZOOM_FACTOR', () => {
  it('renders a rung below native but reads as 100%', () => {
    expect(BASE_ZOOM_FACTOR).toBeCloseTo(0.909, 3)
    expect(zoomPercentOf(BASE_ZOOM_FACTOR)).toBe(100)
  })

  it('keeps the ladder landing exactly on Chromium native one step up', () => {
    expect(steppedZoomFactor(BASE_ZOOM_FACTOR, 1)).toBe(1)
    expect(zoomPercentOf(1)).toBe(110)
  })

  it('stays inside the ladder, so the page menu can still step both ways', () => {
    expect(steppedZoomFactor(BASE_ZOOM_FACTOR, 1)).not.toBe(BASE_ZOOM_FACTOR)
    expect(steppedZoomFactor(BASE_ZOOM_FACTOR, -1)).not.toBe(BASE_ZOOM_FACTOR)
  })
})

describe('zoomPercentOf', () => {
  it('reports every rung relative to the panel baseline, not to native', () => {
    expect(zoomPercentOf(steppedZoomFactor(BASE_ZOOM_FACTOR, -1))).toBe(91)
    expect(zoomPercentOf(BASE_ZOOM_FACTOR)).toBe(100)
    expect(zoomPercentOf(steppedZoomFactor(BASE_ZOOM_FACTOR, 1))).toBe(110)
  })

  it('still reads 100% after a round trip up and back down', () => {
    // The ladder is float arithmetic, so the reset item's `!== 100` guard has to
    // survive a step that does not return bit-identically to the baseline.
    const roundTripped = steppedZoomFactor(steppedZoomFactor(BASE_ZOOM_FACTOR, 1), -1)
    expect(zoomPercentOf(roundTripped)).toBe(100)
  })
})
