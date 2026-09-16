/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitHubSearchSetupStatus } from '@/lib/api/contracts/knowledge/github-setup'

const mocks = vi.hoisted(() => ({
  status: { status: 'pending' } as GitHubSearchSetupStatus,
  select: vi.fn(),
  complete: vi.fn(),
  pending: false,
}))
vi.mock('@/hooks/queries/github-search-setup', () => ({
  useGitHubSearchSetup: () => ({ data: mocks.status, error: null }),
  useSelectGitHubSearchSetup: () => ({ mutateAsync: mocks.select, isPending: mocks.pending }),
  isGitHubSetupTerminalError: () => false,
}))
vi.mock('@/app/(auth)/components', () => ({
  AuthHeader: ({ title, description }: { title: string; description?: string }) => (
    <>
      <h1>{title}</h1>
      <p>{description}</p>
    </>
  ),
}))
vi.mock('@/app/credential-groups/complete/completion-handoff', () => ({
  CredentialGroupCompletionHandoff: (props: { completionId: string }) => {
    mocks.complete(props)
    return null
  },
}))

import { GitHubSetup } from '@/app/knowledge/github/setup/setup'

const scope = { organizationId: 'org-1', setupId: 'c5b10b45-ffde-42a9-b6ae-39355a2abfe2' }
describe('GitHub account choice', () => {
  let root: Root
  let container: HTMLDivElement
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pending = false
    mocks.status = {
      status: 'choosing',
      installations: [
        { installationId: '1', accountId: '11', accountLogin: 'acme', accountType: 'Organization' },
        {
          installationId: '2',
          accountId: '22',
          accountLogin: 'research',
          accountType: 'Organization',
        },
      ],
    }
    mocks.select.mockRejectedValue(new Error('GitHub is temporarily unavailable. Try again.'))
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(<GitHubSetup scope={scope} />))
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('connects the selected account directly and retains choices on provider failure', async () => {
    const combobox = container.querySelector<HTMLButtonElement>('[role="combobox"]')!
    await act(async () => combobox.click())
    const account = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (option) => option.textContent?.includes('research')
    )!
    expect(account).toBeDefined()
    await act(async () => account.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(mocks.select).toHaveBeenCalledWith({
      ...scope,
      action: { kind: 'select', installationId: '2' },
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'temporarily unavailable'
    )
    expect(container.textContent).not.toContain('Use installation')
    expect(container.textContent).not.toContain('Refresh')
    expect(combobox).toBeEnabled()
  })

  it('offers installing into another organization without selecting an existing account', async () => {
    const button = Array.from(container.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('Connect another organization')
    )!
    await act(async () => button.click())
    expect(mocks.select).toHaveBeenCalledWith({ ...scope, action: { kind: 'install' } })
  })

  it('shows progress and disables choices while connecting', () => {
    mocks.pending = true
    act(() => root.render(<GitHubSetup scope={scope} />))
    expect(container.querySelector('[role="combobox"]')).toHaveAttribute('aria-disabled', 'true')
    expect(container.textContent).toContain('Connecting GitHub…')
  })

  it('only closes the handoff after an authoritative completion', () => {
    expect(mocks.complete).not.toHaveBeenCalled()
    mocks.status = { status: 'completed', credential: { id: 'connection-1', displayName: 'Acme' } }
    act(() => root.render(<GitHubSetup scope={scope} />))
    expect(mocks.complete).toHaveBeenCalledWith({ completionId: scope.setupId })
    expect(container.textContent).toContain('GitHub connected')
  })

  it('removes account choices after the attempt expires', () => {
    mocks.status = { status: 'expired' }
    act(() => root.render(<GitHubSetup scope={scope} />))
    expect(container.querySelector('[role="combobox"]')).toBeNull()
    expect(container.textContent).toContain('expired')
    expect(mocks.complete).not.toHaveBeenCalled()
  })
})
