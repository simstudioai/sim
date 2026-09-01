/**
 * @vitest-environment node
 */
import type { MockInstance } from 'vitest'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureServerEvent, getPostHogClient } from '@/lib/posthog/server'

/**
 * This is the guarantee that keeps analytics off every critical path: callers
 * treat `captureServerEvent` as something that cannot fail, and several — the
 * deployment outbox among them — would turn a PostHog outage into failed work
 * if it ever started throwing.
 *
 * The client is built through a lazy `require`, which `vi.mock` cannot
 * intercept, so this spies on the real one. Its readiness latches at module
 * level, hence stubbing the env before the first read and asserting a client
 * exists — without that the whole suite would pass on a disabled no-op.
 */
describe('captureServerEvent', () => {
  let captureSpy: MockInstance

  beforeAll(() => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test')
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_ENABLED', 'true')

    const client = getPostHogClient()
    if (!client) throw new Error('expected an enabled PostHog client to spy on')
    captureSpy = vi.spyOn(client, 'capture').mockImplementation(() => {})
  })

  beforeEach(() => {
    captureSpy.mockClear()
    captureSpy.mockImplementation(() => {})
  })

  it('swallows a failing client instead of propagating to the caller', () => {
    captureSpy.mockImplementation(() => {
      throw new Error('PostHog unreachable')
    })

    expect(() =>
      captureServerEvent('user-1', 'workflow_deployed', {
        workflow_id: 'workflow-1',
        workspace_id: 'workspace-1',
      })
    ).not.toThrow()
    expect(captureSpy).toHaveBeenCalledTimes(1)
  })

  it('captures synchronously, so a caller cannot await delivery', () => {
    const result = captureServerEvent('user-1', 'workflow_deployed', {
      workflow_id: 'workflow-1',
      workspace_id: 'workspace-1',
    })

    expect(result).toBeUndefined()
    expect(captureSpy).toHaveBeenCalledTimes(1)
  })

  it('forwards insertId as $insert_id so outbox retries collapse', () => {
    captureServerEvent(
      'user-1',
      'workflow_deployed',
      { workflow_id: 'workflow-1', workspace_id: 'workspace-1' },
      { insertId: 'event-1', groups: { workspace: 'workspace-1' } }
    )

    expect(captureSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: 'user-1',
        event: 'workflow_deployed',
        properties: expect.objectContaining({
          $insert_id: 'event-1',
          $groups: { workspace: 'workspace-1' },
        }),
      })
    )
  })
})
