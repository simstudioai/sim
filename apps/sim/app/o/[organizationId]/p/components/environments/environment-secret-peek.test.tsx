/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  permissions: vi.fn(),
  credentials: vi.fn(),
  environment: vi.fn(),
  save: vi.fn(),
}))
vi.mock('@/hooks/queries/workspace', () => ({ useWorkspacePermissionsQuery: mocks.permissions }))
vi.mock('@/hooks/queries/credentials', () => ({ useWorkspaceCredentials: mocks.credentials }))
vi.mock('@/hooks/queries/environment', () => ({
  useWorkspaceEnvironment: mocks.environment,
  useUpsertWorkspaceEnvironment: () => ({
    mutate: mocks.save,
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
}))
vi.mock('@sim/emcn', () => ({
  Chip: (props: ComponentProps<'button'>) => <button {...props} />,
  ChipInput: ({
    inputClassName,
    ...props
  }: ComponentProps<'input'> & { inputClassName?: string }) => (
    <input {...props} className={inputClassName} />
  ),
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { EnvironmentSecretPeek } from '@/app/o/[organizationId]/p/components/environments/environment-secret-peek'

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  mocks.permissions.mockReturnValue({ data: { viewer: { isAdmin: true } } })
  mocks.credentials.mockReturnValue({ data: [] })
  mocks.environment.mockReturnValue({
    data: { workspace: { TOKEN: 'test-only-value' }, personal: { TOKEN: 'personal-value' } },
    isLoading: false,
    isError: false,
    isSuccess: true,
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})
function render() {
  act(() =>
    root.render(
      <EnvironmentSecretPeek workspaceId='staging-id' environmentName='Staging' secretKey='TOKEN' />
    )
  )
}
function field() {
  const input = container.querySelector('input')
  if (!input) throw new Error('Missing secret field')
  return input
}
it('reveals an allowed read-only value on focus and masks it again on blur', () => {
  render()
  expect(field().value).toBe('•'.repeat(10))
  act(() => field().focus())
  expect(field().value).toBe('test-only-value')
  expect(field().readOnly).toBe(true)
  act(() => field().blur())
  expect(field().value).toBe('•'.repeat(10))
})
it('does not expose a cached value when reveal permission is absent', () => {
  mocks.permissions.mockReturnValue({ data: { viewer: { isAdmin: false } } })
  render()
  act(() => field().focus())
  expect(field().value).toBe('•'.repeat(10))
  expect(field().readOnly).toBe(true)
  expect(mocks.environment).toHaveBeenLastCalledWith('staging-id', { enabled: false })
})
it('only makes the field editable for the secret administrator', () => {
  mocks.credentials.mockReturnValue({ data: [{ envKey: 'TOKEN', role: 'admin' }] })
  render()
  act(() => field().focus())
  expect(field().readOnly).toBe(false)
  expect(field().value).toBe('test-only-value')
})
it('does not substitute a personal value for a missing workspace value', () => {
  mocks.environment.mockReturnValue({
    data: { workspace: {}, personal: { TOKEN: 'personal-value' } },
    isLoading: false,
    isError: false,
    isSuccess: true,
  })
  render()
  act(() => field().focus())
  expect(field().value).toBe('•'.repeat(10))
  expect(container.textContent).toContain('Not available in this environment.')
})

it('saves only the edited key to its own environment', () => {
  mocks.credentials.mockReturnValue({ data: [{ envKey: 'TOKEN', role: 'admin' }] })
  render()
  act(() => field().focus())
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(field(), 'replacement-test-value')
    field().dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() =>
    container
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  )
  expect(mocks.save).toHaveBeenCalledWith(
    { workspaceId: 'staging-id', variables: { TOKEN: 'replacement-test-value' } },
    expect.any(Object)
  )
})
