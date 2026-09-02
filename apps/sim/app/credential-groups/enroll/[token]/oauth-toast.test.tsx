/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockError, mockSetOAuthStatus, mockSuccess } = vi.hoisted(() => ({
  mockError: vi.fn(),
  mockSetOAuthStatus: vi.fn().mockResolvedValue(null),
  mockSuccess: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({
  useToast: () => ({
    toast: {
      error: mockError,
      success: mockSuccess,
    },
  }),
}))

vi.mock('nuqs', () => ({
  useQueryStates: () => [{}, mockSetOAuthStatus],
}))

import { CredentialGroupOAuthToast } from '@/app/credential-groups/enroll/[token]/oauth-toast'

function renderToast(variant: 'success' | 'error', message: string): Root {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.createElement('div'))
  act(() => root.render(<CredentialGroupOAuthToast message={message} variant={variant} />))
  return root
}

describe('CredentialGroupOAuthToast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows OAuth success once and removes callback state from the URL', () => {
    const root = renderToast('success', 'Gmail connected successfully.')

    expect(mockSuccess).toHaveBeenCalledOnce()
    expect(mockSuccess).toHaveBeenCalledWith('Gmail connected successfully.')
    expect(mockSetOAuthStatus).toHaveBeenCalledWith(
      { connected: null, mcp: null, mcpServerId: null, oauth: null, submitted: null },
      { history: 'replace', scroll: false }
    )
    act(() => root.unmount())
  })

  it('uses the error toast and preserves unrelated query parameters', () => {
    const root = renderToast('error', 'Authorization was canceled.')

    expect(mockError).toHaveBeenCalledWith('Authorization was canceled.')
    expect(mockSetOAuthStatus).toHaveBeenCalledWith(
      { connected: null, mcp: null, mcpServerId: null, oauth: null, submitted: null },
      { history: 'replace', scroll: false }
    )
    act(() => root.unmount())
  })

  it('removes the submitted state after showing the completion toast', () => {
    const root = renderToast('success', 'Accounts submitted successfully.')

    expect(mockSuccess).toHaveBeenCalledWith('Accounts submitted successfully.')
    expect(mockSetOAuthStatus).toHaveBeenCalledWith(
      { connected: null, mcp: null, mcpServerId: null, oauth: null, submitted: null },
      { history: 'replace', scroll: false }
    )
    act(() => root.unmount())
  })
})
