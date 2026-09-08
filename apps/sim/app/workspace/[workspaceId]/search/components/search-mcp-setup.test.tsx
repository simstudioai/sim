/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createKey: vi.fn(),
  refetchPolicy: vi.fn(),
  isPending: false,
  allowPersonalApiKeys: true,
  policy: {
    isSuccess: true,
    isError: false,
    isFetching: false,
    error: null as Error | null,
    data: { config: { disablePersonalApiKeys: false } },
  },
}))

vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.fixture.test' }))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useWorkspaceHostContext: () => ({
    workspace: { allowPersonalApiKeys: mocks.allowPersonalApiKeys },
  }),
}))
vi.mock('@/ee/access-control/hooks/permission-groups', () => ({
  useUserPermissionConfig: () => ({ ...mocks.policy, refetch: mocks.refetchPolicy }),
}))
vi.mock('@/hooks/queries/api-keys', () => ({
  useCreateApiKey: () => ({ mutateAsync: mocks.createKey, isPending: mocks.isPending }),
}))

import { SearchMcpSetup } from '@/app/workspace/[workspaceId]/search/components/search-mcp-setup'

const CREATED_KEY = {
  id: 'key-1',
  name: 'Search client',
  key: 'sim_fixture_personal_secret',
  createdAt: '2026-09-05T00:00:00.000Z',
  lastUsed: null,
}

function findDialog(title: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find((dialog) => {
    const labelId = dialog.getAttribute('aria-labelledby')
    return labelId && document.getElementById(labelId)?.textContent === title
  })
}

function getDialog(title: string) {
  const dialog = findDialog(title)
  expect(dialog, `Expected the ${title} dialog`).toBeDefined()
  return dialog!
}

function findButton(label: string, parent: ParentNode = document) {
  return Array.from(parent.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.trim() === label
  )
}

function getButton(label: string, parent: ParentNode = document) {
  const button = findButton(label, parent)
  expect(button, `Expected the ${label} button`).toBeDefined()
  return button!
}

async function clickButton(label: string, parent: ParentNode = document) {
  await act(async () => getButton(label, parent).click())
}

async function typeName(value = 'Search client') {
  const input = getDialog('Create new API key').querySelector<HTMLInputElement>(
    'input[placeholder="e.g., Development, Production"]'
  )!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function getAuthorizationHeader() {
  return Array.from(getDialog('Connect Search via MCP').querySelectorAll('input')).find((input) =>
    input.value.startsWith('Bearer ')
  )!.value
}

describe('Search MCP setup', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.clearAllMocks()
    mocks.createKey.mockReset()
    mocks.createKey.mockResolvedValue({ key: CREATED_KEY })
    mocks.isPending = false
    mocks.allowPersonalApiKeys = true
    mocks.policy = {
      isSuccess: true,
      isError: false,
      isFetching: false,
      error: null,
      data: { config: { disablePersonalApiKeys: false } },
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function render(workspaceId = 'workspace-1') {
    await act(async () => root.render(<SearchMcpSetup workspaceId={workspaceId} />))
  }

  async function openSetup() {
    await render()
    await clickButton('Set up')
  }

  async function openCreateKey() {
    await openSetup()
    await clickButton('Generate API key')
  }

  it('opens inline personal key generation without a settings detour or workspace choice', async () => {
    await openSetup()
    const setup = getDialog('Connect Search via MCP')
    expect(
      setup.querySelector<HTMLInputElement>(
        'input[value="https://sim.fixture.test/api/mcp/search/workspace-1"]'
      )?.readOnly
    ).toBe(true)
    expect(setup.querySelector('[aria-label="Copy MCP server URL"]')).not.toBeNull()
    expect(setup.querySelector('[aria-label="Copy authorization header value"]')).not.toBeNull()
    expect(setup.querySelector('a')).toBeNull()
    expect(setup.textContent).toContain('Streamable HTTP')
    expect(setup.textContent).toContain('personal API key to search with your document access')
    expect(getAuthorizationHeader()).toBe('Bearer YOUR_SIM_API_KEY')

    await clickButton('Generate API key', setup)
    const create = getDialog('Create new API key')
    expect(create.querySelectorAll('input:not([aria-hidden="true"])')).toHaveLength(1)
    expect(create.textContent).toContain('Name')
    expect(create.textContent).not.toContain('Key type')
    expect(findButton('Workspace', create)).toBeUndefined()
    expect(getButton('Create', create).disabled).toBe(true)

    await clickButton('Cancel', create)
    expect(findDialog('Create new API key')).toBeUndefined()
    expect(getDialog('Connect Search via MCP')).toBe(setup)
    expect(mocks.createKey).not.toHaveBeenCalled()
  })

  it('retains the shared one-time reveal and generated header, then clears the key on MCP close', async () => {
    await openCreateKey()
    await typeName('  Search client  ')
    await clickButton('Create', getDialog('Create new API key'))

    expect(mocks.createKey).toHaveBeenCalledExactlyOnceWith({
      name: 'Search client',
      keyType: 'personal',
      source: 'settings',
    })
    expect(findDialog('Create new API key')).toBeUndefined()
    const reveal = getDialog('Your API key has been created')
    expect(reveal.textContent).toContain(CREATED_KEY.key)
    expect(getAuthorizationHeader()).toBe(`Bearer ${CREATED_KEY.key}`)
    expect(findButton('Generate API key')).toBeUndefined()

    await clickButton('Done', reveal)
    expect(findDialog('Your API key has been created')).toBeUndefined()
    expect(getAuthorizationHeader()).toBe(`Bearer ${CREATED_KEY.key}`)
    await clickButton('Close', getDialog('Connect Search via MCP'))
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    await clickButton('Set up')
    expect(getAuthorizationHeader()).toBe('Bearer YOUR_SIM_API_KEY')
    expect(document.body.textContent).not.toContain(CREATED_KEY.key)
    expect(getButton('Generate API key').disabled).toBe(false)
  })

  it('keeps the entered name after a failed creation and lets the user retry', async () => {
    mocks.createKey.mockRejectedValueOnce(new Error('Service unavailable'))
    await openCreateKey()
    await typeName()
    await clickButton('Create', getDialog('Create new API key'))

    const create = getDialog('Create new API key')
    expect(create.textContent).toContain(
      'Failed to create API key. Please check your connection and try again.'
    )
    expect(
      create.querySelector<HTMLInputElement>('input[placeholder="e.g., Development, Production"]')
        ?.value
    ).toBe('Search client')
    expect(getAuthorizationHeader()).toBe('Bearer YOUR_SIM_API_KEY')
    expect(findDialog('Your API key has been created')).toBeUndefined()
    expect(getButton('Create', create).disabled).toBe(false)

    await clickButton('Create', create)
    expect(mocks.createKey).toHaveBeenCalledTimes(2)
    expect(getDialog('Your API key has been created').textContent).toContain(CREATED_KEY.key)
    expect(getAuthorizationHeader()).toBe(`Bearer ${CREATED_KEY.key}`)
  })

  it('blocks generation until the permission policy has loaded', async () => {
    mocks.policy.isSuccess = false
    mocks.policy.isFetching = true
    await openSetup()
    expect(getButton('Generate API key').disabled).toBe(true)
    await clickButton('Generate API key')
    expect(findDialog('Create new API key')).toBeUndefined()
    expect(mocks.createKey).not.toHaveBeenCalled()

    mocks.policy.isSuccess = true
    mocks.policy.isFetching = false
    await render()
    expect(getButton('Generate API key').disabled).toBe(false)
  })

  it('offers a policy retry after a failed permission check', async () => {
    mocks.policy.isSuccess = false
    mocks.policy.isError = true
    mocks.policy.error = new Error('Could not load permissions')
    await openSetup()
    expect(findButton('Generate API key')).toBeUndefined()
    expect(getDialog('Connect Search via MCP').textContent).toContain('Could not load permissions')
    await clickButton('Try again')
    expect(mocks.refetchPolicy).toHaveBeenCalledOnce()
    expect(mocks.createKey).not.toHaveBeenCalled()

    mocks.policy.isFetching = true
    await render()
    expect(getButton('Retrying…').disabled).toBe(true)
    mocks.policy.isSuccess = true
    mocks.policy.isError = false
    mocks.policy.isFetching = false
    mocks.policy.error = null
    await render()
    expect(findButton('Try again')).toBeUndefined()
    expect(getButton('Generate API key').disabled).toBe(false)
  })

  it.each(['workspace', 'permission group'] as const)(
    'blocks generation when the %s disables personal keys',
    async (policySource) => {
      if (policySource === 'workspace') mocks.allowPersonalApiKeys = false
      else mocks.policy.data.config.disablePersonalApiKeys = true
      await openSetup()
      expect(getButton('Generate API key').disabled).toBe(true)
      expect(getDialog('Connect Search via MCP').textContent).toContain(
        'Personal API keys are disabled for your account.'
      )
      await clickButton('Generate API key')
      expect(findDialog('Create new API key')).toBeUndefined()
      expect(mocks.createKey).not.toHaveBeenCalled()
    }
  )

  it('rechecks personal-key permission while the create dialog is open', async () => {
    await openCreateKey()
    await typeName()
    const create = getDialog('Create new API key')
    expect(getButton('Create', create).disabled).toBe(false)

    mocks.policy.isSuccess = false
    mocks.policy.isError = true
    mocks.policy.error = new Error('Could not load permissions')
    await render()
    expect(getButton('Create', create).disabled).toBe(true)
    await clickButton('Create', create)
    expect(mocks.createKey).not.toHaveBeenCalled()

    mocks.policy.isSuccess = true
    mocks.policy.isError = false
    mocks.policy.error = null
    await render()
    expect(getButton('Create', create).disabled).toBe(false)
    await clickButton('Create', create)
    expect(getAuthorizationHeader()).toBe(`Bearer ${CREATED_KEY.key}`)
  })

  it('blocks close, cancel, and Escape while creation is pending, then retains the returned key', async () => {
    let resolveCreation!: (response: { key: typeof CREATED_KEY }) => void
    mocks.createKey.mockImplementationOnce(
      () =>
        new Promise<{ key: typeof CREATED_KEY }>((resolve) => {
          resolveCreation = resolve
        })
    )
    await openCreateKey()
    await typeName()
    await clickButton('Create', getDialog('Create new API key'))
    mocks.isPending = true
    await render()

    const create = getDialog('Create new API key')
    expect(getButton('Creating...', create).disabled).toBe(true)
    expect(getButton('Close', create).disabled).toBe(true)
    expect(getButton('Cancel', create).disabled).toBe(true)
    await clickButton('Close', create)
    await clickButton('Cancel', create)
    await act(async () => {
      create.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(getDialog('Create new API key')).toBe(create)
    expect(getAuthorizationHeader()).toBe('Bearer YOUR_SIM_API_KEY')
    expect(mocks.createKey).toHaveBeenCalledOnce()

    await act(async () => {
      mocks.isPending = false
      resolveCreation({ key: CREATED_KEY })
    })
    expect(findDialog('Create new API key')).toBeUndefined()
    expect(getDialog('Your API key has been created').textContent).toContain(CREATED_KEY.key)
    expect(getAuthorizationHeader()).toBe(`Bearer ${CREATED_KEY.key}`)
  })
})
