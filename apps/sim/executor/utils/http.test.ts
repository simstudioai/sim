/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateInternalDelegationToken: vi.fn(),
  generateInternalToken: vi.fn(),
}))

vi.mock('@/lib/auth/internal', () => ({
  generateInternalDelegationToken: mocks.generateInternalDelegationToken,
  generateInternalToken: mocks.generateInternalToken,
}))

import { buildAuthHeaders, buildExecutorDelegationHeaders } from '@/executor/utils/http'

describe('executor HTTP authentication headers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.generateInternalDelegationToken.mockResolvedValue('delegation-token')
    mocks.generateInternalToken.mockResolvedValue('legacy-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('issues a workflow-scoped executor delegation', async () => {
    await expect(
      buildExecutorDelegationHeaders({
        subjectUserId: 'user-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      })
    ).resolves.toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer delegation-token',
    })

    expect(mocks.generateInternalDelegationToken).toHaveBeenCalledWith({
      subjectUserId: 'user-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })
    expect(mocks.generateInternalToken).not.toHaveBeenCalled()
  })

  it('fails instead of issuing trusted delegation headers in a browser', async () => {
    vi.stubGlobal('window', {})

    await expect(
      buildExecutorDelegationHeaders({
        subjectUserId: 'user-1',
        workflowId: 'workflow-1',
      })
    ).rejects.toThrow('Executor delegation headers can only be created on the server')
    expect(mocks.generateInternalDelegationToken).not.toHaveBeenCalled()
  })

  it('keeps the legacy helper separate during endpoint migration', async () => {
    await expect(buildAuthHeaders('user-1')).resolves.toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer legacy-token',
    })
    expect(mocks.generateInternalToken).toHaveBeenCalledWith('user-1')
    expect(mocks.generateInternalDelegationToken).not.toHaveBeenCalled()
  })
})
