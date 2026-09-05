/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import * as tools from '@/tools/oracle_fusion_project_management'
import { oracleFusionProjectManagementCreateProjectBudgetTool } from '@/tools/oracle_fusion_project_management/create_project_budget'
import { oracleFusionProjectManagementCreateTaskTool } from '@/tools/oracle_fusion_project_management/create_task'
import { oracleFusionProjectManagementUpdateProjectTeamMemberTool } from '@/tools/oracle_fusion_project_management/update_project_team_member'

const declarations = Object.values(tools)

describe('Oracle Project Management tool input declarations', () => {
  it('declares 53 unique internal operations with credential-authoritative authentication', () => {
    expect(declarations).toHaveLength(53)
    expect(new Set(declarations.map((tool) => tool.id)).size).toBe(53)
    for (const tool of declarations) {
      expect(tool).not.toHaveProperty('request')
      expect(tool.operation.input).toBeTypeOf('function')
      expect(tool.oauth).toEqual({
        required: true,
        provider: 'oracle_fusion_project_management',
        credentialKind: 'service-account',
        authoritativeParams: ['instanceUrl'],
      })
      expect(tool.params.oauthCredential).toMatchObject({ required: true, visibility: 'user-only' })
      expect(tool.params.accessToken.visibility).toBe('hidden')
      expect(tool.params.instanceUrl.visibility).toBe('hidden')
      for (const param of Object.values(tool.params)) {
        expect(typeof param.required).toBe('boolean')
        expect(param.visibility).toBeDefined()
      }
      expect(Object.keys(tool.outputs ?? {}).length).toBeGreaterThan(0)
    }
  })

  it('passes semantic references and large string IDs unchanged, removing executor scope', () => {
    const input = {
      oauthCredential: 'credential-1',
      projectId: '999999999999999999',
      taskName: '<agent.output>',
      taskNumber: 'T1',
      taskLevel: 1,
      parentTaskId: '<previous.task.TaskId>',
      _context: { secret: 'canary' },
    }
    const result = oracleFusionProjectManagementCreateTaskTool.operation.input(input)
    expect(result).toEqual({
      oauthCredential: 'credential-1',
      projectId: '999999999999999999',
      taskName: '<agent.output>',
      taskNumber: 'T1',
      taskLevel: 1,
      parentTaskId: '<previous.task.TaskId>',
    })
  })

  it('models documented budget lines instead of an arbitrary JSON body and excludes immutable team fields', () => {
    const resources = oracleFusionProjectManagementCreateProjectBudgetTool.params.planningResources
    expect(resources).toMatchObject({
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        required: ['RbsElementId', 'TaskId'],
        additionalProperties: false,
      },
    })
    expect(resources.items?.properties?.RbsElementId.type).toBe('string')
    expect(resources.items?.properties?.PlanningStartDate).toEqual({
      anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
    })
    expect(resources.items?.properties?.PlanningAmounts.items?.properties?.Quantity).toEqual({
      anyOf: [{ type: 'number' }, { type: 'null' }],
    })
    expect(oracleFusionProjectManagementUpdateProjectTeamMemberTool.params).not.toHaveProperty(
      'personEmail'
    )
    expect(oracleFusionProjectManagementUpdateProjectTeamMemberTool.params).not.toHaveProperty(
      'projectRole'
    )
    expect(declarations.some((tool) => Object.hasOwn(tool.params, 'body'))).toBe(false)
  })
})
