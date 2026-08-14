import type { NetSuiteGetAsyncStatusParams, NetSuiteResponse } from '@/tools/netsuite/types'
import {
  encodePathSegment,
  executeNetSuiteRequest,
  netsuiteAuthParamFields,
  requiredTrim,
} from '@/tools/netsuite/utils'
import type { ToolConfig } from '@/tools/types'

export const netsuiteGetAsyncStatusTool: ToolConfig<
  NetSuiteGetAsyncStatusParams,
  NetSuiteResponse
> = {
  id: 'netsuite_get_async_status',
  name: 'NetSuite Get Async Status',
  description: 'Retrieve job status, list job tasks, or retrieve one task status.',
  version: '1.0.0',
  params: {
    ...netsuiteAuthParamFields,
    jobId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Asynchronous job ID',
    },
    view: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      default: 'job',
      description: 'Retrieve job status, list tasks for the job, or retrieve one task status',
    },
    taskId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Task ID; required when view is task',
    },
  },
  request: { url: () => '', method: 'POST', headers: () => ({}) },
  directExecution: (params, signal) =>
    executeNetSuiteRequest(
      params,
      () => {
        const view = params.view ?? 'job'
        if (view !== 'job' && view !== 'tasks' && view !== 'task') {
          throw new Error('Async status view must be job, tasks, or task')
        }
        const jobPath = `/services/rest/async/v1/job/${encodePathSegment(params.jobId, 'Job ID')}`
        if (view === 'job') {
          return {
            method: 'GET',
            path: jobPath,
            success: { status: 200, body: 'object', validator: 'async-job' },
          }
        }
        const taskPath =
          view === 'task'
            ? `/${encodePathSegment(requiredTrim(params.taskId ?? '', 'Task ID'), 'Task ID')}`
            : ''
        return {
          method: 'GET',
          path: `${jobPath}/task${taskPath}`,
          success: {
            status: 200,
            body: 'object',
            validator: view === 'task' ? 'async-task' : 'async-task-collection',
          },
        }
      },
      signal
    ),
  outputs: {
    status: { type: 'number', description: 'HTTP status returned by NetSuite' },
    data: {
      type: 'json',
      description: 'Documented NetSuite asynchronous job, task collection, or task status',
      nullable: true,
      properties: {
        completed: {
          type: 'boolean',
          description: 'Whether processing has completed',
          optional: true,
        },
        endTime: { type: 'string', description: 'Task completion time', optional: true },
        id: { type: 'string', description: 'Asynchronous job or task ID', optional: true },
        progress: { type: 'string', description: 'Current task progress state', optional: true },
        startTime: { type: 'string', description: 'Task start time', optional: true },
        count: {
          type: 'number',
          description: 'Number of task collection entries returned',
          optional: true,
        },
        items: {
          type: 'array',
          description: 'Collection entries containing links to one or more asynchronous tasks',
          optional: true,
          items: {
            type: 'json',
            properties: {
              links: {
                type: 'array',
                description: 'Links to individual tasks',
                optional: true,
                items: {
                  type: 'object',
                  properties: {
                    rel: { type: 'string', description: 'Link relationship', optional: true },
                    href: { type: 'string', description: 'Link target', optional: true },
                  },
                },
              },
            },
          },
        },
        links: {
          type: 'array',
          description: 'HATEOAS links for the job or task collection',
          optional: true,
          items: {
            type: 'object',
            properties: {
              rel: { type: 'string', description: 'Link relationship', optional: true },
              href: { type: 'string', description: 'Link target', optional: true },
            },
          },
        },
        task: {
          type: 'object',
          description: 'Link container for the tasks belonging to this asynchronous job',
          optional: true,
          properties: {
            links: {
              type: 'array',
              description: 'Links to the job task collection',
              optional: true,
              items: {
                type: 'object',
                properties: {
                  rel: { type: 'string', description: 'Link relationship', optional: true },
                  href: { type: 'string', description: 'Link target', optional: true },
                },
              },
            },
          },
        },
      },
    },
  },
}
