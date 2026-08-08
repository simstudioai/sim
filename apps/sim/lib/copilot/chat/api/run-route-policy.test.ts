/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { v2ChatRunErrorPolicies } from '@/lib/copilot/chat/api/run-route-policy'
import { ChatRunProgressUnavailableError } from '@/lib/copilot/chat/application/errors'
import {
  InsufficientWorkspacePermissionsError,
  PersonalApiKeysDisabledError,
  PrincipalKindAuthorizationError,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'

describe('v2 chat run error policies', () => {
  it('keeps the personal-key-only failure explicit', async () => {
    const response = v2ChatRunErrorPolicies.default.render(
      new PrincipalKindAuthorizationError('workspace_api_key', 'chat.runs.list')
    )

    expect(response?.status).toBe(403)
    expect(await response?.json()).toEqual({
      error: { code: 'FORBIDDEN', message: 'Chat runs require a personal API key' },
    })
  })

  it('conceals detail authorization and scoped misses as the same absence', async () => {
    for (const error of [
      new InsufficientWorkspacePermissionsError(),
      new OrchestrationError('not_found', 'Workspace not found'),
      new OrchestrationError('not_found', 'Chat run not found'),
    ]) {
      const response = v2ChatRunErrorPolicies.detail.render(error)
      expect(response?.status).toBe(404)
      expect(await response?.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'Chat run not found' },
      })
    }
  })

  it('preserves workspace personal-key policy failures', async () => {
    const response = v2ChatRunErrorPolicies.detail.render(new PersonalApiKeysDisabledError())
    expect(response?.status).toBe(403)
  })

  it('maps transient replay unavailability without masking infrastructure failures', async () => {
    expect(
      v2ChatRunErrorPolicies.detail.render(new ChatRunProgressUnavailableError())?.status
    ).toBe(503)
    expect(v2ChatRunErrorPolicies.detail.render(new Error('redis unavailable'))).toBeNull()
  })
})
