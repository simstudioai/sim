/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { deploymentsDeployTool } from '@/tools/deployments/deploy'
import { deploymentsGetVersionTool } from '@/tools/deployments/get_version'
import { deploymentsListVersionsTool } from '@/tools/deployments/list_versions'
import { deploymentsPromoteTool } from '@/tools/deployments/promote'
import { deploymentsUndeployTool } from '@/tools/deployments/undeploy'

const DEPLOYMENT_TOOLS = [
  deploymentsDeployTool,
  deploymentsUndeployTool,
  deploymentsPromoteTool,
  deploymentsListVersionsTool,
  deploymentsGetVersionTool,
]

describe('Deployments internal tool declarations', () => {
  it('exposes only semantic operation input without HTTP transport metadata', () => {
    for (const tool of DEPLOYMENT_TOOLS) {
      expect(tool.operation.input).toBeTypeOf('function')
      expect(tool).not.toHaveProperty('request')
    }
  })

  it('keeps trusted workspace scope out of declaration input', () => {
    expect(
      deploymentsDeployTool.operation.input({
        workflowId: 'workflow-1',
        name: 'Release 4',
        description: 'Fixes the agent prompt',
      })
    ).toEqual({
      workflowId: 'workflow-1',
      name: 'Release 4',
      description: 'Fixes the agent prompt',
    })
    expect(
      deploymentsPromoteTool.operation.input({ workflowId: 'workflow-1', version: 4 })
    ).toEqual({ workflowId: 'workflow-1', version: 4 })
  })
})
