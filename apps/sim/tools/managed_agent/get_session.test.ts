/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeManagedAgentGetSessionOperation } from '@/lib/internal/managed-agent/operations/get-session'

const SESSION_INPUT = {
  credential: 'credential-1',
  accessToken: 'sk-ant-fake',
  sessionId: 'sesn_1',
}

describe('managed_agent_get_session', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not expose a stale requires-action gate after the session resumes', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        status: 'running',
        stop_reason: { type: 'requires_action', event_ids: ['sevt_1'] },
      })
    )

    const result = await executeManagedAgentGetSessionOperation(SESSION_INPUT, undefined)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      success: true,
      output: {
        status: 'running',
        stopReason: 'requires_action',
        requiresAction: false,
        pendingTools: [],
      },
    })
  })

  it('resolves current requires-action gates while the session is idle', async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          status: 'idle',
          stop_reason: { type: 'requires_action', event_ids: ['sevt_1'] },
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              id: 'sevt_1',
              type: 'agent.custom_tool_use',
              name: 'lookup',
              input: { query: 'test' },
            },
          ],
          next_page: null,
        })
      )

    const result = await executeManagedAgentGetSessionOperation(SESSION_INPUT, undefined)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      success: true,
      output: {
        status: 'idle',
        requiresAction: true,
        pendingTools: [
          {
            id: 'sevt_1',
            eventType: 'agent.custom_tool_use',
            kind: 'custom_tool_result',
            name: 'lookup',
            input: { query: 'test' },
          },
        ],
      },
    })
  })
})
