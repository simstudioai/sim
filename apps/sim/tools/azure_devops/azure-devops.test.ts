/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAzureDevOpsEventMatch } from '@/triggers/azure_devops/utils'
import { tools } from '../registry'
import type { ToolConfig } from '../types'
import { addCommentTool } from './add_comment'
import { createWorkItemTool } from './create_work_item'
import { getBuildLogTool } from './get_build_log'
import { getBuildTimelineTool } from './get_build_timeline'
import { getCommentsTool } from './get_comments'
import { getPipelineTool } from './get_pipeline'
import { getPipelineRunTool } from './get_pipeline_run'
import { getWorkItemTool } from './get_work_item'
import { getWorkItemsBatchTool } from './get_work_items_batch'
import { getWorkItemsBetweenBuildsTool } from './get_work_items_between_builds'
import { listBuildLogsTool } from './list_build_logs'
import { listBuildsTool } from './list_builds'
import { listPipelineRunsTool } from './list_pipeline_runs'
import { listPipelinesTool } from './list_pipelines'
import { queryWorkItemsTool } from './query_work_items'
import type {
  AddCommentParams,
  CreateWorkItemParams,
  GetBuildLogParams,
  GetCommentsParams,
  GetPipelineParams,
  GetPipelineRunParams,
  GetWorkItemParams,
  GetWorkItemsBatchParams,
  GetWorkItemsBetweenBuildsParams,
  ListBuildLogsParams,
  ListBuildsParams,
  ListPipelineRunsParams,
  ListPipelinesParams,
  QueryWorkItemsParams,
  UpdateWorkItemParams,
} from './types'
import { updateWorkItemTool } from './update_work_item'

const baseParams = {
  organization: 'contoso',
  project: 'Fabrikam',
  accessToken: 'pat-token',
}

const authHeader = `Basic ${Buffer.from(':pat-token').toString('base64')}`

const allTools = [
  addCommentTool,
  createWorkItemTool,
  getBuildLogTool,
  getCommentsTool,
  getPipelineTool,
  getPipelineRunTool,
  getWorkItemTool,
  getWorkItemsBatchTool,
  getWorkItemsBetweenBuildsTool,
  listBuildLogsTool,
  listBuildsTool,
  listPipelineRunsTool,
  listPipelinesTool,
  queryWorkItemsTool,
  updateWorkItemTool,
] as const

function buildUrl<P, R>(tool: ToolConfig<P, R>, params: P): string {
  return typeof tool.request.url === 'function' ? tool.request.url(params) : tool.request.url
}

function buildHeaders<P, R>(tool: ToolConfig<P, R>, params: P): Record<string, string> {
  return tool.request.headers(params)
}

function buildBody<P, R>(tool: ToolConfig<P, R>, params: P): unknown {
  return tool.request.body?.(params)
}

function responseJson(body: unknown): Response {
  return new Response(JSON.stringify(body))
}

const rawWorkItem = {
  id: 101,
  url: 'https://dev.azure.com/contoso/Fabrikam/_apis/wit/workItems/101',
  fields: {
    'System.Title': 'SimIntegrationTest Issue',
    'System.State': 'Doing',
    'System.WorkItemType': 'Issue',
    'System.AssignedTo': { displayName: 'Ada Lovelace' },
    'System.AreaPath': 'Fabrikam\\Platform',
  },
}

const rawComment = {
  workItemId: 101,
  commentId: 9,
  version: 1,
  text: 'SimIntegrationTest comment',
  renderedText: '<p>SimIntegrationTest comment</p>',
  createdBy: { displayName: 'Ada Lovelace' },
  createdDate: '2026-05-15T10:00:00Z',
  modifiedBy: { displayName: 'Ada Lovelace' },
  modifiedDate: '2026-05-15T10:00:00Z',
  isDeleted: false,
  url: 'https://dev.azure.com/contoso/Fabrikam/_apis/wit/workitems/101/comments/9',
  id: 9,
}

describe('Azure DevOps tool contracts', () => {
  it('exports and registers the full planned tool surface', () => {
    const expectedIds = [
      'azure_devops_add_comment',
      'azure_devops_create_work_item',
      'azure_devops_get_build_log',
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

    expect(allTools.map((tool) => tool.id).sort()).toEqual(expectedIds)
    for (const id of expectedIds) {
      expect(tools[id]?.id).toBe(id)
    }
  })

  it('sets Basic PAT auth on every tool', () => {
    for (const tool of allTools) {
      expect(
        buildHeaders(tool, {
          ...baseParams,
          pipelineId: 1,
          runId: 2,
          buildId: 3,
          logId: 4,
          fromBuildId: 5,
          toBuildId: 6,
          workItemId: 7,
          ids: '7',
          wiqlQuery: 'SELECT [System.Id] FROM workitems',
          workItemType: 'Issue',
          title: 'Issue title',
          text: 'Comment text',
        }).Authorization
      ).toBe(authHeader)
    }
  })
})

describe('Azure DevOps request builders', () => {
  it('builds pipeline URLs and optional params', () => {
    expect(buildUrl(listPipelinesTool, baseParams)).toBe(
      'https://dev.azure.com/contoso/Fabrikam/_apis/pipelines?api-version=7.2-preview.1'
    )
    expect(
      buildUrl(listPipelinesTool, {
        ...baseParams,
        orderBy: 'name',
        top: 10,
        continuationToken: 'next-page',
      } satisfies ListPipelinesParams)
    ).toBe(
      'https://dev.azure.com/contoso/Fabrikam/_apis/pipelines?api-version=7.2-preview.1&orderBy=name&%24top=10&continuationToken=next-page'
    )
    expect(
      buildUrl(getPipelineTool, {
        ...baseParams,
        pipelineId: 42,
        pipelineVersion: 3,
      } satisfies GetPipelineParams)
    ).toBe(
      'https://dev.azure.com/contoso/Fabrikam/_apis/pipelines/42?api-version=7.2-preview.1&pipelineVersion=3'
    )
    expect(
      buildUrl(listPipelineRunsTool, {
        ...baseParams,
        pipelineId: 42,
      } satisfies ListPipelineRunsParams)
    ).toBe(
      'https://dev.azure.com/contoso/Fabrikam/_apis/pipelines/42/runs?api-version=7.2-preview.1'
    )
    expect(
      buildUrl(getPipelineRunTool, {
        ...baseParams,
        pipelineId: 42,
        runId: 99,
      } satisfies GetPipelineRunParams)
    ).toBe(
      'https://dev.azure.com/contoso/Fabrikam/_apis/pipelines/42/runs/99?api-version=7.2-preview.1'
    )
  })

  it('builds build URLs and optional filters', () => {
    expect(
      buildUrl(listBuildsTool, {
        ...baseParams,
        definitionIds: '1,2',
        top: 20,
        statusFilter: 'completed',
        resultFilter: 'failed',
        branchName: 'refs/heads/main',
      } satisfies ListBuildsParams)
    ).toBe(
      'https://dev.azure.com/contoso/Fabrikam/_apis/build/builds?api-version=7.2-preview.8&definitions=1%2C2&%24top=20&statusFilter=completed&resultFilter=failed&branchName=refs%2Fheads%2Fmain'
    )
    expect(
      buildUrl(listBuildLogsTool, {
        ...baseParams,
        buildId: 101,
      } satisfies ListBuildLogsParams)
    ).toBe(
      'https://dev.azure.com/contoso/Fabrikam/_apis/build/builds/101/logs?api-version=7.2-preview.2'
    )
    expect(
      buildUrl(getBuildLogTool, {
        ...baseParams,
        buildId: 101,
        logId: 3,
        startLine: 5,
        endLine: 15,
      } satisfies GetBuildLogParams)
    ).toBe(
      'https://dev.azure.com/contoso/Fabrikam/_apis/build/builds/101/logs/3?api-version=7.2-preview.2&startLine=5&endLine=15'
    )
    expect(buildHeaders(getBuildLogTool, { ...baseParams, buildId: 101, logId: 3 }).Accept).toBe(
      'text/plain'
    )
  })

  it('uses the documented work-items-between-builds endpoint shape', () => {
    expect(
      buildUrl(getWorkItemsBetweenBuildsTool, {
        ...baseParams,
        fromBuildId: 11,
        toBuildId: 12,
      } satisfies GetWorkItemsBetweenBuildsParams)
    ).toBe(
      'https://dev.azure.com/contoso/Fabrikam/_apis/build/workitems?fromBuildId=11&toBuildId=12&api-version=7.2-preview.2'
    )
  })

  it('builds work item URLs and bodies', () => {
    expect(buildUrl(queryWorkItemsTool, baseParams)).toBe(
      'https://dev.azure.com/contoso/Fabrikam/_apis/wit/wiql?api-version=7.2-preview.2'
    )
    expect(
      buildBody(queryWorkItemsTool, {
        ...baseParams,
        wiqlQuery: 'SELECT [System.Id] FROM workitems',
      } satisfies QueryWorkItemsParams)
    ).toEqual({ query: 'SELECT [System.Id] FROM workitems' })
    expect(
      buildUrl(getWorkItemTool, {
        ...baseParams,
        workItemId: 101,
      } satisfies GetWorkItemParams)
    ).toBe(
      'https://dev.azure.com/contoso/Fabrikam/_apis/wit/workitems/101?%24expand=all&api-version=7.2-preview.3'
    )
    expect(
      buildUrl(getWorkItemsBatchTool, {
        ...baseParams,
        ids: '101,102',
      } satisfies GetWorkItemsBatchParams)
    ).toBe(
      'https://dev.azure.com/contoso/Fabrikam/_apis/wit/workitems?ids=101%2C102&%24expand=all&api-version=7.2-preview.3'
    )
  })

  it('builds JSON Patch work item write requests', () => {
    const createParams = {
      ...baseParams,
      workItemType: 'Issue',
      title: 'Pipeline failure',
      description: '<p>Failure details</p>',
      assignedTo: 'ada@example.com',
      areaPath: 'Fabrikam\\Platform',
    } satisfies CreateWorkItemParams

    expect(buildUrl(createWorkItemTool, createParams)).toBe(
      'https://dev.azure.com/contoso/Fabrikam/_apis/wit/workitems/$Issue?api-version=7.2-preview.3'
    )
    expect(buildHeaders(createWorkItemTool, createParams)['Content-Type']).toBe(
      'application/json-patch+json'
    )
    expect(buildBody(createWorkItemTool, createParams)).toEqual([
      { op: 'add', path: '/fields/System.Title', value: 'Pipeline failure' },
      { op: 'add', path: '/fields/System.Description', value: '<p>Failure details</p>' },
      { op: 'add', path: '/fields/System.AssignedTo', value: 'ada@example.com' },
      { op: 'add', path: '/fields/System.AreaPath', value: 'Fabrikam\\Platform' },
    ])

    const updateParams = {
      ...baseParams,
      workItemId: 101,
      title: 'Updated pipeline failure',
      state: 'Doing',
      effort: 5,
    } satisfies UpdateWorkItemParams

    expect(buildUrl(updateWorkItemTool, updateParams)).toBe(
      'https://dev.azure.com/contoso/Fabrikam/_apis/wit/workitems/101?api-version=7.2-preview.3'
    )
    expect(buildHeaders(updateWorkItemTool, updateParams)['Content-Type']).toBe(
      'application/json-patch+json'
    )
    expect(buildBody(updateWorkItemTool, updateParams)).toEqual([
      { op: 'replace', path: '/fields/System.Title', value: 'Updated pipeline failure' },
      { op: 'replace', path: '/fields/System.State', value: 'Doing' },
      { op: 'replace', path: '/fields/Microsoft.VSTS.Scheduling.Effort', value: 5 },
    ])
    expect(() => buildBody(updateWorkItemTool, { ...baseParams, workItemId: 101 })).toThrow(
      /requires at least one field/
    )

    const createWithEffortParams = {
      ...createParams,
      effort: 3,
    } satisfies CreateWorkItemParams

    expect(buildBody(createWorkItemTool, createWithEffortParams)).toContainEqual({
      op: 'add',
      path: '/fields/Microsoft.VSTS.Scheduling.Effort',
      value: 3,
    })
  })

  it('emits Epic-only scheduling patch ops on create', () => {
    const epicParams = {
      ...baseParams,
      workItemType: 'Epic',
      title: 'Q3 platform epic',
      startDate: '2026-06-01T00:00:00Z',
      targetDate: '2026-09-30T00:00:00Z',
    } satisfies CreateWorkItemParams

    const body = buildBody(createWorkItemTool, epicParams)
    expect(body).toContainEqual({
      op: 'add',
      path: '/fields/Microsoft.VSTS.Scheduling.StartDate',
      value: '2026-06-01T00:00:00Z',
    })
    expect(body).toContainEqual({
      op: 'add',
      path: '/fields/Microsoft.VSTS.Scheduling.TargetDate',
      value: '2026-09-30T00:00:00Z',
    })
  })

  it('emits Task-only activity/work patch ops on create', () => {
    const taskParams = {
      ...baseParams,
      workItemType: 'Task',
      title: 'Wire up retries',
      activity: 'Development',
      remainingWork: 4,
      completedWork: 1,
    } satisfies CreateWorkItemParams

    const body = buildBody(createWorkItemTool, taskParams)
    expect(body).toContainEqual({
      op: 'add',
      path: '/fields/Microsoft.VSTS.Common.Activity',
      value: 'Development',
    })
    expect(body).toContainEqual({
      op: 'add',
      path: '/fields/Microsoft.VSTS.Scheduling.RemainingWork',
      value: 4,
    })
    expect(body).toContainEqual({
      op: 'add',
      path: '/fields/Microsoft.VSTS.Scheduling.CompletedWork',
      value: 1,
    })
  })

  it('emits per-type replace ops on update when fields are provided', () => {
    const updateAll = {
      ...baseParams,
      workItemId: 101,
      startDate: '2026-06-01T00:00:00Z',
      activity: 'Testing',
      remainingWork: 2,
    } satisfies UpdateWorkItemParams

    const body = buildBody(updateWorkItemTool, updateAll)
    expect(body).toContainEqual({
      op: 'replace',
      path: '/fields/Microsoft.VSTS.Scheduling.StartDate',
      value: '2026-06-01T00:00:00Z',
    })
    expect(body).toContainEqual({
      op: 'replace',
      path: '/fields/Microsoft.VSTS.Common.Activity',
      value: 'Testing',
    })
    expect(body).toContainEqual({
      op: 'replace',
      path: '/fields/Microsoft.VSTS.Scheduling.RemainingWork',
      value: 2,
    })
  })

  it('builds comment URLs and bodies with comment API pinning', () => {
    const addParams = {
      ...baseParams,
      workItemId: 101,
      text: 'SimIntegrationTest markdown comment',
    } satisfies AddCommentParams

    expect(buildUrl(addCommentTool, addParams)).toBe(
      'https://dev.azure.com/contoso/Fabrikam/_apis/wit/workitems/101/comments?api-version=7.0-preview.3'
    )
    expect(buildBody(addCommentTool, addParams)).toEqual({
      text: 'SimIntegrationTest markdown comment',
    })

    expect(
      buildUrl(getCommentsTool, {
        ...baseParams,
        workItemId: 101,
        top: 2,
        continuationToken: 'next',
        includeDeleted: true,
        expand: 'renderedText',
        order: 'desc',
      } satisfies GetCommentsParams)
    ).toBe(
      'https://dev.azure.com/contoso/Fabrikam/_apis/wit/workitems/101/comments?api-version=7.2-preview.4&%24top=2&continuationToken=next&includeDeleted=true&%24expand=renderedText&order=desc'
    )
  })
})

describe('Azure DevOps response transforms', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('transforms list pipelines responses and empty results', async () => {
    await expect(
      listPipelinesTool.transformResponse!(responseJson({ count: 0, value: [] }))
    ).resolves.toEqual({
      success: true,
      output: { content: 'No pipelines found.', metadata: { count: 0, pipelines: [] } },
    })

    const result = await listPipelinesTool.transformResponse!(
      responseJson({
        value: [{ id: 1, name: 'CI', revision: 2, url: 'https://example/p/1' }],
      })
    )

    expect(result.output.metadata).toEqual({
      count: 1,
      pipelines: [{ id: 1, name: 'CI', folder: '\\', revision: 2, url: 'https://example/p/1' }],
    })
  })

  it('transforms pipeline detail and run responses with missing optional links', async () => {
    const pipeline = await getPipelineTool.transformResponse!(
      responseJson({
        id: 42,
        name: 'CI',
        revision: 3,
        url: 'https://example/p/42',
        configuration: { type: 'yaml', path: '/azure-pipelines.yml' },
      })
    )

    expect(pipeline.output.metadata.pipeline.links.web).toBe('')
    expect(pipeline.output.metadata.pipeline.configuration.repository).toBeUndefined()

    const runs = await listPipelineRunsTool.transformResponse!(responseJson({ value: [] }))
    expect(runs.output).toEqual({
      content: 'No pipeline runs found.',
      metadata: { count: 0, runs: [] },
    })

    const run = await getPipelineRunTool.transformResponse!(
      responseJson({
        id: 99,
        name: '20260515.1',
        state: 'completed',
        result: 'failed',
        createdDate: '2026-05-15T10:00:00Z',
        finishedDate: '2026-05-15T10:05:00Z',
        url: 'https://example/r/99',
        pipeline: { id: 42, name: 'CI', revision: 3, url: 'https://example/p/42' },
      })
    )

    expect(run.output.metadata.run.pipeline.folder).toBe('\\')
    expect(run.output.metadata.run.result).toBe('failed')
  })

  it('transforms build and log responses', async () => {
    const builds = await listBuildsTool.transformResponse!(
      responseJson({
        value: [
          {
            id: 201,
            buildNumber: '20260515.1',
            status: 'completed',
            result: 'failed',
            queueTime: '2026-05-15T10:00:00Z',
            sourceBranch: 'refs/heads/main',
            sourceVersion: 'abc123',
          },
        ],
      })
    )

    expect(builds.output.metadata.builds[0].definition).toEqual({ id: 0, name: '' })

    const logs = await listBuildLogsTool.transformResponse!(
      responseJson({
        count: 1,
        value: [
          {
            id: 3,
            type: 'Container',
            url: 'https://example/log/3',
            lineCount: 25,
            createdOn: '2026-05-15T10:00:00Z',
          },
        ],
      })
    )

    expect(logs.output.metadata.logs[0].lineCount).toBe(25)

    const log = await getBuildLogTool.transformResponse!(
      new Response('line one\nline two\nline three\n')
    )

    expect(log.output.metadata.lineCount).toBe(3)
    await expect(getBuildLogTool.transformResponse!(new Response('   '))).resolves.toEqual({
      success: true,
      output: { content: 'Log is empty.', metadata: { lineCount: 0 } },
    })
  })

  it('transforms work item references and hydrated work items', async () => {
    const betweenBuilds = await getWorkItemsBetweenBuildsTool.transformResponse!(
      responseJson({ value: [{ id: 101, url: 'https://example/workitems/101' }] })
    )

    expect(betweenBuilds.output.metadata.workItems).toEqual([
      { id: '101', url: 'https://example/workitems/101' },
    ])

    const getWorkItem = await getWorkItemTool.transformResponse!(responseJson(rawWorkItem))
    expect(getWorkItem.output.metadata.workItem).toEqual({
      id: 101,
      title: 'SimIntegrationTest Issue',
      state: 'Doing',
      workItemType: 'Issue',
      assignedTo: 'Ada Lovelace',
      areaPath: 'Fabrikam\\Platform',
      url: 'https://dev.azure.com/contoso/Fabrikam/_apis/wit/workItems/101',
    })

    const batch = await getWorkItemsBatchTool.transformResponse!(
      responseJson({ value: [rawWorkItem] }),
      { ...baseParams, ids: '101' } satisfies GetWorkItemsBatchParams
    )
    expect(batch.output.metadata.count).toBe(1)
    expect(batch.output.metadata.totalRequested).toBe(1)
  })

  it('hydrates WIQL query results in chunks of 200 IDs', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(responseJson({ value: [rawWorkItem] })))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const workItems = Array.from({ length: 201 }, (_, index) => ({
      id: index + 1,
      url: `https://example/workitems/${index + 1}`,
    }))

    const result = await queryWorkItemsTool.transformResponse!(responseJson({ workItems }), {
      ...baseParams,
      wiqlQuery: 'SELECT [System.Id] FROM workitems',
    } satisfies QueryWorkItemsParams)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstChunk = new URL(String(fetchMock.mock.calls[0][0]))
    const secondChunk = new URL(String(fetchMock.mock.calls[1][0]))
    expect(firstChunk.searchParams.get('ids')?.split(',')).toHaveLength(200)
    expect(secondChunk.searchParams.get('ids')?.split(',')).toHaveLength(1)
    expect(result.output.metadata.totalMatched).toBe(201)
    expect(result.output.metadata.workItems).toHaveLength(2)
  })

  it('throws when Get Work Items Batch is invoked with no valid IDs', () => {
    expect(() =>
      buildUrl(getWorkItemsBatchTool, {
        ...baseParams,
        ids: ' , , ',
      } satisfies GetWorkItemsBatchParams)
    ).toThrow(/requires at least one work item ID/)
  })

  it('chunks Get Work Items Batch requests larger than 200 IDs', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(responseJson({ value: [rawWorkItem] })))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const ids = Array.from({ length: 350 }, (_, i) => String(i + 1)).join(',')

    const result = await getWorkItemsBatchTool.transformResponse!(
      responseJson({ value: [rawWorkItem] }),
      { ...baseParams, ids } satisfies GetWorkItemsBatchParams
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const followupChunk = new URL(String(fetchMock.mock.calls[0][0]))
    expect(followupChunk.searchParams.get('ids')?.split(',')).toHaveLength(150)
    expect(result.output.metadata.totalRequested).toBe(350)
    expect(result.output.metadata.workItems).toHaveLength(2)
  })

  it('throws when WIQL hydration fetch returns a non-OK status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('forbidden', { status: 403, statusText: 'Forbidden' }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(
      queryWorkItemsTool.transformResponse!(responseJson({ workItems: [{ id: 1, url: 'x' }] }), {
        ...baseParams,
        wiqlQuery: 'SELECT [System.Id] FROM workitems',
      } satisfies QueryWorkItemsParams)
    ).rejects.toThrow(/Failed to hydrate work item details/)
  })

  it('does not hydrate WIQL empty results', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const result = await queryWorkItemsTool.transformResponse!(responseJson({ workItems: [] }), {
      ...baseParams,
      wiqlQuery: 'SELECT [System.Id] FROM workitems WHERE [System.Id] = 0',
    } satisfies QueryWorkItemsParams)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.output.metadata).toEqual({ count: 0, workItems: [] })
  })

  it('transforms create and update work item responses', async () => {
    const created = await createWorkItemTool.transformResponse!(responseJson(rawWorkItem))
    expect(created.output.content).toContain('Created work item #101')

    const updated = await updateWorkItemTool.transformResponse!(responseJson(rawWorkItem))
    expect(updated.output.content).toContain('Updated work item #101')
  })

  it('transforms comment responses and empty comment lists', async () => {
    const added = await addCommentTool.transformResponse!(responseJson(rawComment))
    expect(added.output.metadata.comment).toEqual({
      workItemId: 101,
      commentId: 9,
      version: 1,
      text: 'SimIntegrationTest comment',
      renderedText: '<p>SimIntegrationTest comment</p>',
      createdBy: 'Ada Lovelace',
      createdDate: '2026-05-15T10:00:00Z',
      modifiedBy: 'Ada Lovelace',
      modifiedDate: '2026-05-15T10:00:00Z',
      isDeleted: false,
      url: 'https://dev.azure.com/contoso/Fabrikam/_apis/wit/workitems/101/comments/9',
    })

    const comments = await getCommentsTool.transformResponse!(
      responseJson({
        count: 1,
        totalCount: 2,
        comments: [rawComment],
        continuationToken: 'next',
        nextPage: 'https://example/next',
      })
    )
    expect(comments.output.metadata.count).toBe(1)
    expect(comments.output.metadata.continuationToken).toBe('next')

    const empty = await getCommentsTool.transformResponse!(responseJson({ comments: [] }))
    expect(empty.output).toEqual({
      content: 'No comments found for this work item.',
      metadata: { count: 0, totalCount: 0, comments: [] },
    })
  })
})

describe('Azure DevOps trigger event matching', () => {
  const baseBuild = { eventType: 'build.complete' }
  const baseWorkItem = { eventType: 'workitem.created' }

  it('matches build.complete results case-insensitively including stopped/Failed/Canceled', () => {
    for (const result of [
      'failed',
      'Failed',
      'FAILED',
      'canceled',
      'Canceled',
      'cancelled',
      'Cancelled',
      'stopped',
      'Stopped',
      'partiallySucceeded',
      'PartiallySucceeded',
    ]) {
      expect(
        isAzureDevOpsEventMatch('azure_devops_build_failed', {
          ...baseBuild,
          resource: { result },
        })
      ).toBe(true)
    }
  })

  it('does not match successful build.complete payloads', () => {
    for (const result of ['succeeded', 'Succeeded', 'inProgress']) {
      expect(
        isAzureDevOpsEventMatch('azure_devops_build_failed', {
          ...baseBuild,
          resource: { result },
        })
      ).toBe(false)
    }
  })

  it('ignores non-build event types when expecting build.complete', () => {
    expect(
      isAzureDevOpsEventMatch('azure_devops_build_failed', {
        eventType: 'workitem.created',
        resource: { result: 'failed' },
      })
    ).toBe(false)
  })

  it('build timeline includes partiallySucceeded and succeededWithIssues in failedRecords', async () => {
    const records = [
      { id: 'a', name: 'Step A', type: 'Task', result: 'succeeded', log: { id: 1 } },
      { id: 'b', name: 'Step B', type: 'Task', result: 'failed', log: { id: 2 } },
      { id: 'c', name: 'Step C', type: 'Task', result: 'partiallySucceeded', log: { id: 3 } },
      { id: 'd', name: 'Step D', type: 'Task', result: 'succeededWithIssues', log: { id: 4 } },
      { id: 'e', name: 'Step E', type: 'Task', result: 'skipped', log: null },
    ]
    const result = await getBuildTimelineTool.transformResponse!(
      new Response(JSON.stringify({ records }))
    )
    const failedIds = result.output.metadata.failedRecords.map((r) => r.id)
    expect(failedIds).toEqual(['b', 'c', 'd'])
    expect(result.output.metadata.failedCount).toBe(3)
  })

  it('matches workitem.created and passes through generic webhook', () => {
    expect(isAzureDevOpsEventMatch('azure_devops_work_item_created', baseWorkItem)).toBe(true)
    expect(isAzureDevOpsEventMatch('azure_devops_work_item_created', baseBuild)).toBe(false)
    expect(isAzureDevOpsEventMatch('azure_devops_webhook', { eventType: 'anything' })).toBe(true)
  })

  it('extractIdempotencyId returns null when subscriptionId or notificationId is missing', async () => {
    const { azureDevOpsHandler } = await import('@/lib/webhooks/providers/azure-devops')
    expect(azureDevOpsHandler.extractIdempotencyId!({})).toBeNull()
    expect(azureDevOpsHandler.extractIdempotencyId!({ subscriptionId: 'sub-1' })).toBeNull()
    expect(azureDevOpsHandler.extractIdempotencyId!({ notificationId: 42 })).toBeNull()
    expect(
      azureDevOpsHandler.extractIdempotencyId!({ subscriptionId: 'sub-1', notificationId: 42 })
    ).toBe('azure_devops:sub-1:42')
    expect(azureDevOpsHandler.extractIdempotencyId!(null)).toBeNull()
  })
})
