/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRefetchPersonalEnvironment,
  mockRefetchWorkspaceCredentials,
  mockSavePersonalEnvironment,
  mockUpsertWorkspaceEnvironment,
  mockUseUserPermissionsContext,
  mockUseWorkspaceCredential,
  mockUseWorkspaceCredentials,
} = vi.hoisted(() => ({
  mockRefetchPersonalEnvironment: vi.fn(async () => ({ data: {} })),
  mockRefetchWorkspaceCredentials: vi.fn(async () => ({ data: [] })),
  mockSavePersonalEnvironment: vi.fn(async () => undefined),
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

import type { CredentialItemData } from '@/components/chat/special-tags/parse'
import { parseSpecialTags } from '@/components/chat/special-tags/parse'
import {
  createOAuthChatAttempt,
  setOAuthChatAttemptStatus,
} from '@/lib/credentials/oauth-chat-attempt'
import { SpecialTags } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags'

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
