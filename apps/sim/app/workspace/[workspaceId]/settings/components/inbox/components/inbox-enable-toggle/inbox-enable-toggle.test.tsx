/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ enabled: false, toggle: vi.fn() }))
vi.mock('next/navigation', () => ({ useParams: () => ({ workspaceId: 'workspace-1' }) }))
vi.mock('@/hooks/queries/inbox', () => ({
  useInboxConfig: () => ({ data: { enabled: mocks.enabled, address: 'inbox@example.com' } }),
  useToggleInbox: () => useMutation({ mutationFn: mocks.toggle }),
}))
vi.mock('@sim/emcn', () => ({
  Label: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  ChipSwitch: ({ onChange }: { onChange: (value: string) => void }) => (
    <>
      <button type='button' onClick={() => onChange('enabled')}>
        On
      </button>
      <button type='button' onClick={() => onChange('disabled')}>
        Off
      </button>
    </>
  ),
  ChipModal: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <section role='dialog'>{children}</section> : null,
  ChipModalHeader: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  ChipModalBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalField: () => null,
  ChipModalError: ({ children }: { children: ReactNode }) =>
    children ? <p role='alert'>{children}</p> : null,
  ChipModalFooter: ({
    onCancel,
    primaryAction,
  }: {
    onCancel: () => void
    primaryAction: { label: string; onClick: () => void }
  }) => (
    <>
      <button type='button' onClick={onCancel}>
        Cancel
      </button>
      <button type='button' onClick={primaryAction.onClick}>
        {primaryAction.label}
      </button>
    </>
  ),
  ChipConfirmModal: ({
    open,
    children,
    onOpenChange,
    confirm,
  }: {
    open: boolean
    children: ReactNode
    onOpenChange: (open: boolean) => void
    confirm: { label: string; onClick: () => void }
  }) =>
    open ? (
      <section role='dialog'>
        {children}
        <button type='button' onClick={() => onOpenChange(false)}>
          Cancel
        </button>
        <button type='button' onClick={confirm.onClick}>
          {confirm.label}
        </button>
      </section>
    ) : null,
}))

import { InboxEnableToggle } from '@/app/workspace/[workspaceId]/settings/components/inbox/components/inbox-enable-toggle/inbox-enable-toggle'

let container: HTMLDivElement
let root: Root
let client: QueryClient
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.enabled = false
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
})
afterEach(() => {
  act(() => root.unmount())
  client.clear()
  container.remove()
  vi.useRealTimers()
})

function render() {
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <InboxEnableToggle />
      </QueryClientProvider>
    )
  )
}
async function click(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === label
  )
  expect(button).toBeDefined()
  await act(async () => {
    button?.click()
    await vi.runAllTimersAsync()
  })
}

describe('inbox setup error visibility', () => {
  it.each([
    { enabled: false, toggle: 'On', submit: 'Enable' },
    { enabled: true, toggle: 'Off', submit: 'Disable inbox' },
  ])(
    'keeps the dialog open and displays a failed $submit request',
    async ({ enabled, toggle, submit }) => {
      mocks.enabled = enabled
      mocks.toggle.mockRejectedValueOnce(new Error('Email service unavailable'))
      render()
      await click(toggle)
      await click(submit)
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        'Email service unavailable'
      )
      expect(container.querySelector('[role="dialog"]')).not.toBeNull()
      await click('Cancel')
      await click(toggle)
      expect(container.querySelector('[role="alert"]')).toBeNull()
    }
  )

  it('clears the failure and closes after a successful retry', async () => {
    mocks.toggle
      .mockRejectedValueOnce(new Error('Email service unavailable'))
      .mockResolvedValueOnce({ enabled: true })
    render()
    await click('On')
    await click('Enable')
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    await click('Enable')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.toggle).toHaveBeenCalledTimes(2)
  })
})
