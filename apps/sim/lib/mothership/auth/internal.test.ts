import { createMockRequest } from '@sim/testing'
import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing/mocks/copilot-http.mock'
import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { internalCopilotAuth } from '@/lib/mothership/auth/internal'
import { issueRunGrant } from '@/lib/mothership/auth/run-grant'
import { RUN_GRANT_HEADER } from '@/lib/mothership/generated/sim-transport'

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
  describe('run grants', () => {
    afterEach(resetEnvMock)
    const auth = internalCopilotAuth('control', { organization: true })
    const grant = () =>
      issueRunGrant({
        userId: 'actor',
        chatId: 'chat-1',
        workspaceId: null,
        organizationId: 'org-1',
      })
    it('admits identity headers the run grant names, and refuses forged or mismatched grants', async () => {
      await expect(
        auth.authenticate(request({ ...headers, [RUN_GRANT_HEADER]: await grant() }))
      ).resolves.toMatchObject({ subjectUserId: 'actor', resourceScope: { chatId: 'chat-1' } })
      await expect(
        auth.authenticate(
          request({
            ...headers,
            'x-mothership-chat-id': 'chat-2',
            [RUN_GRANT_HEADER]: await grant(),
          })
        )
      ).rejects.toThrow('Unauthorized')
      await expect(
        auth.authenticate(request({ ...headers, [RUN_GRANT_HEADER]: 'not-a-grant' }))
      ).rejects.toThrow('Unauthorized')
    })
    it('refuses a call without a grant once grants are required', async () => {
      await expect(auth.authenticate(request(headers))).resolves.toBeDefined()
      setEnv({ MOTHERSHIP_REQUIRE_RUN_GRANT: true })
      await expect(auth.authenticate(request(headers))).rejects.toThrow('Unauthorized')
    })
  })
})
