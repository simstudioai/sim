/** @vitest-environment jsdom */
import { act } from 'react'
import type { ComputerUseActivity } from '@sim/desktop-bridge'
import { libDesktopMock, libDesktopMockFns } from '@sim/testing/mocks/lib-desktop.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resolveMothershipModelSettings } from '@/lib/mothership/model-options'
import { MothershipChat } from '@/app/workspace/[workspaceId]/home/components/mothership-chat/mothership-chat'
import { ModelSelector } from '@/app/workspace/[workspaceId]/home/components/user-input/components/model-selector'
import { FeatureFlagsProvider } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'
import {
  useMothershipEffortStore,
  useMothershipPlanEffortStore,
} from '@/stores/mothership-effort/store'

vi.mock('@/lib/desktop', () => libDesktopMock)
const native = vi.hoisted(() => ({
  getActivity: vi.fn<() => Promise<ComputerUseActivity | null>>(),
  onActivity: vi.fn<(listener: (activity: ComputerUseActivity | null) => void) => () => void>(),
  cancel: vi.fn<() => Promise<void>>(),
}))
let root: Root
let container: HTMLDivElement
let client: QueryClient
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
  useMothershipEffortStore.getState().reset()
  useMothershipPlanEffortStore.getState().reset()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  libDesktopMockFns.mockGetDesktopBridge.mockReturnValue({ computerUse: native })
  native.getActivity.mockResolvedValue(null)
  native.onActivity.mockReturnValue(() => {})
  native.cancel.mockResolvedValue(undefined)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  container.remove()
})
async function render(advanced: boolean, workspaceId?: string) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <FeatureFlagsProvider
          flags={{
            dashboards: false,
            'workflow-tests': false,
            changelog: false,
            'mothership-model-selector': advanced,
            'mothership-plan-mode': true,
            'mothership-computer-use': false,
          }}
        >
          <MothershipChat
            workspaceId={workspaceId}
            messages={[]}
            isSending={false}
            onSubmit={vi.fn()}
            onStopGeneration={vi.fn()}
            messageQueue={[]}
            editingQueuedId={null}
            dispatchingHeadId={null}
            onRemoveQueuedMessage={vi.fn()}
            onSendQueuedMessage={async () => {}}
            onEditQueuedMessage={() => undefined}
            onCancelQueueEdit={vi.fn()}
            composer={<ModelSelector plan />}
          />
        </FeatureFlagsProvider>
      </QueryClientProvider>
    )
  )
}
it('hides the Plan model picker while its rollout is off but preserves the request default', async () => {
  useMothershipPlanEffortStore.getState().setModel('gpt-6-astra')
  useMothershipPlanEffortStore.getState().setFastMode(true)
  await render(false)
  expect(container.querySelector('button[aria-label="Model"]')).toBeNull()
  expect(container.textContent).not.toContain('Fast')
  expect(
    resolveMothershipModelSettings(useMothershipPlanEffortStore.getState(), false, true)
      .modelSelection
  ).toEqual({ model: 'claude-opus-5-5', fastMode: false })
  await render(true)
  const picker = container.querySelector<HTMLButtonElement>('button[aria-label="Model"]')
  expect(picker?.getAttribute('aria-description')).toBe('GPT-6 Astra')
  await act(async () =>
    picker?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  )
  const opus = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) =>
    element.textContent?.includes('Opus 5.5')
  )
  expect(opus).toBeDefined()
  await act(async () => opus?.click())
  expect(useMothershipPlanEffortStore.getState().modelSelection).toEqual({
    model: 'claude-opus-5-5',
    fastMode: false,
  })
})
it.each([undefined, 'workspace'])(
  'chat %s exposes active native action and Stop while rollout is off',
  async (workspaceId) => {
    await render(false, workspaceId)
    const listener = native.onActivity.mock.calls[0]?.[0]
    expect(listener).toBeDefined()
    if (!listener) throw new Error('Chat did not subscribe to native activity')
    await act(async () =>
      listener({
        toolCallId: 'action',
        scopeId: 'chat',
        appName: 'Synthetic app',
        action: 'type_text',
        startedAt: 1,
        stopShortcutAvailable: true,
      })
    )
    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('Synthetic app · Typing')
    const stop = status?.querySelector<HTMLButtonElement>('button')
    expect(stop?.getAttribute('aria-keyshortcuts')).toBe('Meta+Shift+Escape')
    await act(async () => stop?.click())
    expect(native.cancel).toHaveBeenCalledOnce()
    await act(async () => listener(null))
    expect(container.querySelector('[role="status"]')).toBeNull()
  }
)
