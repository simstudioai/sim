/** @vitest-environment jsdom */
import { act, type KeyboardEvent } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  getChatResourceSelectionId,
  type MothershipResource,
} from '@/lib/mothership/resources/types'

const mocks = vi.hoisted(() => ({ clearWidth: vi.fn(), select: vi.fn(), add: vi.fn() }))
vi.mock('@/app/workspace/[workspaceId]/home/hooks/use-mothership-resize', () => ({
  useMothershipResize: () => ({
    mothershipRef: { current: null },
    handleResizePointerDown: vi.fn(),
    handleResizeKeyDown: (event: { key: string; preventDefault: () => void }) => {
      if (event.key === 'ArrowLeft') event.preventDefault()
    },
    handleResizeFocus: vi.fn(),
    clearWidth: mocks.clearWidth,
  }),
}))

import {
  useChatResourcePanel,
  useResourcePanelController,
} from '@/app/workspace/[workspaceId]/home/hooks/use-resource-panel'

let root: Root
let container: HTMLDivElement
let panel: ReturnType<typeof useChatResourcePanel>
const resource: MothershipResource = {
  type: 'file',
  id: 'files/report.csv',
  title: 'Report',
  workspaceId: 'ws-a',
}
const chat = {
  desktopScopeId: 'org-chat-a',
  activeResourceId: getChatResourceSelectionId(resource),
  resolvedChatId: 'chat-a',
  resources: [resource],
  addResource: mocks.add,
  removeResource: vi.fn(),
  setActiveResourceId: mocks.select,
}
function Probe() {
  const controller = useResourcePanelController()
  panel = useChatResourcePanel(chat, controller)
  return <div data-active={controller.activeResourceParam ?? ''} />
}
beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0)
  )
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      <NuqsTestingAdapter hasMemory>
        <Probe />
      </NuqsTestingAdapter>
    )
  )
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
it('keeps user collapse while marking another workspace resource as updated', async () => {
  expect(panel.isResourceCollapsed).toBe(false)
  await act(async () => panel.collapseResource())
  const second = getChatResourceSelectionId({ ...resource, workspaceId: 'ws-b' })
  await act(async () => panel.onResourceEvent(second))
  expect(panel.isResourceCollapsed).toBe(true)
  expect(panel.resourceActivityIds.has(second)).toBe(true)
  expect(mocks.select).not.toHaveBeenCalled()
})
it('selects and expands the explicitly chosen scoped alias', async () => {
  await act(async () => panel.collapseResource())
  const second = { ...resource, workspaceId: 'ws-b' }
  await act(async () => panel.addResourceFromUser(second))
  expect(mocks.add).toHaveBeenCalledWith(second)
  expect(mocks.select).toHaveBeenCalledWith(getChatResourceSelectionId(second))
  expect(panel.isResourceCollapsed).toBe(false)
})

it.each([false, true])(
  'reveals completed cited sources after a user selection (collapsed=%s)',
  async (collapsed) => {
    await act(async () => panel.addResourceFromUser(resource))
    if (collapsed) await act(async () => panel.collapseResource())
    await act(async () => panel.onResourceEvent('cited-sources', { revealCitedSources: true }))
    expect(panel.isResourceCollapsed).toBe(false)
    expect(panel.resourceActivityIds.has('cited-sources')).toBe(false)
    expect(container.querySelector('[data-active]')?.getAttribute('data-active')).toBe(
      'cited-sources'
    )
  }
)

it('claims the resource view only when a divider key actually resizes it', async () => {
  const press = (key: string) => {
    const event = {
      key,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true
      },
    }
    panel.handleResourceResizeKeyDown(event as unknown as KeyboardEvent<HTMLDivElement>)
  }
  panel.resourceSelectionOwnedByUserRef.current = false
  press('Tab')
  expect(panel.resourceSelectionOwnedByUserRef.current).toBe(false)
  press('ArrowLeft')
  expect(panel.resourceSelectionOwnedByUserRef.current).toBe(true)
})
