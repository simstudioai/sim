import type { NetSuiteGetAsyncStatusParams, NetSuiteResponse } from '@/tools/netsuite/types'
import { netsuiteAuthParamFields } from '@/tools/netsuite/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const netsuiteGetAsyncStatusTool: InternalToolConfig<
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
  operation: {
    input: createInternalToolOperationInput,
  },
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
