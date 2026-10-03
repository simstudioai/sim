import { loggerMock } from '@sim/testing'
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
  let client: NonNullable<ReturnType<typeof getPostHogClient>>
  let captureSpy: MockInstance

  beforeAll(() => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test')
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_ENABLED', 'true')

    const enabledClient = getPostHogClient()
    if (!enabledClient) throw new Error('expected an enabled PostHog client to spy on')
    client = enabledClient
  })

  beforeEach(() => {
    captureSpy = vi.spyOn(client, 'capture').mockImplementation(() => {})
    vi.mocked(loggerMock.getRequestContext).mockReturnValue(undefined)
  })

  it('stamps the resolved client from the request context onto every event', () => {
    vi.mocked(loggerMock.getRequestContext).mockReturnValue({
      requestId: 'req-1',
      client: { surface: 'cli', version: '2.1.2', agent: 'claude-code', source: 'header' },
    })

    captureServerEvent('user-1', 'workflow_deployed', {
      workflow_id: 'workflow-1',
      workspace_id: 'workspace-1',
    })

    expect(captureSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          request_id: 'req-1',
          surface: 'cli',
          client_version: '2.1.2',
          coding_agent: 'claude-code',
        }),
      })
    )
  })

  it('never overwrites attribution a caller set explicitly', () => {
    vi.mocked(loggerMock.getRequestContext).mockReturnValue({
      requestId: 'req-1',
      client: { surface: 'web', source: 'fetch_metadata' },
    })

    captureServerEvent('user-1', 'search_result_selected', {
      surface: 'copilot',
    } as never)

    expect(captureSpy).toHaveBeenCalledWith(
      expect.objectContaining({ properties: expect.objectContaining({ surface: 'copilot' }) })
    )
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
