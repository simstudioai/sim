import { describe, expect, it, vi } from 'vitest'
import type { ToolResponse } from '@/tools/types'
import { vercelCreateProjectTool } from '@/tools/vercel/create_project'
import type { VercelCreateProjectParams, VercelCreateProjectResponse } from '@/tools/vercel/types'

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

function runPostProcess(
  executeTool: (id: string, p: Record<string, unknown>) => Promise<ToolResponse>
) {
  const postProcess = vercelCreateProjectTool.postProcess
  if (!postProcess) throw new Error('postProcess missing')
  return postProcess(created, params, executeTool)
}

describe('vercel_create_project nodeVersion', () => {
  it('does not send nodeVersion in the create body, which Vercel rejects', () => {
    const body = vercelCreateProjectTool.request.body?.(params) as Record<string, unknown>
    expect(body).not.toHaveProperty('nodeVersion')
  })

  it('applies nodeVersion with a follow-up project update', async () => {
    const executeTool = vi.fn(async () => ({ success: true, output: {} }))
    const result = await runPostProcess(executeTool)
    expect(executeTool).toHaveBeenCalledWith('vercel_update_project', {
      apiKey: 'test-key',
      projectId: 'prj_1',
      nodeVersion: '22.x',
      teamId: 'team_123',
      slug: undefined,
    })
    expect(result.success).toBe(true)
  })

  it('fails with the created project id when the version update fails', async () => {
    const executeTool = vi.fn(async () => ({ success: false, output: {}, error: 'bad version' }))
    const result = await runPostProcess(executeTool)
    expect(result.success).toBe(false)
    expect(result.error).toContain('prj_1')
    expect(result.error).toContain('bad version')
  })
})
