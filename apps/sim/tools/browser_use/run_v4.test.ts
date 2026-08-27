/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runV4Tool } from '@/tools/browser_use/run_v4'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Browser Use V4 tool', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates a V4 run, polls status, then returns the summary', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'run-1',
          status: 'queued',
          model: 'gpt-5.6-luna',
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
        })
      )
      .mockResolvedValueOnce(jsonResponse({ status: 'completed' }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'run-1',
          status: 'completed',
          result: 'Done',
          error: null,
          model: 'gpt-5.6-luna',
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          totalCostUsd: '0.12',
          totalInputTokens: 120,
          totalOutputTokens: 34,
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await runV4Tool.directExecution?.({
      task: 'Check the latest invoice',
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      sessionId: 'session-0',
      workspaceId: 'workspace-0',
      profileId: 'profile-1',
      record: true,
      agentmail: false,
      maxCostUsd: 2.5,
      secretBindings: [
        {
          cells: {
            Alias: 'billing_password',
            Value: 'secret-value',
            'Allowed Domains': 'billing.example.com, auth.example.com',
          },
        },
      ],
    })

    expect(result).toEqual({
      success: true,
      output: {
        id: 'run-1',
        status: 'completed',
        result: 'Done',
        error: null,
        model: 'gpt-5.6-luna',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        totalCostUsd: '0.12',
        totalInputTokens: 120,
        totalOutputTokens: 34,
      },
      error: undefined,
    })

    const createRequest = fetchMock.mock.calls[0]
    expect(createRequest?.[0]).toBe('https://api.browser-use.com/api/v4/runs')
    expect(createRequest?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Browser-Use-API-Key': 'test-key',
      },
    })
    expect(JSON.parse(String(createRequest?.[1]?.body))).toEqual({
      task: 'Check the latest invoice',
      model: 'gpt-5.6-luna',
      sessionId: 'session-0',
      workspaceId: 'workspace-0',
      agentmail: false,
      maxCostUsd: 2.5,
      secretBindings: [
        {
          alias: 'billing_password',
          source: { type: 'inline', value: 'secret-value' },
          allowedDomains: ['billing.example.com', 'auth.example.com'],
        },
      ],
      browserSettings: { profileId: 'profile-1', record: true },
    })
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.browser-use.com/api/v4/runs/run-1/status'
    )
    expect(fetchMock.mock.calls[2]?.[0]).toBe('https://api.browser-use.com/api/v4/runs/run-1')
  })

  it('stops polling when the workflow is aborted', async () => {
    const controller = new AbortController()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'run-1',
          status: 'queued',
          model: 'gpt-5.6-luna',
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
        })
      )
      .mockImplementationOnce(async (_input, init) => {
        expect(init?.signal).toBe(controller.signal)
        controller.abort(new Error('Workflow cancelled'))
        return jsonResponse({ status: 'running' })
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runV4Tool.directExecution?.(
      { task: 'Check the latest invoice', apiKey: 'test-key' },
      controller.signal
    )

    expect(result?.success).toBe(false)
    expect(result?.error).toBe('Error running V4 agent: Workflow cancelled')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal)
  })

  it('returns the upstream create error without polling', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response('Insufficient credits', {
        status: 402,
        statusText: 'Payment Required',
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await runV4Tool.directExecution?.({
      task: 'Check the latest invoice',
      apiKey: 'test-key',
    })

    expect(result?.success).toBe(false)
    expect(result?.error).toBe('Failed to create V4 run: Insufficient credits')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
