/** @vitest-environment jsdom */
import { act } from 'react'
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
  return null
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
