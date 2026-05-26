/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { AzureDevOpsBlock } from './azure_devops'

const expectedToolIds = [
  'azure_devops_add_comment',
  'azure_devops_create_work_item',
  'azure_devops_get_build_log',
  'azure_devops_get_build_timeline',
  'azure_devops_get_comments',
  'azure_devops_get_pipeline',
  'azure_devops_get_pipeline_run',
  'azure_devops_get_work_item',
  'azure_devops_get_work_items_batch',
  'azure_devops_get_work_items_between_builds',
  'azure_devops_list_build_logs',
  'azure_devops_list_builds',
  'azure_devops_list_pipeline_runs',
  'azure_devops_list_pipelines',
  'azure_devops_query_work_items',
  'azure_devops_update_work_item',
]

describe('AzureDevOpsBlock', () => {
  const block = AzureDevOpsBlock

  it('exposes every Azure DevOps tool through the operation dropdown and tool access list', () => {
    const operation = block.subBlocks.find((subBlock) => subBlock.id === 'operation')
    expect(operation?.type).toBe('dropdown')
    expect(block.tools.access.sort()).toEqual(expectedToolIds)
    const operationOptions =
      typeof operation?.options === 'function' ? operation.options() : operation?.options
    expect(operationOptions?.map((option) => option.id).sort()).toEqual(expectedToolIds)
  })

  it('limits update work item state to Azure DevOps Basic process options', () => {
    const state = block.subBlocks.find((subBlock) => subBlock.id === 'state')
    expect(state?.type).toBe('dropdown')
    expect(state?.options).toEqual([
      { label: 'To Do', id: 'To Do' },
      { label: 'Doing', id: 'Doing' },
      { label: 'Done', id: 'Done' },
    ])
  })

  it('limits create work item types to the Azure DevOps Basic process options', () => {
    const workItemType = block.subBlocks.find((subBlock) => subBlock.id === 'workItemType')
    expect(workItemType?.type).toBe('dropdown')
    expect(workItemType?.options).toEqual([
      { label: 'Issue', id: 'Issue' },
      { label: 'Task', id: 'Task' },
      { label: 'Epic', id: 'Epic' },
    ])
    expect(workItemType?.value?.()).toBe('Issue')
  })

  it('routes every operation to the matching tool id without serialization-time coercion', () => {
    for (const toolId of expectedToolIds) {
      expect(block.tools.config.tool?.({ operation: toolId })).toBe(toolId)
    }
  })

  it('maps common params and coerces numeric fields at execution time', () => {
    const pipelineRunParams = block.tools.config.params?.({
      accessToken: 'pat-token',
      organization: 'mzxchandra',
      project: 'sim-testing',
      operation: 'azure_devops_get_pipeline_run',
      pipelineId: '42',
      runId: '99',
    })

    expect(pipelineRunParams).toMatchObject({
      accessToken: 'pat-token',
      organization: 'mzxchandra',
      project: 'sim-testing',
      pipelineId: 42,
      runId: 99,
    })

    const listBuildParams = block.tools.config.params?.({
      accessToken: 'pat-token',
      organization: 'mzxchandra',
      project: 'sim-testing',
      operation: 'azure_devops_list_builds',
      resultFilter: 'failed',
      top: '10',
    })

    expect(listBuildParams).toMatchObject({
      accessToken: 'pat-token',
      organization: 'mzxchandra',
      project: 'sim-testing',
      resultFilter: 'failed',
      top: 10,
    })

    const getBuildLogParams = block.tools.config.params?.({
      accessToken: 'pat-token',
      organization: 'mzxchandra',
      project: 'sim-testing',
      operation: 'azure_devops_get_build_log',
      buildId: '101',
      logId: '3',
    })

    expect(getBuildLogParams).toMatchObject({
      accessToken: 'pat-token',
      organization: 'mzxchandra',
      project: 'sim-testing',
      buildId: 101,
      logId: 3,
    })

    const createWorkItemParams = block.tools.config.params?.({
      accessToken: 'pat-token',
      organization: 'mzxchandra',
      project: 'sim-testing',
      operation: 'azure_devops_create_work_item',
      workItemType: 'Issue',
      title: 'Pipeline failure',
      priority: '2',
    })

    expect(createWorkItemParams).toMatchObject({
      accessToken: 'pat-token',
      organization: 'mzxchandra',
      project: 'sim-testing',
      workItemType: 'Issue',
      title: 'Pipeline failure',
      priority: 2,
    })

    const updateWorkItemParams = block.tools.config.params?.({
      accessToken: 'pat-token',
      organization: 'mzxchandra',
      project: 'sim-testing',
      operation: 'azure_devops_update_work_item',
      workItemId: '101',
      state: 'Doing',
      effort: '8',
      priority: '1',
    })

    expect(updateWorkItemParams).toMatchObject({
      accessToken: 'pat-token',
      organization: 'mzxchandra',
      project: 'sim-testing',
      workItemId: 101,
      state: 'Doing',
      effort: 8,
      priority: 1,
    })
  })

  it('declares downstream outputs for pipeline, build, work item, and comment operations', () => {
    expect(block.outputs.content).toBeDefined()
    expect(block.outputs.metadata).toBeDefined()
  })
})
