/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://sim.test/workspace/workspace-1/chat/chat-1" }
 */
import { act, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/queries/workspace-usage', () => ({
  useWorkspaceUsageGate: () => ({ isSuccess: false, data: undefined }),
}))

const {
  mockParams,
  mockCredentialHost,
  mockOrganizationContext,
  mockSession,
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
  mockParams: vi.fn(() => ({ workspaceId: 'workspace-1' })),
  mockOrganizationContext: vi.fn(() => null),
  mockSession: vi.fn(() => ({ data: { user: { id: 'person' } } })),
  mockCredentialHost: vi.fn(({ children }: { children: ReactNode }) => children),
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

vi.mock('@/app/workspace/[workspaceId]/home/components/resource-workspace-host', () => ({
  ResourceWorkspaceHost: mockCredentialHost,
}))

vi.mock('@/app/o/[organizationId]/providers/organization-provider', () => ({
  useOptionalOrganizationContext: mockOrganizationContext,
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useOptionalWorkspaceHostContext: () => null,
}))
vi.mock('@/lib/core/config/deployment-shape', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDeploymentShape: () => ({ hosted: true }),
}))
vi.mock('@/hooks/use-settings-navigation', () => ({
  useSettingsNavigation: () => ({ getSettingsHref: () => '/unexpected-workspace-settings' }),
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: mockUseUserPermissionsContext,
}))

vi.mock('next/navigation', () => ({
  useParams: mockParams,
}))

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: mockSession,
}))
vi.mock('@/app/workspace/[workspaceId]/home/components/chat-surface-context', () => ({
  useChatSurface: () => ({
    SearchConnectionComponent: ({ onConnected }: { onConnected?: () => void }) => (
      <button type='button' onClick={onConnected}>
        Test Search connection
      </button>
    ),
  }),
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
import type { GenericSecretSource } from '@/lib/api/contracts/organization-secrets'
import type { CredentialItemData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags'
import { SpecialTags } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags'
import { organizationSecretKeys } from '@/hooks/queries/organization-secrets'

/**
 * Minimal dependency-free render harness (the repo has no `@testing-library/react`). Mounts the
 * component in a real React 19 root under jsdom, matching the pattern in `use-autosave.test.tsx`.
 */
function renderCredentialLink(
  data: CredentialItemData | CredentialItemData[],
  onOptionSelect?: (message: string) => void
): {
  container: HTMLDivElement
  root: Root
} {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  act(() => {
    root.render(
      <SpecialTags
        segment={{ type: 'credential', data: Array.isArray(data) ? data : [data] }}
        onOptionSelect={onOptionSelect}
      />
    )
  })
  return { container, root }
}

describe('CredentialDisplay link tag', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    mockParams.mockReturnValue({ workspaceId: 'workspace-1' })
    mockOrganizationContext.mockReturnValue(null)
    mockSession.mockReturnValue({ data: { user: { id: 'person' } } })
    mockCredentialHost.mockImplementation(({ children }: { children: ReactNode }) => children)
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

  describe('organization Generic Secrets', () => {
    const secret: CredentialItemData = {
      type: 'secret_input',
      name: 'SERVICE_API_KEY',
      scope: 'organization',
    }
    let queryClient: QueryClient
    let root: Root
    let container: HTMLDivElement
    let onContinue: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockParams.mockReturnValue({ organizationId: 'org' } as never)
      mockOrganizationContext.mockReturnValue({
        organization: { id: 'org', name: 'Example' },
        viewer: { isAdmin: true },
      } as never)
      mockUseUserPermissionsContext.mockReturnValue({ canEdit: false })
      queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
      onContinue = vi.fn()
      vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id')
      vi.spyOn(toast, 'success').mockImplementation(() => 'toast-id')
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }))
      )
    })

    afterEach(() => {
      act(() => root.unmount())
      queryClient.clear()
      container.remove()
    })

    function render(
      data: CredentialItemData[] = [secret],
      mode: 'agent' | 'assistant' | 'plan' = 'plan'
    ) {
      act(() =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <SpecialTags
              segment={{ type: 'credential', data }}
              requestMode={mode}
              onOptionSelect={onContinue}
            />
          </QueryClientProvider>
        )
      )
    }

    function setSource(source: GenericSecretSource | null) {
      queryClient.setQueryData(organizationSecretKeys.source('org'), { source })
    }

    function enter(name = 'SERVICE_API_KEY', value = 'typed-only-into-form') {
      const input = container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!
      expect(input).not.toBeNull()
      act(() => input.focus())
      act(() => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(
          input,
          value
        )
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }

    async function submit() {
      await act(async () => {
        Array.from(container.querySelectorAll('button'))
          .find((button) => button.textContent === 'Submit')
          ?.click()
      })
    }

    it.each(['member', 'missing'] as const)(
      'blocks shared setup for %s access without falling back to workspace secrets',
      (access) => {
        setSource(access === 'missing' ? null : { id: 'source', mode: 'organization' })
        mockOrganizationContext.mockReturnValue({
          organization: { id: 'org', name: 'Example' },
          viewer: { isAdmin: false },
        } as never)
        render()
        expect(container.textContent).toContain('Ask an organization admin')
        expect(container.querySelector('input')).toBeNull()
        expect(fetch).not.toHaveBeenCalled()
        expect(mockUpsertWorkspaceEnvironment).not.toHaveBeenCalled()
      }
    )

    it('clears every draft when the authenticated user changes', () => {
      setSource({ id: 'source', mode: 'member' })
      const data: CredentialItemData[] = [
        secret,
        { type: 'secret_input', name: 'PERSONAL_KEY', scope: 'personal' },
      ]
      render(data)
      enter()
      enter('PERSONAL_KEY', 'personal-only')
      mockSession.mockReturnValue({ data: { user: { id: 'another-person' } } })
      render(data)
      expect(
        container.querySelector<HTMLInputElement>('input[aria-label="SERVICE_API_KEY"]')?.value
      ).toBe('')
      expect(
        container.querySelector<HTMLInputElement>('input[aria-label="PERSONAL_KEY"]')?.value
      ).toBe('')
    })

    it('never renders organization inputs in Search mode or a workspace conversation', () => {
      setSource({ id: 'source', mode: 'organization' })
      render([secret], 'assistant')
      expect(container.querySelector('input')).toBeNull()
      mockParams.mockReturnValue({ workspaceId: 'workspace-1' })
      render()
      expect(container.textContent).toContain('require an organization conversation')
      expect(container.querySelector('input')).toBeNull()
      expect(fetch).not.toHaveBeenCalled()
    })

    it.each([403, 409])(
      'does not claim success or fall back after a %s refusal',
      async (status) => {
        setSource({ id: 'source', mode: 'member' })
        vi.mocked(fetch).mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'Access or configuration changed' }), { status })
        )
        if (status === 409)
          vi.mocked(fetch).mockResolvedValueOnce(
            new Response(JSON.stringify({ source: { id: 'new-source', mode: 'organization' } }), {
              status: 200,
            })
          )
        render()
        enter()
        await submit()
        expect(onContinue).not.toHaveBeenCalled()
        expect(mockUpsertWorkspaceEnvironment).not.toHaveBeenCalled()
        expect(mockSavePersonalEnvironment).not.toHaveBeenCalled()
        const patches = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PATCH')
        expect(patches).toHaveLength(1)
        expect(JSON.parse(String(patches[0][1]?.body))).toMatchObject({
          sourceId: 'source',
          mode: 'member',
        })
        if (status === 409) expect(container.querySelector('input')?.value).toBe('')
      }
    )
  })

  it('saves an organization credential into its explicit authorized workspace', async () => {
    mockParams.mockReturnValue({ organizationId: 'org' } as never)
    const { container, root } = renderCredentialLink(
      { type: 'secret_input', name: 'TOKEN', workspaceId: 'target-workspace' },
      vi.fn()
    )
    expect(mockCredentialHost).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'target-workspace', organizationId: 'org' }),
      undefined
    )
    const input = container.querySelector('input')!
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        'test-token'
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'Submit')
        ?.click()
    )
    expect(mockUpsertWorkspaceEnvironment).toHaveBeenCalledWith({
      workspaceId: 'target-workspace',
      variables: { TOKEN: 'test-token' },
    })
    act(() => root.unmount())
  })

  it.each(
    (
      [
        [{ type: 'secret_input', name: 'TOKEN' }],
        [
          { type: 'secret_input', name: 'A', workspaceId: 'workspace-a' },
          { type: 'secret_input', name: 'B', workspaceId: 'workspace-b' },
        ],
        [
          {
            type: 'link',
            provider: 'slack',
            workspaceId: 'workspace-a',
            value: 'https://sim.test/api/auth/oauth2/authorize?workspaceId=workspace-b',
          },
        ],
      ] satisfies CredentialItemData[][]
    ).map((data) => ({ data }))
  )('does not mount unscoped or conflicting organization controls: %j', ({ data }) => {
    mockParams.mockReturnValue({ organizationId: 'org', workspaceId: 'stale-workspace' } as never)
    const { container, root } = renderCredentialLink(data)
    expect(container.textContent).toContain('one explicit workspace target')
    expect(container.querySelector('input')).toBeNull()
    expect(mockCredentialHost).not.toHaveBeenCalled()
    expect(mockUpsertWorkspaceEnvironment).not.toHaveBeenCalled()
    act(() => root.unmount())
  })

  it('does not mount credential inputs when the target host denies access', () => {
    mockParams.mockReturnValue({ organizationId: 'org' } as never)
    mockCredentialHost.mockReturnValue(null)
    const { container, root } = renderCredentialLink({
      type: 'secret_input',
      name: 'TOKEN',
      workspaceId: 'revoked-workspace',
    })
    expect(container.querySelector('input')).toBeNull()
    expect(mockUpsertWorkspaceEnvironment).not.toHaveBeenCalled()
    expect(mockUseWorkspaceCredentials).not.toHaveBeenCalled()
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
})
