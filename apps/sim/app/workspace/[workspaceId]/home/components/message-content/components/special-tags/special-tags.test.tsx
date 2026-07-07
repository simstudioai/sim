/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockUseUserPermissionsContext, mockUseWorkspaceCredential } = vi.hoisted(() => ({
  mockUseUserPermissionsContext: vi.fn(),
  mockUseWorkspaceCredential: vi.fn(),
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: mockUseUserPermissionsContext,
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
}))

vi.mock('@/hooks/queries/credentials', () => ({
  useWorkspaceCredential: mockUseWorkspaceCredential,
}))

import type { CredentialTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags'
import {
  parseSpecialTags,
  SpecialTags,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/special-tags'

/**
 * Minimal dependency-free render harness (the repo has no `@testing-library/react`). Mounts the
 * component in a real React 19 root under jsdom, matching the pattern in `use-autosave.test.tsx`.
 */
function renderCredentialLink(data: CredentialTagData): { container: HTMLDivElement; root: Root } {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  act(() => {
    root.render(<SpecialTags segment={{ type: 'credential', data }} />)
  })
  return { container, root }
}

describe('CredentialDisplay link tag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseUserPermissionsContext.mockReturnValue({ canEdit: true })
    mockUseWorkspaceCredential.mockReturnValue({ data: null })
  })

  it('does not render an anchor for a javascript: scheme value', () => {
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'github',
      value: 'javascript:alert(1)',
    })

    expect(container.querySelector('a')).toBeNull()
    act(() => root.unmount())
  })

  it('does not render an anchor for a data: scheme value', () => {
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'github',
      value: 'data:text/html,<script>alert(1)</script>',
    })

    expect(container.querySelector('a')).toBeNull()
    act(() => root.unmount())
  })

  it('renders a working link for a real http(s) connect URL', () => {
    const url = 'https://github.com/login/oauth/authorize?client_id=abc&scope=repo'
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'github',
      value: url,
    })

    const link = container.querySelector('a')
    expect(link).not.toBeNull()
    expect(link?.getAttribute('href')).toBe(url)
    expect(container.textContent).toContain('Connect github')
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
    act(() => root.unmount())
  })

  it('does not query a credential for a plain connect URL', () => {
    const { root } = renderCredentialLink({
      type: 'link',
      provider: 'github',
      value: 'https://github.com/login/oauth/authorize?client_id=abc',
    })

    expect(mockUseWorkspaceCredential).toHaveBeenCalledWith(undefined)
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

  it('falls back to the provider label while the reconnect credential is unresolved', () => {
    const { container, root } = renderCredentialLink({
      type: 'link',
      provider: 'google-email',
      value:
        'https://sim.test/api/auth/oauth2/authorize?providerId=google-email&workspaceId=ws-1&credentialId=cred-1',
    })

    expect(container.textContent).toContain('Reconnect google-email')
    act(() => root.unmount())
  })
})

describe('parseSpecialTags sim_key placeholder', () => {
  it('accepts a value-less {"type":"sim_key"} tag as a credential segment', () => {
    const { segments } = parseSpecialTags('<credential>{"type":"sim_key"}</credential>', false)
    const credential = segments.find((s) => s.type === 'credential')
    expect(credential).toEqual({ type: 'credential', data: { type: 'sim_key' } })
  })

  it('still accepts the legacy {"redacted":true} form as a value-less sim_key placeholder', () => {
    const { segments } = parseSpecialTags(
      '<credential>{"type":"sim_key","redacted":true}</credential>',
      false
    )
    const credential = segments.find((s) => s.type === 'credential')
    expect(credential?.type).toBe('credential')
    if (credential?.type === 'credential') {
      expect(credential.data.type).toBe('sim_key')
      expect(credential.data.value).toBeUndefined()
    }
  })
})
