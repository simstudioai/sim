/**
 * @vitest-environment jsdom
 *
 * Removing an allowed sender stops their emails creating tasks. Failure mode: the row's remove
 * button removing the sender with no confirmation.
 */
import { act } from 'react'
import { stubDialog, stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const inbox = vi.hoisted(() => ({ removeSender: vi.fn(async () => undefined) }))
vi.mock('@/platform/lib/data/inbox', () => {
  const idle = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }
  return {
    useAddInboxSender: () => idle,
    useInboxSenders: () => ({
      isPending: false,
      data: {
        workspaceMembers: [],
        senders: [{ id: 'sender-1', email: 'boss@sim.test', label: null }],
      },
    }),
    useRawMountableSecretOptions: () => ({ options: [], isPending: false }),
    useRemoveInboxSender: () => ({ ...idle, mutateAsync: inbox.removeSender }),
    useUpdateInboxAddress: () => idle,
    useUpdateInboxSecretPolicy: () => idle,
  }
})

import { InboxSettings } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/inbox/inbox-settings'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  stubDialog()
  container = document.createElement('div')
  container.setAttribute('data-emcn', '')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

it('removes an allowed sender only once the viewer confirms', async () => {
  act(() =>
    root.render(
      <InboxSettings workspaceId='ws' address={null} secretScope='all' mountedSecrets={[]} />
    )
  )
  const remove = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Remove boss@sim.test"]'
  )
  await act(async () => remove?.click())
  expect(inbox.removeSender).not.toHaveBeenCalled()
  const confirm = [...document.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find(
    (button) => button.textContent === 'Remove'
  )
  await act(async () => confirm?.click())
  expect(inbox.removeSender).toHaveBeenCalledWith({ workspaceId: 'ws', senderId: 'sender-1' })
})
