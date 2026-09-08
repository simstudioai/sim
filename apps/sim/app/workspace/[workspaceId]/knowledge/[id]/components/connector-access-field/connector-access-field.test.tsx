/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  accounts: vi.fn(),
  configured: false,
  loading: false,
  retrying: false,
  error: null as Error | null,
  refetch: vi.fn(),
}))

vi.mock('@/hooks/queries/source-accounts', () => ({
  useSourceAccounts: (scope?: { kind: 'workspace' | 'organization' }) => {
    mocks.accounts(scope)
    return {
      data: {
        credentialGroup: mocks.configured
          ? {
              status: 'active',
              options: [{ provider: 'slack', status: 'active', configurationStatus: 'ready' }],
            }
          : null,
      },
      isLoading: mocks.loading,
      isPending: mocks.loading,
      isError: Boolean(mocks.error),
      isSuccess: !mocks.loading && !mocks.error,
      isFetching: mocks.loading || mocks.retrying,
      error: mocks.error,
      refetch: mocks.refetch,
    }
  },
}))

import { ConnectorAccessField } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access-field'
import { confluenceConnectorMeta } from '@/connectors/confluence/meta'
import { gitlabConnectorMeta } from '@/connectors/gitlab/meta'
import { slackConnectorMeta } from '@/connectors/slack/meta'

let root: Root
let container: HTMLDivElement
const onChange = vi.fn()

async function render(props: Partial<ComponentProps<typeof ConnectorAccessField>> = {}) {
  await act(async () => {
    root.render(
      <ConnectorAccessField
        workspaceId='workspace-1'
        connectorConfig={confluenceConnectorMeta}
        value={{ accessMode: 'members' }}
        onChange={onChange}
        canAdmin
        allowAdmin
        allowWorkspace={false}
        {...props}
      />
    )
  })
}

function radio(label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
    (node) => node.textContent === label
  )
  if (!match) throw new Error(`Missing connection method: ${label}`)
  return match
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.configured = false
  mocks.loading = false
  mocks.retrying = false
  mocks.error = null
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('connection method selection', () => {
  it('offers supported methods to admins without changing their contract values', async () => {
    await render()
    expect(container.textContent).toContain('Connection method')
    expect(radio('Member accounts')).toHaveAttribute('aria-checked', 'true')
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(2)
    await act(async () => radio('Admin or service account').click())
    expect(onChange).toHaveBeenCalledWith({ accessMode: 'admin' })
  })

  it('summarizes a single supported method without a selector', async () => {
    await render({ connectorConfig: gitlabConnectorMeta, value: { accessMode: 'admin' } })
    expect(container.querySelector('[role="radiogroup"]')).toBeNull()
    expect(container.textContent).toContain('Admin or service account')
    expect(container.textContent).toContain(
      'Each person sees only documents they can open in GitLab.'
    )
  })

  it('explains the Confluence identity connection even with central syncing', async () => {
    await render({ value: { accessMode: 'admin' }, allowMembers: false })
    expect(container.querySelector('[role="radiogroup"]')).toBeNull()
    expect(container.textContent).toContain(
      'Teammates still connect their Confluence accounts to confirm their identity.'
    )
    expect(container.textContent).toContain(
      'Each person sees only documents they can open in Confluence.'
    )
  })

  it('shows ordinary members a summary without editable or disabled choices', async () => {
    await render({ canAdmin: false, footer: <button type='button'>Apply changes</button> })
    expect(container.querySelector('[role="radiogroup"]')).toBeNull()
    expect(container.textContent).toContain('Member accounts')
    expect(container.textContent).toContain('Each teammate connects their Confluence account.')
    expect(container.querySelector('button')).toBeNull()
    expect(mocks.accounts).toHaveBeenLastCalledWith(undefined)
  })

  it('keeps the workspace method for general knowledge bases', async () => {
    await render({ value: { accessMode: 'workspace' }, allowWorkspace: true })
    expect(radio('Workspace')).toHaveAttribute('aria-checked', 'true')
    expect(container.textContent).toContain(
      'Everyone in this workspace can search these documents.'
    )
    await act(async () => radio('Member accounts').click())
    expect(onChange).toHaveBeenCalledWith({ accessMode: 'members' })
  })

  it.each([
    { current: 'members', target: 'workspace', label: 'Member accounts', targetLabel: 'Workspace' },
    {
      current: 'admin',
      target: 'members',
      label: 'Admin or service account',
      targetLabel: 'Member accounts',
    },
    { current: 'workspace', target: 'members', label: 'Workspace', targetLabel: 'Member accounts' },
  ] as const)(
    'keeps recovery from unavailable $current to $target',
    async ({ current, target, label, targetLabel }) => {
      await render({
        value: { accessMode: current },
        allowWorkspace: target === 'workspace',
        allowMembers: target === 'members',
        allowAdmin: false,
      })
      expect(radio(label)).toHaveAttribute('aria-checked', 'true')
      expect(radio(label)).toBeDisabled()
      await act(async () => radio(label).click())
      expect(onChange).not.toHaveBeenCalled()
      expect(radio(targetLabel)).toBeEnabled()
      await act(async () => radio(targetLabel).click())
      expect(onChange).toHaveBeenCalledWith({ accessMode: target })
    }
  )

  it('keeps available choices disabled during an in-flight change', async () => {
    await render({ disabled: true })
    expect(radio('Member accounts')).toBeDisabled()
    expect(radio('Admin or service account')).toBeDisabled()
    await act(async () => radio('Admin or service account').click())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps the current method readable if no replacement is allowed', async () => {
    await render({ value: { accessMode: 'admin' }, allowMembers: false, allowAdmin: false })
    expect(container.querySelector('[role="radiogroup"]')).toBeNull()
    expect(container.textContent).toContain('Admin or service account')
  })
})

describe('Slack setup continuity', () => {
  it('keeps the setup link and draft callback when the method selector is hidden', async () => {
    const onNavigate = vi.fn()
    await render({
      connectorConfig: slackConnectorMeta,
      allowAdmin: false,
      searchSetupSource: 'slack',
      onSetupNavigate: onNavigate,
      footer: <button type='button'>Apply changes</button>,
    })
    expect(container.querySelector('[role="radiogroup"]')).toBeNull()
    const link = container.querySelector('a')
    const target = new URL(link?.getAttribute('href') ?? '', 'http://localhost')
    expect(target.pathname).toBe('/workspace/workspace-1/settings/credential-groups')
    expect(target.searchParams.get('search-setup')).toBe('slack')
    expect(target.searchParams.get('credential-group-provider')).toBe('slack')
    link?.addEventListener('click', (event) => event.preventDefault())
    await act(async () => link?.click())
    expect(onNavigate).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('Apply changes')
    expect(mocks.accounts).toHaveBeenLastCalledWith({
      kind: 'workspace',
      workspaceId: 'workspace-1',
    })
  })

  it.each(['loading', 'configured'] as const)('hides the Slack detour while %s', async (state) => {
    mocks.loading = state === 'loading'
    mocks.configured = state === 'configured'
    await render({ connectorConfig: slackConnectorMeta, allowAdmin: false })
    expect(container.querySelector('a')).toBeNull()
    if (state === 'loading') expect(container.textContent).toContain('Checking Slack setup…')
  })

  it('retries a failed check without treating it as missing Slack configuration', async () => {
    mocks.error = new Error('Could not load workspace accounts')
    await render({ connectorConfig: slackConnectorMeta, allowAdmin: false })
    expect(container.textContent).toContain('Could not load workspace accounts')
    expect(container.querySelector('a')).toBeNull()
    const retry = container.querySelector('button')
    expect(retry?.textContent).toBe('Try again')
    await act(async () => retry?.click())
    expect(mocks.refetch).toHaveBeenCalledOnce()

    mocks.error = null
    await render({ connectorConfig: slackConnectorMeta, allowAdmin: false })
    expect(container.querySelector('a')).not.toBeNull()
  })

  it('locks the retry action while the failed check is being retried', async () => {
    mocks.error = new Error('Could not load workspace accounts')
    mocks.retrying = true
    await render({ connectorConfig: slackConnectorMeta, allowAdmin: false })
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('button')).toBeDisabled()
    expect(container.querySelector('button')?.textContent).toBe('Retrying…')
  })

  it('does not fetch or show Slack setup controls to ordinary members', async () => {
    mocks.error = new Error('Could not load workspace accounts')
    await render({ connectorConfig: slackConnectorMeta, allowAdmin: false, canAdmin: false })
    expect(mocks.accounts).toHaveBeenLastCalledWith(undefined)
    expect(container.querySelector('a, button')).toBeNull()
    expect(container.textContent).not.toContain('Could not load workspace accounts')
  })
})
