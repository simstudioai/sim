import { createMockRequest } from '@sim/testing'
import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing/mocks/copilot-http.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { internalCopilotAuth } from '@/lib/mothership/auth/internal'

vi.mock('@/lib/mothership/request/http', () => copilotHttpMock)

const apiKey = copilotHttpMockFns.mockCheckInternalApiKey

describe('worker control identity', () => {
  beforeEach(() => apiKey.mockReturnValue({ success: true }))
  function request(headers: Record<string, string>) {
    return createMockRequest('POST', {}, headers)
  }
  const headers = {
    'x-mothership-user-id': 'actor',
    'x-mothership-organization-id': 'org-1',
    'x-mothership-chat-id': 'chat-1',
  }
  it('admits only explicitly enabled organization control with a private chat binding', async () => {
    const principal = await internalCopilotAuth('control', { organization: true }).authenticate(
      request(headers)
    )
    expect(principal).toMatchObject({
      kind: 'organization_delegated',
      subjectUserId: 'actor',
      organizationId: 'org-1',
      audience: 'control',
      resourceScope: { chatId: 'chat-1' },
    })
    expect(principal).not.toHaveProperty('workspaceId')
    await expect(internalCopilotAuth('tasks').authenticate(request(headers))).rejects.toThrow(
      'Unauthorized'
    )
  })
  it('rejects mixed owners, absent chat bindings and unauthenticated identity assertions', async () => {
    const auth = internalCopilotAuth('control', { organization: true })
    await expect(
      auth.authenticate(request({ ...headers, 'x-mothership-workspace-id': 'workspace' }))
    ).rejects.toThrow('Unauthorized')
    await expect(
      auth.authenticate(request({ ...headers, 'x-mothership-chat-id': '' }))
    ).rejects.toThrow('Unauthorized')
    apiKey.mockReturnValue({ success: false })
    await expect(auth.authenticate(request(headers))).rejects.toThrow('Unauthorized')
  })
})
