/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://sim.test/workspace/workspace-1/chat/chat-1" }
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRefetchPersonalEnvironment,
  mockRefetchWorkspaceCredentials,
  mockIsBrowserAgentAvailable,
  mockSavePersonalEnvironment,
  mockSendBrowserPanelAction,
  mockUpsertWorkspaceEnvironment,
  mockUseUserPermissionsContext,
  mockUpdateWorkspaceCredential,
  mockUseWorkspaceCredential,
  mockUseWorkspaceCredentials,
} = vi.hoisted(() => ({
  mockUpdateWorkspaceCredential: vi.fn(async () => undefined),
  mockRefetchPersonalEnvironment: vi.fn(async () => ({ data: {} })),
  mockRefetchWorkspaceCredentials: vi.fn(async () => ({ data: [] })),
  mockIsBrowserAgentAvailable: vi.fn(() => false),
  mockSavePersonalEnvironment: vi.fn(async () => undefined),
  mockSendBrowserPanelAction: vi.fn(),
  mockUpsertWorkspaceEnvironment: vi.fn(async () => undefined),
  mockUseUserPermissionsContext: vi.fn(),
  mockUseWorkspaceCredential: vi.fn(),
  mockUseWorkspaceCredentials: vi.fn(),
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: mockUseUserPermissionsContext,
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))

vi.mock('@/hooks/queries/credentials', () => ({
  useUpdateWorkspaceCredential: () => ({ mutateAsync: mockUpdateWorkspaceCredential }),
  useWorkspaceCredential: mockUseWorkspaceCredential,
  useWorkspaceCredentials: mockUseWorkspaceCredentials,
}))

vi.mock('@/hooks/queries/environment', () => ({
  usePersonalEnvironment: () => ({
    data: {},
    refetch: mockRefetchPersonalEnvironment,
  }),
  useSavePersonalEnvironment: () => ({
    isPending: false,
    mutateAsync: mockSavePersonalEnvironment,
  }),
  useUpsertWorkspaceEnvironment: () => ({
    isPending: false,
    mutateAsync: mockUpsertWorkspaceEnvironment,
  }),
}))

vi.mock('@/lib/browser-agent/transport', () => ({
  isBrowserAgentAvailable: mockIsBrowserAgentAvailable,
  sendBrowserPanelAction: mockSendBrowserPanelAction,
}))

import { toast } from '@sim/emcn'
import {
  createOAuthChatAttempt,
  setOAuthChatAttemptStatus,
} from '@/lib/credentials/oauth-chat-attempt'
import type { CredentialItemData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags'
import {
  parseSpecialTags,
  SpecialTags,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags'

/**
 * Minimal dependency-free render harness (the repo has no `@testing-library/react`). Mounts the
 * component in a real React 19 root under jsdom, matching the pattern in `use-autosave.test.tsx`.
 */
function renderCredentialLink(data: CredentialItemData | CredentialItemData[]): {
  container: HTMLDivElement
  root: Root
} {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  act(() => {
    root.render(
      <SpecialTags segment={{ type: 'credential', data: Array.isArray(data) ? data : [data] }} />
    )
  })
  return { container, root }
}

describe('CredentialDisplay link tag', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    window.localStorage.clear()
    window.history.replaceState({}, '', '/workspace/workspace-1/chat/chat-1')
    mockUseUserPermissionsContext.mockReturnValue({ canEdit: true })
    mockUseWorkspaceCredential.mockReturnValue({ data: null })
    mockUseWorkspaceCredentials.mockReturnValue({
      data: [],
      isFetched: true,
      refetch: mockRefetchWorkspaceCredentials,
    })
    mockIsBrowserAgentAvailable.mockReturnValue(false)
  })

  it('renders browser takeover through the shared question UI', () => {
    mockIsBrowserAgentAvailable.mockReturnValue(true)
    const { container, root } = renderCredentialLink({
      type: 'browser_takeover',
      name: 'Please pick a match in the draw and click into it.',
    })

    expect(container.textContent).toContain('Please pick a match in the draw and click into it.')
    expect(container.textContent).toContain('Continue')
    expect(container.querySelector('input')?.placeholder).toBe('Something else')
    expect(container.querySelector('[aria-label="Dismiss"]')).toBeNull()

    const continueButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Continue'
    )
    act(() => continueButton?.click())

    expect(mockSendBrowserPanelAction).toHaveBeenCalledWith(
      'takeover-done',
      {},
      'pending:workspace-1'
    )
    act(() => root.unmount())
  })

  it('returns a custom takeover instruction to the browser agent', () => {
    mockIsBrowserAgentAvailable.mockReturnValue(true)
    const { container, root } = renderCredentialLink({
      type: 'browser_takeover',
      name: 'Please pick a match in the draw.',
    })
    const input = container.querySelector('input')
    const submit = container.querySelector<HTMLButtonElement>('button[aria-label="Submit answer"]')

    act(() => {
      if (!input) return
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'Open the second match')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => submit?.click())

    expect(mockSendBrowserPanelAction).toHaveBeenCalledWith(
      'takeover-done',
      { takeoverResponse: 'Open the second match' },
      'pending:workspace-1'
    )
    act(() => root.unmount())
  })

  it('does not render an anchor for a javascript: scheme value', () => {
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'github',
      value: 'javascript:alert(1)',
    })

    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toBe('')
    act(() => root.unmount())
  })

  it('does not render an anchor for a data: scheme value', () => {
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'github',
      value: 'data:text/html,<script>alert(1)</script>',
    })

    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toBe('')
    act(() => root.unmount())
  })

  it('renders a working link for a real http(s) connect URL', () => {
    const url = 'https://sim.test/api/auth/oauth2/authorize?providerId=google-drive'
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'google-drive',
      value: url,
    })

    const link = container.querySelector('a')
    expect(link).not.toBeNull()
    expect(link?.getAttribute('href')).toBe(url)
    expect(container.textContent).toContain('Connect Google Drive')
    expect(container.textContent).toContain('Connect integrations')
    act(() => root.unmount())
  })

  it('continues the chat with provider names after integration setup', async () => {
    const container = document.createElement('div')
    const root: Root = createRoot(container)
    const onOptionSelect = vi.fn()
    const data: CredentialItemData[] = [
      {
        type: 'link',
        provider: 'google-email',
        value: 'https://sim.test/api/auth/oauth2/authorize?providerId=google-email',
      },
    ]
    const attempt = createOAuthChatAttempt({
      workspaceId: 'workspace-1',
      providerId: 'google-email',
      baseProviderId: 'google',
      displayName: 'Gmail',
      controlId: 'credential-card:0',
      baselineCredentialIds: [],
    })
    window.history.replaceState({}, '', `?oauthAttempt=${attempt.id}`)

    act(() => {
      root.render(
        <SpecialTags segment={{ type: 'credential', data }} onOptionSelect={onOptionSelect} />
      )
    })

    const submitButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Submit'
    )
    expect(submitButton?.disabled).toBe(false)
    act(() => {
      setOAuthChatAttemptStatus(attempt.id, 'connected')
    })
    await act(async () => {
      submitButton?.click()
    })

    expect(onOptionSelect).toHaveBeenCalledWith(
      'Credential setup submitted — {"integrations":[{"name":"google-email","status":"connected"}],"secrets":[]}'
    )
    expect(container.textContent).toContain('Gmail')
    expect(container.textContent).toContain('Connected')
    act(() => root.unmount())
  })

  it('shows not connected after an unfinished OAuth tab returns focus', async () => {
    const attempt = createOAuthChatAttempt({
      workspaceId: 'workspace-1',
      providerId: 'google-email',
      baseProviderId: 'google',
      displayName: 'Gmail',
      controlId: 'credential-card:0',
      baselineCredentialIds: [],
    })
    window.history.replaceState({}, '', `?oauthAttempt=${attempt.id}`)
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'google-email',
      value: 'https://sim.test/api/auth/oauth2/authorize?providerId=google-email',
    })

    expect(container.textContent).toContain('Waiting for Gmail connection')

    await act(async () => {
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('focus'))
    })

    expect(container.textContent).toContain('Not connected — connect Gmail')
    act(() => root.unmount())
  })

  it('keeps a new-account link actionable when Gmail already has a credential', () => {
    mockUseWorkspaceCredentials.mockReturnValue({
      data: [{ id: 'existing-gmail', providerId: 'google' }],
      isFetched: true,
      refetch: mockRefetchWorkspaceCredentials,
    })
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'google-email',
      value: 'https://sim.test/api/auth/oauth2/authorize?providerId=google-email',
    })

    expect(container.textContent).toContain('Connect another Gmail')
    expect(container.textContent).not.toContain('Connected Gmail')
    expect(container.querySelector('a')?.getAttribute('aria-disabled')).toBe('false')
    act(() => root.unmount())
  })

  it('marks the row connected when a new matching credential appears elsewhere', async () => {
    const existingCredential = {
      id: 'existing-gmail',
      providerId: 'google',
      updatedAt: '2026-08-07T10:00:00Z',
    }
    let credentials = [existingCredential]
    mockUseWorkspaceCredentials.mockImplementation(() => ({
      data: credentials,
      isFetched: true,
      refetch: mockRefetchWorkspaceCredentials,
    }))
    const data: CredentialItemData = {
      type: 'link',
      provider: 'google-email',
      value: 'https://sim.test/api/auth/oauth2/authorize?providerId=google-email',
    }
    const { container, root } = renderCredentialLink(data)

    expect(container.textContent).toContain('Connect another Gmail')
    credentials = [
      existingCredential,
      { id: 'new-gmail', providerId: 'google', updatedAt: '2026-08-07T10:05:00Z' },
    ]
    await act(async () => {
      root.render(<SpecialTags segment={{ type: 'credential', data: [data] }} />)
    })

    expect(container.textContent).toContain('Connected Gmail')
    // A workspace-wide change cannot be attributed to one row, so it shows the
    // row as satisfied without disabling it — see the sibling-row case below.
    expect(container.querySelector('a')?.getAttribute('aria-disabled')).toBe('false')
    act(() => root.unmount())
  })

  it('refetches after returning from another tab and detects a new matching credential', async () => {
    const existingCredential = {
      id: 'existing-gmail',
      providerId: 'google',
      updatedAt: '2026-08-07T10:00:00Z',
    }
    mockUseWorkspaceCredentials.mockReturnValue({
      data: [existingCredential],
      isFetched: true,
      refetch: mockRefetchWorkspaceCredentials,
    })
    mockRefetchWorkspaceCredentials.mockResolvedValueOnce({
      data: [
        existingCredential,
        { id: 'new-gmail', providerId: 'google', updatedAt: '2026-08-07T10:05:00Z' },
      ],
    })
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'google-email',
      value: 'https://sim.test/api/auth/oauth2/authorize?providerId=google-email',
    })

    await act(async () => {
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('focus'))
    })

    expect(mockRefetchWorkspaceCredentials).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('Connected Gmail')
    act(() => root.unmount())
  })

  it('does not treat an unrelated update to a reconnect target as OAuth completion', async () => {
    let credentials = [{ id: 'cred-1', providerId: 'google', updatedAt: '2026-08-07T10:00:00Z' }]
    mockUseWorkspaceCredentials.mockImplementation(() => ({
      data: credentials,
      isFetched: true,
      refetch: mockRefetchWorkspaceCredentials,
    }))
    const data: CredentialItemData = {
      type: 'link',
      provider: 'google-email',
      value:
        'https://sim.test/api/auth/oauth2/authorize?providerId=google-email&credentialId=cred-1',
    }
    const { container, root } = renderCredentialLink(data)

    credentials = [{ ...credentials[0], updatedAt: '2026-08-07T10:05:00Z' }]
    await act(async () => {
      root.render(<SpecialTags segment={{ type: 'credential', data: [data] }} />)
    })

    expect(container.textContent).toContain('Reconnect Gmail')
    expect(container.textContent).not.toContain('Connected Gmail')
    act(() => root.unmount())
  })

  it('runs the connect in a popup so the chat tab never navigates', () => {
    const popup = { focus: vi.fn() }
    const openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as ReturnType<typeof window.open>)
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'google-email',
      value:
        'https://sim.test/api/auth/oauth2/authorize?providerId=google-email&callbackURL=https%3A%2F%2Fsim.test%2Fworkspace%2Fworkspace-1%2Fchat%2Fchat-1',
    })

    const link = container.querySelector('a')
    const defaultPrevented = !link?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    )

    expect(defaultPrevented).toBe(true)
    expect(popup.focus).toHaveBeenCalledOnce()
    const openedUrl = new URL(openSpy.mock.calls[0][0] as string)
    const callbackUrl = new URL(openedUrl.searchParams.get('callbackURL') ?? '')
    expect(callbackUrl.pathname).toBe('/oauth/chat-complete')
    // Named per attempt: a shared name would let a sibling row renavigate this
    // popup and strand this attempt with no return leg.
    const attemptId = callbackUrl.searchParams.get('oauthAttempt')
    expect(openSpy.mock.calls[0][1]).toBe(`sim-oauth-connect-${attemptId}`)
    openSpy.mockRestore()
    act(() => root.unmount())
  })

  it('keeps a cross-origin connect URL on the anchor instead of a popup', () => {
    const openSpy = vi.spyOn(window, 'open')
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'google-email',
      value:
        'https://evil.example/api/auth/oauth2/authorize?providerId=google-email&callbackURL=https%3A%2F%2Fevil.example%2Fsink',
    })

    const link = container.querySelector('a')
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    // The anchor carries rel='noopener noreferrer'; window.open would not.
    expect(openSpy).not.toHaveBeenCalled()
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
    openSpy.mockRestore()
    act(() => root.unmount())
  })

  it('announces the connection once the popup publishes its verdict', async () => {
    const toastSuccess = vi.spyOn(toast, 'success').mockImplementation(() => '')
    const popup = { focus: vi.fn(), closed: false }
    const openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as ReturnType<typeof window.open>)
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'google-email',
      value:
        'https://sim.test/api/auth/oauth2/authorize?providerId=google-email&callbackURL=https%3A%2F%2Fsim.test%2Fworkspace%2Fworkspace-1%2Fchat%2Fchat-1',
    })

    await act(async () => {
      container
        .querySelector('a')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    const attemptId = new URL(
      new URL(openSpy.mock.calls[0][0] as string).searchParams.get('callbackURL') ?? ''
    ).searchParams.get('oauthAttempt') as string

    expect(toastSuccess).not.toHaveBeenCalled()
    await act(async () => {
      setOAuthChatAttemptStatus(attemptId, 'connected')
    })

    expect(toastSuccess).toHaveBeenCalledWith('Gmail connected successfully.')
    openSpy.mockRestore()
    toastSuccess.mockRestore()
    act(() => root.unmount())
  })

  it('settles the row when the popup dies on a page that publishes no verdict', async () => {
    // A denied consent lands on /oauth-error, which never writes a verdict and
    // never self-closes. The row must not defer to it forever.
    const popup = {
      focus: vi.fn(),
      closed: false,
      location: { origin: 'https://sim.test', pathname: '/oauth-error' },
    }
    const openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as ReturnType<typeof window.open>)
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'google-email',
      value:
        'https://sim.test/api/auth/oauth2/authorize?providerId=google-email&callbackURL=https%3A%2F%2Fsim.test%2Fworkspace%2Fworkspace-1%2Fchat%2Fchat-1',
    })

    await act(async () => {
      container
        .querySelector('a')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await act(async () => {
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('focus'))
    })

    expect(container.textContent).toContain('Not connected — connect Gmail')
    openSpy.mockRestore()
    act(() => root.unmount())
  })

  it('keeps the row retryable when the verdict lands but no credential appears', async () => {
    // The credential-draft failure is swallowed server-side, so the flow can
    // report success with nothing in the workspace. Label follows the verdict;
    // the control must stay clickable so the user can try again.
    const toastSuccess = vi.spyOn(toast, 'success').mockImplementation(() => '')
    const popup = { focus: vi.fn(), closed: false }
    const openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as ReturnType<typeof window.open>)
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'google-email',
      value:
        'https://sim.test/api/auth/oauth2/authorize?providerId=google-email&callbackURL=https%3A%2F%2Fsim.test%2Fworkspace%2Fworkspace-1%2Fchat%2Fchat-1',
    })

    await act(async () => {
      container
        .querySelector('a')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    const attemptId = new URL(
      new URL(openSpy.mock.calls[0][0] as string).searchParams.get('callbackURL') ?? ''
    ).searchParams.get('oauthAttempt') as string
    await act(async () => {
      setOAuthChatAttemptStatus(attemptId, 'connected')
    })

    expect(container.textContent).toContain('Connected Gmail')
    expect(container.querySelector('a')?.getAttribute('aria-disabled')).toBe('false')
    openSpy.mockRestore()
    toastSuccess.mockRestore()
    act(() => root.unmount())
  })

  it('keeps waiting when the tab is refocused while the connect popup is still open', async () => {
    const popup = {
      focus: vi.fn(),
      closed: false,
      // Still on the provider's pages: reading location across origins throws.
      get location(): Location {
        throw new DOMException('cross-origin', 'SecurityError')
      },
    }
    const openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as ReturnType<typeof window.open>)
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'google-email',
      value:
        'https://sim.test/api/auth/oauth2/authorize?providerId=google-email&callbackURL=https%3A%2F%2Fsim.test%2Fworkspace%2Fworkspace-1%2Fchat%2Fchat-1',
    })

    await act(async () => {
      container
        .querySelector('a')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await act(async () => {
      window.dispatchEvent(new Event('blur'))
      window.dispatchEvent(new Event('focus'))
    })

    expect(container.textContent).toContain('Waiting for Gmail connection')
    openSpy.mockRestore()
    act(() => root.unmount())
  })

  it('settles the row from the popup watcher when the flow ends with no event in this tab', async () => {
    // A provider interstitial (Trello parks on one for ~3s) bounces to the
    // workspace root without ever reaching the completion page. Neither page
    // publishes a verdict, and a user who never leaves this tab gets no focus
    // event either — only the watcher can end the wait.
    vi.useFakeTimers()
    const popup = {
      focus: vi.fn(),
      closed: false,
      location: { origin: 'https://sim.test', pathname: '/api/auth/trello/callback' },
    }
    const openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as ReturnType<typeof window.open>)
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'google-email',
      value:
        'https://sim.test/api/auth/oauth2/authorize?providerId=google-email&callbackURL=https%3A%2F%2Fsim.test%2Fworkspace%2Fworkspace-1%2Fchat%2Fchat-1',
    })

    await act(async () => {
      container
        .querySelector('a')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    // The interstitial is not terminal, so the row is still deferring.
    expect(container.textContent).toContain('Waiting for Gmail connection')

    popup.location.pathname = '/workspace'
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(container.textContent).toContain('Not connected — connect Gmail')
    vi.useRealTimers()
    openSpy.mockRestore()
    act(() => root.unmount())
  })

  it('does not fail the row when a disowned popup handle reports closed', async () => {
    // A provider page with COOP `same-origin` disowns the window, and the
    // disowned handle reports `closed` for a consent screen that is still
    // running. The watcher must not read that as an ending: publishing 'failed'
    // here would fight a live flow, and the row would invite a rival retry.
    vi.useFakeTimers()
    const popup = { focus: vi.fn(), closed: true }
    const openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as ReturnType<typeof window.open>)
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'google-email',
      value:
        'https://sim.test/api/auth/oauth2/authorize?providerId=google-email&callbackURL=https%3A%2F%2Fsim.test%2Fworkspace%2Fworkspace-1%2Fchat%2Fchat-1',
    })

    await act(async () => {
      container
        .querySelector('a')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })

    expect(container.textContent).toContain('Waiting for Gmail connection')
    expect(container.textContent).not.toContain('Not connected')

    // Indistinguishable from a popup the user simply closed, so the wait is
    // bounded rather than indefinite: past the safety timeout the row decides
    // from the credential list instead of waiting on a verdict that never came.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    })

    expect(container.textContent).toContain('Not connected — connect Gmail')
    vi.useRealTimers()
    openSpy.mockRestore()
    act(() => root.unmount())
  })

  it('holds the deadline open while the popup is live, then settles once it is not', async () => {
    // A consent screen can outlive the safety timeout. Expiring against a live
    // window would spend the bound early and leave nothing to catch the popup
    // dying unobservably later, so the deadline waits instead of firing.
    vi.useFakeTimers()
    const popup = {
      focus: vi.fn(),
      closed: false,
      // Still on the provider's pages: reading location across origins throws.
      get location(): Location {
        throw new DOMException('cross-origin', 'SecurityError')
      },
    }
    const openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as ReturnType<typeof window.open>)
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'google-email',
      value:
        'https://sim.test/api/auth/oauth2/authorize?providerId=google-email&callbackURL=https%3A%2F%2Fsim.test%2Fworkspace%2Fworkspace-1%2Fchat%2Fchat-1',
    })

    await act(async () => {
      container
        .querySelector('a')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11 * 60 * 1000)
    })

    expect(container.textContent).toContain('Waiting for Gmail connection')

    // Dies unobservably well after the original deadline — the watcher releases
    // the handle without a verdict, so only a still-armed deadline can settle.
    popup.closed = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(container.textContent).toContain('Not connected — connect Gmail')
    vi.useRealTimers()
    openSpy.mockRestore()
    act(() => root.unmount())
  })

  it('keeps the unobservable deadline across a remount', async () => {
    // The transcript virtualizes, so a row can scroll away mid-connect and come
    // back with no window handle and no blur behind it. The deadline is derived
    // from the attempt's requestedAt rather than held in the effect, so the
    // remounted row inherits the remaining time instead of waiting forever.
    vi.useFakeTimers()
    const popup = { focus: vi.fn(), closed: false }
    const openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as ReturnType<typeof window.open>)
    const data: CredentialItemData = {
      type: 'link',
      provider: 'google-email',
      value:
        'https://sim.test/api/auth/oauth2/authorize?providerId=google-email&callbackURL=https%3A%2F%2Fsim.test%2Fworkspace%2Fworkspace-1%2Fchat%2Fchat-1',
    }
    const first = renderCredentialLink(data)

    await act(async () => {
      first.container
        .querySelector('a')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    popup.closed = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 1000)
    })
    act(() => first.root.unmount())

    const second = renderCredentialLink(data)
    expect(second.container.textContent).toContain('Waiting for Gmail connection')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    })

    expect(second.container.textContent).toContain('Not connected — connect Gmail')
    vi.useRealTimers()
    openSpy.mockRestore()
    act(() => second.root.unmount())
  })

  it('still announces the connection when the watcher released the popup first', async () => {
    // The watcher drops the window handle as soon as it stops being observable,
    // which routinely happens before React applies the storage-driven verdict.
    // The announcement has to survive that, so it cannot be gated on the handle.
    vi.useFakeTimers()
    const toastSuccess = vi.spyOn(toast, 'success').mockImplementation(() => '')
    const popup = { focus: vi.fn(), closed: false }
    const openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as ReturnType<typeof window.open>)
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'google-email',
      value:
        'https://sim.test/api/auth/oauth2/authorize?providerId=google-email&callbackURL=https%3A%2F%2Fsim.test%2Fworkspace%2Fworkspace-1%2Fchat%2Fchat-1',
    })

    await act(async () => {
      container
        .querySelector('a')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    const attemptId = new URL(
      new URL(openSpy.mock.calls[0][0] as string).searchParams.get('callbackURL') ?? ''
    ).searchParams.get('oauthAttempt') as string

    popup.closed = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    await act(async () => {
      setOAuthChatAttemptStatus(attemptId, 'connected')
    })

    expect(toastSuccess).toHaveBeenCalledWith('Gmail connected successfully.')
    vi.useRealTimers()
    openSpy.mockRestore()
    toastSuccess.mockRestore()
    act(() => root.unmount())
  })

  it('focuses the live popup instead of starting a rival attempt on a repeat click', async () => {
    const toastSuccess = vi.spyOn(toast, 'success').mockImplementation(() => '')
    const popup = {
      focus: vi.fn(),
      closed: false,
      // Still on the provider's pages: reading location across origins throws.
      get location(): Location {
        throw new DOMException('cross-origin', 'SecurityError')
      },
    }
    const openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as ReturnType<typeof window.open>)
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'google-email',
      value:
        'https://sim.test/api/auth/oauth2/authorize?providerId=google-email&callbackURL=https%3A%2F%2Fsim.test%2Fworkspace%2Fworkspace-1%2Fchat%2Fchat-1',
    })
    const link = container.querySelector('a')

    await act(async () => {
      link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    const attemptId = new URL(
      new URL(openSpy.mock.calls[0][0] as string).searchParams.get('callbackURL') ?? ''
    ).searchParams.get('oauthAttempt') as string
    await act(async () => {
      link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    // No second window, and no second attempt to strand the first one's verdict.
    expect(openSpy).toHaveBeenCalledOnce()
    expect(popup.focus).toHaveBeenCalledTimes(2)

    await act(async () => {
      setOAuthChatAttemptStatus(attemptId, 'connected')
    })

    expect(container.textContent).toContain('Connected Gmail')
    openSpy.mockRestore()
    toastSuccess.mockRestore()
    act(() => root.unmount())
  })

  it('locks the row once the popup verdict is corroborated by a refetched credential', async () => {
    const toastSuccess = vi.spyOn(toast, 'success').mockImplementation(() => '')
    const popup = { focus: vi.fn(), closed: false }
    const openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as ReturnType<typeof window.open>)
    mockRefetchWorkspaceCredentials.mockResolvedValue({
      data: [{ id: 'new-gmail', providerId: 'google', updatedAt: '2026-08-07T10:05:00Z' }],
    })
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'google-email',
      value:
        'https://sim.test/api/auth/oauth2/authorize?providerId=google-email&callbackURL=https%3A%2F%2Fsim.test%2Fworkspace%2Fworkspace-1%2Fchat%2Fchat-1',
    })

    await act(async () => {
      container
        .querySelector('a')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    const attemptId = new URL(
      new URL(openSpy.mock.calls[0][0] as string).searchParams.get('callbackURL') ?? ''
    ).searchParams.get('oauthAttempt') as string
    await act(async () => {
      setOAuthChatAttemptStatus(attemptId, 'connected')
    })

    // The popup flow never blurs this tab, so this refetch is the only one that
    // can corroborate the verdict and let the control lock.
    expect(mockRefetchWorkspaceCredentials).toHaveBeenCalled()
    expect(container.textContent).toContain('Connected Gmail')
    expect(container.querySelector('a')?.getAttribute('aria-disabled')).toBe('true')
    openSpy.mockRestore()
    toastSuccess.mockRestore()
    act(() => root.unmount())
  })

  it('navigates the tab through the same completion page when the popup is blocked', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'google-email',
      value:
        'https://sim.test/api/auth/oauth2/authorize?providerId=google-email&callbackURL=https%3A%2F%2Fsim.test%2Fworkspace%2Fworkspace-1%2Fchat%2Fchat-1',
    })

    const link = container.querySelector('a')
    const defaultPrevented = !link?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    )

    expect(defaultPrevented).toBe(false)
    const callbackUrl = new URL(
      new URL(link?.getAttribute('href') ?? '').searchParams.get('callbackURL') ?? ''
    )
    expect(callbackUrl.pathname).toBe('/oauth/chat-complete')
    expect(callbackUrl.searchParams.get('oauthAttempt')).not.toBeNull()
    openSpy.mockRestore()
    act(() => root.unmount())
  })

  it('waits for the credential baseline before opening an OAuth link', () => {
    mockUseWorkspaceCredentials.mockReturnValue({
      data: undefined,
      isFetched: false,
      refetch: mockRefetchWorkspaceCredentials,
    })
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'google-email',
      value: 'https://sim.test/api/auth/oauth2/authorize?providerId=google-email',
    })

    const link = container.querySelector('a')
    expect(container.textContent).toContain('Checking Gmail connections')
    expect(link?.getAttribute('aria-disabled')).toBe('true')
    expect(link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(
      false
    )
    act(() => root.unmount())
  })

  it('keeps a sibling row for the same provider clickable when one connects', async () => {
    const existingCredential = {
      id: 'existing-gmail',
      providerId: 'google',
      updatedAt: '2026-08-07T10:00:00Z',
    }
    let credentials = [existingCredential]
    mockUseWorkspaceCredentials.mockImplementation(() => ({
      data: credentials,
      isFetched: true,
      refetch: mockRefetchWorkspaceCredentials,
    }))
    const data: CredentialItemData[] = [
      {
        type: 'link',
        provider: 'google-email',
        value: 'https://sim.test/api/auth/oauth2/authorize?providerId=google-email',
      },
      {
        type: 'link',
        provider: 'google-email',
        value: 'https://sim.test/api/auth/oauth2/authorize?providerId=google-email',
      },
    ]
    const { container, root } = renderCredentialLink(data)

    credentials = [
      existingCredential,
      { id: 'new-gmail', providerId: 'google', updatedAt: '2026-08-07T10:05:00Z' },
    ]
    await act(async () => {
      root.render(<SpecialTags segment={{ type: 'credential', data }} />)
    })

    const rows = container.querySelectorAll('a')
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.getAttribute('aria-disabled')).toBe('false')
    }
    act(() => root.unmount())
  })

  it('applies OAuth completion only to the card that launched it', () => {
    const data: CredentialItemData[] = [
      {
        type: 'link',
        provider: 'google-email',
        value: 'https://sim.test/api/auth/oauth2/authorize?providerId=google-email',
      },
    ]
    const attempt = createOAuthChatAttempt({
      workspaceId: 'workspace-1',
      providerId: 'google-email',
      baseProviderId: 'google',
      displayName: 'Gmail',
      controlId: 'message-2:0:0',
      baselineCredentialIds: [],
    })
    window.history.replaceState({}, '', `?oauthAttempt=${attempt.id}`)
    const container = document.createElement('div')
    const root: Root = createRoot(container)

    act(() => {
      root.render(
        <>
          <SpecialTags segment={{ type: 'credential', data }} interactionId='message-1:0' />
          <SpecialTags segment={{ type: 'credential', data }} interactionId='message-2:0' />
        </>
      )
      setOAuthChatAttemptStatus(attempt.id, 'connected')
    })

    expect(container.textContent?.match(/Connected Gmail/g)).toHaveLength(1)
    expect(container.textContent?.match(/Connect Gmail/g)).toHaveLength(1)
    act(() => root.unmount())
  })

  it('renders nothing when the user cannot edit, regardless of URL safety', () => {
    mockUseUserPermissionsContext.mockReturnValue({ canEdit: false })
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'github',
      value: 'https://github.com/login/oauth/authorize',
    })

    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toBe('')
    act(() => root.unmount())
  })

  it('labels a reconnect URL with the credential display name', () => {
    mockUseWorkspaceCredential.mockReturnValue({
      data: { id: 'cred-1', displayName: "Justin's Gmail" },
    })
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'google-email',
      value:
        'https://sim.test/api/auth/oauth2/authorize?providerId=google-email&workspaceId=ws-1&credentialId=cred-1',
    })

    expect(mockUseWorkspaceCredential).toHaveBeenCalledWith('cred-1')
    expect(container.textContent).toContain("Reconnect Justin's Gmail")
    act(() => root.unmount())
  })

  it('falls back to the integration name while the reconnect credential is unresolved', () => {
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'google-email',
      value:
        'https://sim.test/api/auth/oauth2/authorize?providerId=google-email&workspaceId=ws-1&credentialId=cred-1',
    })

    expect(container.textContent).toContain('Reconnect Gmail')
    act(() => root.unmount())
  })

  it('renders integrations and secrets in one card and saves secrets on Submit', async () => {
    const container = document.createElement('div')
    const root: Root = createRoot(container)
    const onOptionSelect = vi.fn()
    const data: CredentialItemData[] = [
      {
        type: 'secret_input',
        name: 'OPENAI_API_KEY',
      },
      {
        type: 'link',
        provider: 'google-email',
        value: 'https://sim.test/api/auth/oauth2/authorize?providerId=google-email',
      },
    ]
    const attempt = createOAuthChatAttempt({
      workspaceId: 'workspace-1',
      providerId: 'google-email',
      baseProviderId: 'google',
      displayName: 'Gmail',
      controlId: 'credential-card:0',
      baselineCredentialIds: [],
    })
    window.history.replaceState({}, '', `?oauthAttempt=${attempt.id}`)

    act(() => {
      root.render(
        <SpecialTags segment={{ type: 'credential', data }} onOptionSelect={onOptionSelect} />
      )
    })

    expect(container.textContent).toContain('Set up credentials')
    expect(container.textContent).not.toContain('1 of 2')
    expect(container.querySelectorAll('a')).toHaveLength(1)
    const secretInput = container.querySelector('input')
    expect(secretInput?.getAttribute('placeholder')).toBe('Paste OPENAI_API_KEY')
    expect(secretInput?.className).toContain('border-0 bg-transparent p-0')
    expect(secretInput?.parentElement?.className).toContain('px-2 py-2')
    expect(secretInput?.parentElement?.className).not.toContain('rounded')
    expect(container.querySelector('svg rect')).toBeNull()
    expect(container.querySelector('button[aria-label="Save"]')).toBeNull()

    act(() => secretInput?.focus())
    act(() => {
      if (!secretInput) return
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      valueSetter?.call(secretInput, 'sk-test-key')
      secretInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const submitButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Submit'
    )
    expect(submitButton?.disabled).toBe(false)
    expect(submitButton?.querySelector('div')).toBeNull()
    await act(async () => {
      submitButton?.click()
    })

    expect(mockUpsertWorkspaceEnvironment).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      variables: { OPENAI_API_KEY: 'sk-test-key' },
    })
    expect(onOptionSelect).toHaveBeenCalledWith(
      'Credential setup submitted — {"integrations":[{"name":"google-email","status":"skipped"}],"secrets":[{"name":"OPENAI_API_KEY","status":"saved"}]}'
    )
    expect(container.textContent).toContain('Gmail')
    expect(container.textContent).toContain('Skipped')
    expect(container.textContent).toContain('OPENAI_API_KEY')
    expect(container.textContent).toContain('Added')
    act(() => root.unmount())
  })

  it('keeps canonical secret indexes when permission filtering hides a workspace row', async () => {
    mockUseUserPermissionsContext.mockReturnValue({ canEdit: false })
    const container = document.createElement('div')
    const root = createRoot(container)
    const onOptionSelect = vi.fn()
    const data: CredentialItemData[] = [
      { type: 'secret_input', name: 'WORKSPACE_KEY', scope: 'workspace' },
      { type: 'secret_input', name: 'PERSONAL_KEY', scope: 'personal' },
    ]

    act(() => {
      root.render(
        <SpecialTags segment={{ type: 'credential', data }} onOptionSelect={onOptionSelect} />
      )
    })

    const input = container.querySelector('input')
    expect(input?.getAttribute('placeholder')).toBe('Paste PERSONAL_KEY')
    act(() => {
      if (!input) return
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      valueSetter?.call(input, 'personal-secret')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const submitButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Submit'
    )
    await act(async () => submitButton?.click())

    expect(mockSavePersonalEnvironment).toHaveBeenCalledWith({
      variables: { PERSONAL_KEY: 'personal-secret' },
    })
    expect(onOptionSelect).toHaveBeenCalledWith(
      'Credential setup submitted — {"integrations":[],"secrets":[{"name":"WORKSPACE_KEY","status":"skipped"},{"name":"PERSONAL_KEY","status":"saved"}]}'
    )
    act(() => root.unmount())
  })

  it('attaches an agent-authored description after the secret value is saved', async () => {
    mockUseUserPermissionsContext.mockReturnValue({ canEdit: true })
    mockRefetchWorkspaceCredentials.mockResolvedValueOnce({
      data: [{ id: 'cred-1', envKey: 'WORKSPACE_KEY' }],
    })
    const container = document.createElement('div')
    const root = createRoot(container)
    const data: CredentialItemData[] = [
      {
        type: 'secret_input',
        name: 'WORKSPACE_KEY',
        scope: 'workspace',
        description: '  Stripe live key for billing  ',
      },
    ]

    act(() => {
      root.render(<SpecialTags segment={{ type: 'credential', data }} onOptionSelect={vi.fn()} />)
    })

    const input = container.querySelector('input')
    act(() => {
      if (!input) return
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      valueSetter?.call(input, 'sk-live-123')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const submitButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Submit'
    )
    await act(async () => submitButton?.click())

    expect(mockUpsertWorkspaceEnvironment).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      variables: { WORKSPACE_KEY: 'sk-live-123' },
    })
    // The description rides the credential row the value save just created, so
    // the trimmed note lands without the user ever seeing the field.
    expect(mockUpdateWorkspaceCredential).toHaveBeenCalledWith({
      credentialId: 'cred-1',
      description: 'Stripe live key for billing',
    })
    act(() => root.unmount())
  })

  it('leaves a personal secret undescribed', async () => {
    mockUseUserPermissionsContext.mockReturnValue({ canEdit: true })
    const container = document.createElement('div')
    const root = createRoot(container)
    const data: CredentialItemData[] = [
      { type: 'secret_input', name: 'PERSONAL_KEY', scope: 'personal', description: 'my key' },
    ]

    act(() => {
      root.render(<SpecialTags segment={{ type: 'credential', data }} onOptionSelect={vi.fn()} />)
    })

    const input = container.querySelector('input')
    act(() => {
      if (!input) return
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      valueSetter?.call(input, 'personal-secret')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const submitButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Submit'
    )
    await act(async () => submitButton?.click())

    expect(mockSavePersonalEnvironment).toHaveBeenCalled()
    expect(mockUpdateWorkspaceCredential).not.toHaveBeenCalled()
    act(() => root.unmount())
  })

  it('renders one status recap from a transcript submission', () => {
    const container = document.createElement('div')
    const root: Root = createRoot(container)
    const data: CredentialItemData[] = [
      {
        type: 'link',
        provider: 'google-email',
        value: 'https://sim.test/api/auth/oauth2/authorize?providerId=google-email',
      },
      { type: 'secret_input', name: 'OPENAI_API_KEY' },
    ]

    act(() => {
      root.render(
        <SpecialTags
          segment={{ type: 'credential', data }}
          credentialSubmission={{
            integrations: [{ name: 'google-email', status: 'connected' }],
            secrets: [{ name: 'OPENAI_API_KEY', status: 'skipped' }],
          }}
        />
      )
    })

    expect(container.textContent).not.toContain('Credential setup')
    expect(container.textContent).not.toContain('Set up credentials')
    expect(container.textContent).toContain('GmailConnected')
    expect(container.textContent).toContain('OPENAI_API_KEYSkipped')
    expect(container.querySelector('input')).toBeNull()
    act(() => root.unmount())
  })

  it('recaps an abandoned card as skipped instead of leaving a live form', () => {
    const container = document.createElement('div')
    const root: Root = createRoot(container)
    const data: CredentialItemData[] = [
      { type: 'secret_input', name: 'ABC_API_KEY' },
      { type: 'secret_input', name: 'BED_API_KEY' },
    ]

    act(() => {
      root.render(<SpecialTags segment={{ type: 'credential', data }} credentialAbandoned />)
    })

    expect(container.textContent).not.toContain('Add secrets')
    expect(container.textContent).toContain('ABC_API_KEYSkipped')
    expect(container.textContent).toContain('BED_API_KEYSkipped')
    expect(container.querySelector('input')).toBeNull()
    act(() => root.unmount())
  })

  it('restores a finished connect into an abandoned recap on a fresh mount', () => {
    const attempt = createOAuthChatAttempt({
      workspaceId: 'workspace-1',
      providerId: 'google-email',
      baseProviderId: 'google',
      displayName: 'Gmail',
      controlId: 'credential-card:0',
      baselineCredentialIds: [],
    })
    setOAuthChatAttemptStatus(attempt.id, 'connected')
    const container = document.createElement('div')
    const root: Root = createRoot(container)
    const data: CredentialItemData[] = [
      {
        type: 'link',
        provider: 'google-email',
        value: 'https://sim.test/api/auth/oauth2/authorize?providerId=google-email',
      },
      { type: 'secret_input', name: 'ABC_API_KEY' },
    ]

    act(() => {
      root.render(<SpecialTags segment={{ type: 'credential', data }} credentialAbandoned />)
    })

    expect(container.textContent).toContain('GmailConnected')
    expect(container.textContent).toContain('ABC_API_KEYSkipped')
    act(() => root.unmount())
  })

  it('renders a sim_key as a standalone reveal, not a card, even when the turn moves on', () => {
    const container = document.createElement('div')
    const root: Root = createRoot(container)
    const data: CredentialItemData[] = [{ type: 'sim_key', name: 'Sim API key', value: 'sim-key' }]

    act(() => {
      root.render(<SpecialTags segment={{ type: 'credential', data }} credentialAbandoned />)
    })

    // The generated key is an output: the reveal chip shows the value with no
    // question-style card chrome around it and no recap when abandoned.
    expect(container.textContent).toContain('sim-key')
    expect(container.textContent).not.toContain('API key')
    expect(container.textContent).not.toContain('Skipped')
    act(() => root.unmount())
  })

  it('keeps the sim_key reveal outside a mixed card and out of its recap', () => {
    const container = document.createElement('div')
    const root: Root = createRoot(container)
    const data: CredentialItemData[] = [
      { type: 'sim_key', name: 'Sim API key', value: 'sim-key' },
      { type: 'secret_input', name: 'ABC_API_KEY' },
    ]

    act(() => {
      root.render(
        <SpecialTags
          segment={{ type: 'credential', data }}
          credentialSubmission={{
            integrations: [],
            secrets: [{ name: 'ABC_API_KEY', status: 'saved' }],
          }}
        />
      )
    })

    // After Submit the input row collapses to the recap, but the generated key
    // stays retrievable in its reveal chip and never reads as "Added".
    expect(container.textContent).toContain('sim-key')
    expect(container.textContent).toContain('ABC_API_KEYAdded')
    expect(container.textContent).not.toContain('Sim API key')
    act(() => root.unmount())
  })

  it('keeps a typed secret while a sibling row runs its OAuth connect', async () => {
    // The card's secret drafts live in component state until its Submit, so a
    // connect that navigates this tab away discards whatever the user already
    // typed into a sibling row. Running the flow in a popup is what makes the
    // mixed card safe: this tab is never unloaded, so the draft outlives the
    // connect — including the re-render its verdict and refetch trigger.
    const toastSuccess = vi.spyOn(toast, 'success').mockImplementation(() => '')
    const popup = { focus: vi.fn(), closed: false }
    const openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as ReturnType<typeof window.open>)
    const container = document.createElement('div')
    const root: Root = createRoot(container)
    const onOptionSelect = vi.fn()
    const data: CredentialItemData[] = [
      {
        type: 'link',
        provider: 'google-email',
        value:
          'https://sim.test/api/auth/oauth2/authorize?providerId=google-email&callbackURL=https%3A%2F%2Fsim.test%2Fworkspace%2Fworkspace-1%2Fchat%2Fchat-1',
      },
      { type: 'secret_input', name: 'OPENAI_API_KEY' },
    ]
    act(() => {
      root.render(
        <SpecialTags segment={{ type: 'credential', data }} onOptionSelect={onOptionSelect} />
      )
    })

    const secretInput = container.querySelector('input')
    act(() => {
      if (!secretInput) return
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      valueSetter?.call(secretInput, 'sk-test-key')
      secretInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await act(async () => {
      container
        .querySelector('a')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    const attemptId = new URL(
      new URL(openSpy.mock.calls[0][0] as string).searchParams.get('callbackURL') ?? ''
    ).searchParams.get('oauthAttempt') as string
    await act(async () => {
      setOAuthChatAttemptStatus(attemptId, 'connected')
    })

    // The field masks while unfocused, so assert on what the draft is actually
    // for: submitting it. A mask of the right length is not proof it survived.
    const submitButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Submit'
    )
    await act(async () => {
      submitButton?.click()
    })

    expect(mockUpsertWorkspaceEnvironment).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      variables: { OPENAI_API_KEY: 'sk-test-key' },
    })
    openSpy.mockRestore()
    toastSuccess.mockRestore()
    act(() => root.unmount())
  })
})

describe('parseSpecialTags sim_key placeholder', () => {
  it('accepts a value-less {"type":"sim_key"} tag as a credential segment', () => {
    const { segments } = parseSpecialTags('<credential>{"type":"sim_key"}</credential>', false)
    const credential = segments.find((s) => s.type === 'credential')
    expect(credential).toEqual({ type: 'credential', data: [{ type: 'sim_key' }] })
  })

  it('still accepts the legacy {"redacted":true} form as a value-less sim_key placeholder', () => {
    const { segments } = parseSpecialTags(
      '<credential>{"type":"sim_key","redacted":true}</credential>',
      false
    )
    const credential = segments.find((s) => s.type === 'credential')
    expect(credential?.type).toBe('credential')
    if (credential?.type === 'credential') {
      expect(credential.data[0].type).toBe('sim_key')
      expect(credential.data[0].value).toBeUndefined()
    }
  })
})

describe('recoverTrailingBareOptions', () => {
  const bareOptions =
    '{"1": {"title": "Fix the tracker", "description": "debug"}, "2": {"title": "Inspect the miss", "description": "look"}}'

  it('renders a trailing bare-JSON options payload as an options card', () => {
    const { segments } = parseSpecialTags(`Here they are.\n${bareOptions}`, false)
    const last = segments[segments.length - 1]
    expect(last.type).toBe('options')
    if (last.type === 'options') {
      expect(last.data['1']?.title).toBe('Fix the tracker')
    }
    expect(segments[0]).toEqual({ type: 'text', content: 'Here they are.' })
  })

  it('never recovers mid-stream — a partial JSON tail must not flicker into a card', () => {
    const { segments } = parseSpecialTags(`Here they are.\n${bareOptions}`, true)
    expect(segments.every((segment) => segment.type === 'text')).toBe(true)
  })

  it('leaves ordinary JSON prose alone', () => {
    const { segments } = parseSpecialTags('The config is {"retries": 3, "mode": "fast"}', false)
    expect(segments.every((segment) => segment.type === 'text')).toBe(true)
  })

  it('does not double-render when a real options tag already parsed', () => {
    const { segments } = parseSpecialTags(`Pick one <options>${bareOptions}</options>`, false)
    expect(segments.filter((segment) => segment.type === 'options')).toHaveLength(1)
  })

  it('recovers an options payload wrapped in the singular <option> near-miss tag', () => {
    const body =
      '{"1": {"title": "Demo wait — sleep until an agent finishes", "description": "wait_agents demo"}, "2": {"title": "Demo steer — redirect a running agent mid-task", "description": "steer_agent demo"}, "3": {"title": "Demo stop — interrupt a running agent", "description": "interrupt_agent demo"}}'
    const { segments } = parseSpecialTags(
      `Next up is usually **wait**, **steer**, or **stop**.\n\n<option>${body}</option>`,
      false
    )
    const last = segments[segments.length - 1]
    expect(last.type).toBe('options')
    if (last.type === 'options') {
      expect(Object.keys(last.data)).toEqual(['1', '2', '3'])
      expect(last.data['1']?.title).toBe('Demo wait — sleep until an agent finishes')
    }
  })
})
