/**
 * The follow-up update runs through the real `vercel_update_project` tool config: only Vercel's
 * HTTP response is canned, so the test checks the PATCH the tool would send and the result the
 * create tool returns from it.
 */
import { describe, expect, it } from 'vitest'
import type { ToolResponse } from '@/tools/types'
import { vercelCreateProjectTool } from '@/tools/vercel/create_project'
import type {
  VercelCreateProjectParams,
  VercelCreateProjectResponse,
  VercelUpdateProjectParams,
} from '@/tools/vercel/types'
import { vercelUpdateProjectTool } from '@/tools/vercel/update_project'

const params: VercelCreateProjectParams = {
  apiKey: 'test-key',
  name: 'my-app',
  nodeVersion: ' 22.x ',
  teamId: 'team_123',
}

const created: VercelCreateProjectResponse = {
  success: true,
  output: { id: 'prj_1', name: 'my-app', framework: null, createdAt: 1, updatedAt: 1 },
}

interface SentRequest {
  toolId: string
  url: string
  method: unknown
  body: unknown
}

/** Builds the update tool's real request, then answers it with `reply` as Vercel would. */
function vercelUpdateBoundary(reply: Response) {
  const sent: SentRequest[] = []
  const executeTool = async (
    toolId: string,
    toolParams: Record<string, unknown>
  ): Promise<ToolResponse> => {
    const p = toolParams as unknown as VercelUpdateProjectParams
    const { url, method, body } = vercelUpdateProjectTool.request
    sent.push({
      toolId,
      url: typeof url === 'function' ? url(p) : url,
      method,
      body: body?.(p),
    })
    if (!reply.ok) return { success: false, output: {}, error: await reply.text() }
    const transform = vercelUpdateProjectTool.transformResponse
    if (!transform) throw new Error('transformResponse missing')
    return transform(reply, p)
  }
  return { sent, executeTool }
}

function runPostProcess(executeTool: ReturnType<typeof vercelUpdateBoundary>['executeTool']) {
  const postProcess = vercelCreateProjectTool.postProcess
  if (!postProcess) throw new Error('postProcess missing')
  return postProcess(created, params, executeTool)
}

describe('vercel_create_project nodeVersion', () => {
  it('does not send nodeVersion in the create body, which Vercel rejects', () => {
    const body = vercelCreateProjectTool.request.body?.(params) as Record<string, unknown>
    expect(body).not.toHaveProperty('nodeVersion')
  })

  it('rejects an unsupported nodeVersion before creating the project', () => {
    const body = vercelCreateProjectTool.request.body
    if (!body) throw new Error('body missing')
    expect(() => body({ ...params, nodeVersion: '22' })).toThrow(/Invalid Node.js version "22"/)
    expect(() => body({ ...params, nodeVersion: 'v20.x' })).toThrow(/Invalid Node.js version/)
    for (const unset of ['', '  ', null, undefined]) {
      expect(() =>
        body({ ...params, nodeVersion: unset as unknown as string | undefined })
      ).not.toThrow()
    }
  })

  it('applies nodeVersion with a PATCH to the created project', async () => {
    const boundary = vercelUpdateBoundary(
      new Response(
        JSON.stringify({ id: 'prj_1', name: 'my-app', nodeVersion: '22.x', updatedAt: 2 })
      )
    )
    const result = await runPostProcess(boundary.executeTool)

    expect(boundary.sent).toEqual([
      {
        toolId: 'vercel_update_project',
        url: 'https://api.vercel.com/v9/projects/prj_1?teamId=team_123',
        method: 'PATCH',
        body: { nodeVersion: '22.x' },
      },
    ])
    expect(result.success).toBe(true)
    expect(result.output).toMatchObject({ id: 'prj_1', updatedAt: 2 })
  })

  it('fails with the created project id when the version update fails', async () => {
    const boundary = vercelUpdateBoundary(new Response('invalid nodeVersion', { status: 400 }))
    const result = await runPostProcess(boundary.executeTool)
    expect(result.success).toBe(false)
    expect(result.error).toContain('prj_1')
    expect(result.error).toContain('invalid nodeVersion')
  })

  it('fails instead of dropping the version when the update call throws', async () => {
    const postProcess = vercelCreateProjectTool.postProcess
    if (!postProcess) throw new Error('postProcess missing')
    const result = await postProcess(created, params, async () => {
      throw new Error('socket hang up')
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('socket hang up')
  })
})
