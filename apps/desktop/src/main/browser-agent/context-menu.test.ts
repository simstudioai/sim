import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import { Menu, WebContentsView } from 'electron'
import { clickAt, PRIMARY_CLICK } from '@/main/browser-agent/cdp'
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
  return {
    canGoBack: true,
    canGoForward: true,
    zoomFactor: BASE_ZOOM_FACTOR,
    defaultZoomFactor: BASE_ZOOM_FACTOR,
    ...overrides,
  }
}

function handlers(): Handlers {
  return {
    addToChat: vi.fn(),
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
  it('puts Add to chat first and preserves the exact nonblank selection', () => {
    const handled = handlers()
    const template = buildAgentContextMenuTemplate(
      params({ selectionText: '  selected\ntext  ', linkURL: 'https://example.com/docs' }),
      page(),
      handled
    )

    expect(labels(template)[0]).toBe('Add to chat')
    item(template, 'Add to chat')?.click?.({} as never, undefined as never, {} as never)
    expect(handled.addToChat).toHaveBeenCalledWith('  selected\ntext  ')
    expect(
      labels(buildAgentContextMenuTemplate(params({ selectionText: ' \n ' }), page(), handlers()))
    ).not.toContain('Add to chat')
  })
})

describe('attachAgentContextMenu', () => {
  type ContextMenuListener = (event: unknown, params: Params) => void

  it('suppresses one agent context menu and immediately allows the next menu', async () => {
    const contents = new WebContentsView().webContents
    attachAgentContextMenu(contents, {
      addToChat: vi.fn(),
      openTab: vi.fn(),
      defaultZoomFactor: () => BASE_ZOOM_FACTOR,
    })
    const listeners = vi.mocked(contents.on).mock.calls as unknown as [
      string,
      ContextMenuListener,
    ][]
    const onContextMenu = listeners.find(([event]) => event === 'context-menu')![1]
    await clickAt(contents, 10, 20, false, { ...PRIMARY_CLICK, button: 'right' })
    vi.mocked(Menu.buildFromTemplate).mockClear()

    onContextMenu({}, params())
    expect(Menu.buildFromTemplate).not.toHaveBeenCalled()
    onContextMenu({}, params())
    expect(Menu.buildFromTemplate).toHaveBeenCalledTimes(1)
  })

  it.each(['mouseDown', 'keyDown', 'touchStart'])(
    'allows human %s when a page prevents the agent context menu event',
    async (inputEvent) => {
      const contents = new WebContentsView().webContents
      attachAgentContextMenu(contents, {
        addToChat: vi.fn(),
        openTab: vi.fn(),
        defaultZoomFactor: () => BASE_ZOOM_FACTOR,
      })
      const listeners = vi.mocked(contents.on).mock.calls as unknown as [
        string,
        (event: unknown, params: unknown) => void,
      ][]
      const onInput = listeners.find(([event]) => event === 'input-event')?.[1]
      const onContextMenu = listeners.find(([event]) => event === 'context-menu')![1]
      await clickAt(contents, 10, 20, false, { ...PRIMARY_CLICK, button: 'right' })
      vi.mocked(Menu.buildFromTemplate).mockClear()

      onInput?.({}, { type: inputEvent })
      onContextMenu({}, params())
      expect(Menu.buildFromTemplate).toHaveBeenCalledTimes(1)
    }
  )
})

describe('steppedZoomFactor', () => {
  it('clamps at both ends so a step never runs away', () => {
    expect(steppedZoomFactor(3, 1)).toBe(3)
    expect(steppedZoomFactor(0.5, -1)).toBe(0.5)
  })
})

describe('zoomPercentOf', () => {
  it('reports every rung relative to the panel baseline, not to native', () => {
    expect(zoomPercentOf(steppedZoomFactor(BASE_ZOOM_FACTOR, -1))).toBe(91)
    expect(zoomPercentOf(BASE_ZOOM_FACTOR)).toBe(100)
    expect(zoomPercentOf(steppedZoomFactor(BASE_ZOOM_FACTOR, 1))).toBe(110)
  })
})
