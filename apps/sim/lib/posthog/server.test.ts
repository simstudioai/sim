/**
 * @vitest-environment node
 */
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

  it('stamps the request, its authentication, and the workflow call chain', () => {
    vi.mocked(loggerMock.getRequestContext).mockReturnValue({
      requestId: 'req-1',
      method: 'POST',
      path: '/api/v2/workflows/wf-3/execute',
      auth: { kind: 'oauth_access_token', clientId: 'sim-cli' },
      callChain: ['wf-1', 'wf-2'],
    })

    captureServerEvent('user-1', 'workflow_deployed', {
      workflow_id: 'workflow-1',
      workspace_id: 'workspace-1',
    })

    expect(captureSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          api_method: 'POST',
          api_path: '/api/v2/workflows/wf-3/execute',
          auth_kind: 'oauth_access_token',
          auth_client_id: 'sim-cli',
          call_chain_depth: 2,
          call_chain_root_workflow_id: 'wf-1',
          caller_workflow_id: 'wf-2',
        }),
      })
    )
  })

  it('leaves out what the request did not establish', () => {
    vi.mocked(loggerMock.getRequestContext).mockReturnValue({ requestId: 'req-1' })

    captureServerEvent('user-1', 'workflow_deployed', {
      workflow_id: 'workflow-1',
      workspace_id: 'workspace-1',
    })

    expect(captureSpy.mock.calls[0][0].properties).toEqual({
      workflow_id: 'workflow-1',
      workspace_id: 'workspace-1',
      request_id: 'req-1',
    })
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
