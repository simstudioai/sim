/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn(), reset: vi.fn() }))
vi.mock('@/hooks/queries/credential-group-api-keys', () => ({
  useSaveCredentialGroupApiKey: () => ({
    mutate: mocks.save,
    reset: mocks.reset,
    isPending: false,
    error: null,
  }),
  useDeleteCredentialGroupApiKey: () => ({
    mutate: mocks.remove,
    reset: mocks.reset,
    isPending: false,
    error: null,
  }),
}))

import { CredentialGroupApiKeyInput } from '@/app/credential-groups/enroll/[token]/api-key-input'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
it('never reads back a connected key, and clears the submitted value after success', async () => {
  mocks.save.mockImplementation((_body, callbacks) => callbacks.onSuccess())
  await act(async () =>
    root.render(
      <CredentialGroupApiKeyInput
        token='fixture-token'
        option={{
          id: 'option-1',
          name: 'Exa API key',
          description: 'Use your personal Exa key',
          connected: true,
        }}
      />
    )
  )
  const input = container.querySelector('input')!
  expect(input.type).toBe('password')
  expect(input.value).toBe('')
  expect(container.textContent).toContain('Use your personal Exa key')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'fixture-secret'
    )
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  )
  expect(mocks.save).toHaveBeenCalledWith({ value: 'fixture-secret' }, expect.anything())
  expect(input.value).toBe('')
  expect(mocks.reset).toHaveBeenCalled()
})
it('lets the invitee disconnect their key without submitting another value', async () => {
  await act(async () =>
    root.render(
      <CredentialGroupApiKeyInput
        token='fixture-token'
        option={{ id: 'option-1', name: 'Exa API key', description: null, connected: true }}
      />
    )
  )
  const disconnect = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === 'Disconnect'
  )!
  expect(disconnect.type).toBe('button')
  await act(async () => disconnect.click())
  expect(mocks.remove).toHaveBeenCalled()
  expect(mocks.save).not.toHaveBeenCalled()
})
