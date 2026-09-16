/** @vitest-environment jsdom */
import { act, type ComponentProps, type ReactNode } from 'react'
import type { TabStrip } from '@sim/emcn'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  getChatResourceSelectionId,
  type MothershipResource,
} from '@/lib/mothership/resources/types'

const mocks = vi.hoisted(() => ({
  strip: vi.fn(),
  select: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
  add: vi.fn(),
  ownerQueries: vi.fn<
    (
      ...args: unknown[]
    ) => Array<{ data?: Array<{ id: string; workspaceId: string; name: string }> }>
  >(() => []),
  files: vi.fn(() => ({ data: [] })),
}))
vi.mock('@tanstack/react-query', () => ({ useQueries: mocks.ownerQueries }))
vi.mock('@sim/emcn', () => ({
  TabStrip: mocks.strip,
  Button: ({ children }: { children: ReactNode }) => children,
  Tooltip: {
    Root: ({ children }: { children: ReactNode }) => children,
    Trigger: ({ children }: { children: ReactNode }) => children,
    Content: ({ children }: { children: ReactNode }) => children,
  },
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
  toast: { error: vi.fn() },
  tabStripItemSelector: (id: string) => `[data-id="${id}"]`,
}))
vi.mock('@/hooks/queries/workflows', () => ({ useWorkflows: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/tables', () => ({ useTablesList: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/workspace-files', () => ({ useWorkspaceFiles: mocks.files }))
vi.mock('@/hooks/queries/kb/knowledge', () => ({ useKnowledgeBasesQuery: () => ({ data: [] }) }))
vi.mock('@/hooks/queries/folders', () => ({ useFolders: () => ({ data: [] }) }))
vi.mock('@/app/workspace/[workspaceId]/home/components/mothership-resources-context', () => ({
  useMothershipResources: () => ({
    selectResource: mocks.select,
    removeResource: mocks.remove,
    reorderResources: mocks.reorder,
    addResource: mocks.add,
  }),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown',
  () => ({ AddResourceDropdown: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry',
  () => ({ getResourceConfig: () => ({ renderTabIcon: () => null, label: 'Workflow' }) })
)
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/terminal-session/use-terminal-close-confirmation',
  () => ({
    useTerminalCloseConfirmation: () => ({
      confirmTerminalClose: async () => true,
      confirmationDialog: null,
    }),
  })
)

import { ResourceTabs } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tabs'

let root: Root
let container: HTMLDivElement
const first: MothershipResource = {
  type: 'file',
  id: 'files/report.csv',
  title: 'Report A',
  workspaceId: 'ws-a',
}
const second: MothershipResource = { ...first, title: 'Report B', workspaceId: 'ws-b' }
function props(): ComponentProps<typeof TabStrip> {
  return mocks.strip.mock.lastCall![0]
}
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.ownerQueries.mockReturnValue([])
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn())
  mocks.strip.mockReturnValue(null)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      <ResourceTabs
        resources={[first, second]}
        activeId={getChatResourceSelectionId(first)}
        desktopScopeId='org-chat'
        chatId='chat-a'
      />
    )
  )
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
it('distinguishes matching aliases in different workspaces without a default picker', async () => {
  expect(props().tabs.map((tab) => tab.id)).toEqual([
    getChatResourceSelectionId(first),
    getChatResourceSelectionId(second),
  ])
  expect(props().newTabControl).toBeUndefined()
  await act(async () => props().onSelect?.(getChatResourceSelectionId(second)))
  expect(mocks.select).toHaveBeenCalledWith(getChatResourceSelectionId(second))
  expect(mocks.files).toHaveBeenCalledWith('', 'active', { enabled: false })
})
it('closes only the addressed alias through the single owning persistence callback', async () => {
  await act(async () => props().onClose?.(getChatResourceSelectionId(second)))
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('file', 'files/report.csv', 'ws-b')
  expect(fetch).not.toHaveBeenCalled()
})
it('reorders the selected alias while retaining both owners', async () => {
  await act(async () => props().onReorder?.(getChatResourceSelectionId(second), 0))
  expect(mocks.reorder).toHaveBeenCalledExactlyOnceWith([second, first])
  expect(fetch).not.toHaveBeenCalled()
})

it('restores named workflow tabs across owners and ignores empty or wrong-owner names', async () => {
  const workflows: MothershipResource[] = [
    { type: 'workflow', id: 'flow-a', workspaceId: 'ws-a', title: 'Saved A' },
    { type: 'workflow', id: 'flow-b', workspaceId: 'ws-b', title: 'Saved B' },
  ]
  mocks.ownerQueries.mockReturnValue([
    { data: [{ id: 'flow-a', workspaceId: 'ws-a', name: 'Current A' }] },
    { data: [{ id: 'flow-b', workspaceId: 'wrong-owner', name: 'Wrong name' }] },
  ])
  await act(async () =>
    root.render(
      <ResourceTabs
        resources={workflows}
        activeId='flow-a'
        desktopScopeId='org-chat'
        chatId='chat-a'
      />
    )
  )
  expect(props().tabs.map((tab) => tab.title)).toEqual(['Current A', 'Saved B'])
  expect(
    mocks.ownerQueries.mock.lastCall![0].queries.map(
      (query: { queryKey: unknown }) => query.queryKey
    )
  ).toEqual([
    ['workflows', 'list', 'ws-a', 'active'],
    ['workflows', 'list', 'ws-b', 'active'],
  ])
  mocks.ownerQueries.mockReturnValue([
    { data: [{ id: 'flow-a', workspaceId: 'ws-a', name: '' }] },
    {},
  ])
  await act(async () =>
    root.render(
      <ResourceTabs
        resources={workflows}
        activeId='flow-b'
        desktopScopeId='org-chat'
        chatId='chat-a'
      />
    )
  )
  expect(props().tabs.map((tab) => tab.title)).toEqual(['Saved A', 'Saved B'])
})
