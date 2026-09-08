/**
 * @vitest-environment jsdom
 */
import { act, createRef } from 'react'
import type { DesktopPreferences } from '@sim/desktop-bridge'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixtures = vi.hoisted(() => ({
  browserAvailable: vi.fn(() => true),
  terminalAvailable: vi.fn(() => true),
  resources: { data: [{ id: 'resource-1', name: 'Example' }], isPending: false },
  folders: {
    data: [] as { id: string; name: string; parentId: string | null }[],
    isPending: false,
  },
  tableFolders: {
    data: [] as { id: string; name: string; parentId: string | null }[],
    isPending: false,
  },
  knowledgeFolders: {
    data: [] as { id: string; name: string; parentId: string | null }[],
    isPending: false,
  },
  tabs: [],
  logs: {
    data: {
      pages: [{ logs: [{ id: 'log-1', createdAt: '2026-01-01T12:00:00Z', status: 'success' }] }],
    },
    isPending: false,
  },
}))

vi.mock('@/lib/browser-agent/transport', () => ({
  isBrowserAgentAvailable: fixtures.browserAvailable,
}))
vi.mock('@/lib/terminal/transport', () => ({
  isTerminalAvailable: fixtures.terminalAvailable,
}))
vi.mock('@/hooks/queries/workflows', () => ({ useWorkflows: () => fixtures.resources }))
vi.mock('@/hooks/queries/tables', () => ({ useTablesList: () => fixtures.resources }))
vi.mock('@/hooks/queries/workspace-files', () => ({ useWorkspaceFiles: () => fixtures.resources }))
vi.mock('@/hooks/queries/kb/knowledge', () => ({
  useKnowledgeBasesQuery: () => fixtures.resources,
}))
vi.mock('@/hooks/queries/folders', () => ({
  useFolders: (_workspaceId: string, options?: { resourceType?: string }) =>
    options?.resourceType === 'table'
      ? fixtures.tableFolders
      : options?.resourceType === 'knowledge_base'
        ? fixtures.knowledgeFolders
        : fixtures.folders,
}))
vi.mock('@/hooks/queries/workspace-file-folders', () => ({
  useWorkspaceFileFolders: () => fixtures.folders,
}))
vi.mock('@/hooks/queries/mothership-chats', () => ({
  useMothershipChats: () => fixtures.resources,
}))
vi.mock('@/hooks/queries/logs', () => ({ useLogsList: () => fixtures.logs }))
vi.mock('@/blocks/integration-matcher', () => ({
  listIntegrationsByPopularity: () => [
    { blockType: 'example', name: 'Example integration', icon: () => null },
  ],
}))
vi.mock('@/stores/browser-session/store', () => ({ useBrowserSessionStore: () => fixtures.tabs }))
vi.mock('@/stores/copilot-terminal/store', () => ({ useCopilotTerminalStore: () => fixtures.tabs }))

import {
  BROWSER_SESSION_RESOURCE_ID,
  TERMINAL_SESSION_RESOURCE_ID,
} from '@/lib/copilot/resources/types'
import { setDesktopPreferencesSnapshot } from '@/lib/desktop'
import {
  mapResourceToContext,
  type PlusMenuHandle,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components/constants'
import { PlusMenuDropdown } from '@/app/workspace/[workspaceId]/home/components/user-input/components/plus-menu-dropdown/plus-menu-dropdown'

let root: Root
let container: HTMLDivElement

const PREFERENCES: DesktopPreferences = {
  notificationsEnabled: true,
  notificationSounds: true,
  notificationsOnlyWhenUnfocused: true,
  launchAtLogin: false,
  autoDownloadUpdates: true,
  browserEnabled: true,
  terminalEnabled: true,
}

function openMenu(mention = false, mentionQuery?: string) {
  const ref = createRef<PlusMenuHandle>()
  const onResourceSelect = vi.fn()
  act(() =>
    root.render(
      <PlusMenuDropdown
        ref={ref}
        workspaceId='workspace-1'
        mentionQuery={mentionQuery}
        onResourceSelect={onResourceSelect}
        onClose={vi.fn()}
        textareaRef={createRef<HTMLTextAreaElement>()}
        pendingCursorRef={{ current: null }}
      />
    )
  )
  act(() => ref.current?.open({ left: 0, top: 0 }, { mention }))
  return { ref, onResourceSelect }
}

function menuItems(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
    (item) => !item.closest('[hidden]')
  )
}

function selectItem(name: string) {
  const item = menuItems().find((item) => item.textContent === name)
  if (!item) throw new Error(`Missing menu item: ${name}`)
  act(() => item.click())
}

describe('PlusMenuDropdown desktop resources', () => {
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(
    Element.prototype,
    'scrollIntoView'
  )

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    vi.clearAllMocks()
    fixtures.resources.data = [{ id: 'resource-1', name: 'Example' }]
    for (const folders of [fixtures.folders, fixtures.tableFolders, fixtures.knowledgeFolders]) {
      folders.data = []
      folders.isPending = false
    }
    fixtures.browserAvailable.mockReturnValue(true)
    fixtures.terminalAvailable.mockReturnValue(true)
    setDesktopPreferencesSnapshot(PREFERENCES)
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    if (originalScrollIntoView) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView)
    } else {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
    vi.unstubAllGlobals()
  })

  it('keeps shared categories in the same order in browse and mention modes', () => {
    const { ref } = openMenu()
    const browseOrder = menuItems().map((item) => item.textContent)
    expect(browseOrder).toEqual([
      'Chats',
      'Tables',
      'Files',
      'Knowledge Bases',
      'Workflows',
      'Logs',
      'Browser',
      'Terminal',
    ])

    act(() => ref.current?.open({ left: 0, top: 0 }, { mention: true }))
    const headings = menuItems().map((item) => item.previousElementSibling?.textContent)
    expect(headings).toEqual(['Integrations', ...browseOrder])
  })

  it.each([false, true])('selects the same whole Browser in mention=%s mode', (mention) => {
    const { onResourceSelect } = openMenu(mention)
    selectItem('Browser')

    expect(onResourceSelect).toHaveBeenCalledExactlyOnceWith({
      type: 'browser',
      id: BROWSER_SESSION_RESOURCE_ID,
      title: 'Browser',
    })
    expect(mapResourceToContext(onResourceSelect.mock.calls[0][0])).toEqual({
      kind: 'browser_tab',
      tabId: BROWSER_SESSION_RESOURCE_ID,
      label: 'Browser',
    })
  })

  it.each([false, true])(
    'updates mounted desktop rows when preferences change in mention=%s mode',
    (mention) => {
      openMenu(mention)
      expect(menuItems().map((item) => item.textContent)).toContain('Browser')

      fixtures.browserAvailable.mockReturnValue(false)
      act(() => setDesktopPreferencesSnapshot({ ...PREFERENCES, browserEnabled: false }))
      expect(menuItems().map((item) => item.textContent)).not.toContain('Browser')
      expect(menuItems().map((item) => item.textContent)).toContain('Terminal')
    }
  )

  it('finds Browser through plus-menu search and selects it with Enter', () => {
    const { onResourceSelect } = openMenu()
    const search = document.querySelector<HTMLInputElement>(
      'input[placeholder="Search resources..."]'
    )
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!search || !valueSetter) throw new Error('Search input is unavailable')
    act(() => {
      valueSetter.call(search, 'browser')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(menuItems().map((item) => item.textContent)).toEqual(['Browser'])
    act(() => search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(onResourceSelect).toHaveBeenCalledExactlyOnceWith({
      type: 'browser',
      id: BROWSER_SESSION_RESOURCE_ID,
      title: 'Browser',
    })
  })

  it.each([false, true])('keeps unavailable Browser hidden in mention=%s mode', (mention) => {
    fixtures.browserAvailable.mockReturnValue(false)
    const { onResourceSelect } = openMenu(mention)
    expect(menuItems().some((item) => item.textContent === 'Browser')).toBe(false)
    selectItem('Terminal')
    expect(onResourceSelect).toHaveBeenCalledExactlyOnceWith({
      type: 'terminal',
      id: TERMINAL_SESSION_RESOURCE_ID,
      title: 'Terminal',
    })
  })

  it.each([false, true])('omits both desktop resources on web in mention=%s mode', (mention) => {
    fixtures.browserAvailable.mockReturnValue(false)
    fixtures.terminalAvailable.mockReturnValue(false)
    openMenu(mention)
    const names = menuItems().map((item) => item.textContent)
    expect(names).not.toContain('Browser')
    expect(names).not.toContain('Terminal')
  })

  it.each(['tableFolders', 'knowledgeFolders'] as const)(
    'selects an empty %s folder by @ mention and preserves its ID',
    (family) => {
      fixtures[family].data = [{ id: 'folder-1', name: 'Planning', parentId: null }]
      const { ref, onResourceSelect } = openMenu(true, 'Planning')
      act(() => {
        expect(ref.current?.selectActive()).toBe('selected')
      })
      expect(mapResourceToContext(onResourceSelect.mock.calls[0][0])).toEqual({
        kind: 'folder',
        folderId: 'folder-1',
        label: 'Planning',
      })
    }
  )

  it.each(['tableFolders', 'knowledgeFolders'] as const)(
    'waits for %s hydration before submitting an unresolved mention',
    (family) => {
      fixtures[family].isPending = true
      const { ref, onResourceSelect } = openMenu(true, 'Planning')
      expect(ref.current?.selectActive()).toBe('hydrating')
      expect(onResourceSelect).not.toHaveBeenCalled()
    }
  )

  it('keeps empty table and knowledge folder families in the attachment browse menu', () => {
    fixtures.resources.data = []
    fixtures.tableFolders.data = [{ id: 'table-folder', name: 'Table Planning', parentId: null }]
    fixtures.knowledgeFolders.data = [
      { id: 'kb-folder', name: 'Knowledge Planning', parentId: null },
    ]
    openMenu()
    expect(menuItems().map((item) => item.textContent)).toEqual(
      expect.arrayContaining(['Tables', 'Knowledge Bases'])
    )
  })
})
