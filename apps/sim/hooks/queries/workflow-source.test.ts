/**
 * @vitest-environment jsdom
 */
import { jsonResponse } from '@sim/testing/helpers/http'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWorkflowSourceText } from '@/hooks/queries/workflow-source'

const WORKFLOW_ID = 'wf-1'

/** A server holding one draft, answering a matching `If-None-Match` with `304` as the route does. */
function sourceServer() {
  const state = { text: '// v1', etag: '"e1"', reads: 0 }
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    state.reads += 1
    const ifNoneMatch = new Headers(init?.headers).get('If-None-Match')
    if (ifNoneMatch === state.etag) return new Response(null, { status: 304 })
    const response = jsonResponse({
      data: {
        workflowId: WORKFLOW_ID,
        workspaceId: 'ws-1',
        files: { 'workflow.ts': state.text },
        lock: { version: 1, blocks: {}, variables: {} },
        base: { workflowId: WORKFLOW_ID, workspaceId: 'ws-1', fingerprint: 'f', catalogHash: 'c' },
        canonicalHash: 'h',
        sdkMajor: 1,
        blockTypes: [],
        diagnostics: [],
      },
    })
    response.headers.set('etag', state.etag)
    return response
  })
  return { state, fetchMock }
}

describe('fetchWorkflowSourceText', () => {
  let server: ReturnType<typeof sourceServer>
  let queryClient: QueryClient

  beforeEach(() => {
    server = sourceServer()
    vi.stubGlobal('fetch', server.fetchMock)
    queryClient = new QueryClient()
  })

  it('downloads an edit made since the Code tab last read the source', async () => {
    expect(await fetchWorkflowSourceText(queryClient, WORKFLOW_ID)).toBe('// v1')
    server.state.text = '// v2'
    server.state.etag = '"e2"'

    expect(await fetchWorkflowSourceText(queryClient, WORKFLOW_ID)).toBe('// v2')
  })

  it('keeps the cached copy when the server answers 304', async () => {
    await fetchWorkflowSourceText(queryClient, WORKFLOW_ID)

    expect(await fetchWorkflowSourceText(queryClient, WORKFLOW_ID)).toBe('// v1')
    expect(server.state.reads).toBe(2)
  })
})
