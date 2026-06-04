import type {
  AzureDevOpsWorkItem,
  CreateWorkItemParams,
  CreateWorkItemResponse,
} from '@/tools/azure_devops/types'
import type { AzureDevOpsJsonPatchOp, AzureDevOpsRawWorkItem } from '@/tools/azure_devops/utils'
import {
  appendEffortPatchOp,
  appendFieldPatchOp,
  formatWorkItem,
  mapWorkItem,
} from '@/tools/azure_devops/utils'
import type { ToolConfig } from '@/tools/types'

export const createWorkItemTool: ToolConfig<CreateWorkItemParams, CreateWorkItemResponse> = {
  id: 'azure_devops_create_work_item',
  name: 'Azure DevOps Create Work Item',
  description:
    'Create a new Basic-process work item (Issue, Task, or Epic) in Azure DevOps. Returns the created work item with its assigned ID.',
  version: '1.0.0',

  params: {
    organization: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Azure DevOps organization name',
    },
    project: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Azure DevOps project name',
    },
    workItemType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Basic-process work item type to create ("Issue", "Task", or "Epic"). Use Issue for bug or defect tracking.',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Title of the new work item',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'HTML description of the work item (optional)',
    },
    assignedTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email or display name of the user to assign the work item to (optional)',
    },
    priority: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Priority of the work item (1 = Critical, 2 = High, 3 = Medium, 4 = Low)',
    },
    effort: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Effort (Microsoft.VSTS.Scheduling.Effort). Basic process: Issue only.',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start date (Microsoft.VSTS.Scheduling.StartDate), ISO 8601. Basic process: Epic only.',
    },
    targetDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Target date (Microsoft.VSTS.Scheduling.TargetDate), ISO 8601. Basic process: Epic only.',
    },
    activity: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Activity (Microsoft.VSTS.Common.Activity). One of Deployment, Design, Development, Documentation, Requirements, Testing. Basic process: Task only.',
    },
    remainingWork: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Remaining work hours (Microsoft.VSTS.Scheduling.RemainingWork). Basic process: Task only.',
    },
    completedWork: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Completed work hours (Microsoft.VSTS.Scheduling.CompletedWork). Basic process: Task only.',
    },
    areaPath: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Area path for the work item, e.g. "MyProject\\\\Team" (optional)',
    },
    iterationPath: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Iteration path for the work item, e.g. "MyProject\\\\Sprint 1" (optional)',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated tags, e.g. "issue; p1; auth" (optional)',
    },
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Azure DevOps Personal Access Token (scopes: Work Items: Read & Write)',
    },
  },

  request: {
    url: (params) =>
      `https://dev.azure.com/${params.organization.trim()}/${params.project.trim()}/_apis/wit/workitems/$${encodeURIComponent(params.workItemType)}?api-version=7.2-preview.3`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json-patch+json',
      Authorization: `Basic ${btoa(`:${params.accessToken}`)}`,
    }),
    body: (params) => {
      const ops: AzureDevOpsJsonPatchOp[] = [
        { op: 'add', path: '/fields/System.Title', value: params.title },
      ]
      if (params.description) {
        ops.push({ op: 'add', path: '/fields/System.Description', value: params.description })
      }
      if (params.assignedTo) {
        ops.push({ op: 'add', path: '/fields/System.AssignedTo', value: params.assignedTo })
      }
      if (params.priority !== undefined) {
        ops.push({
          op: 'add',
          path: '/fields/Microsoft.VSTS.Common.Priority',
          value: String(Number(params.priority)),
        })
      }
      appendEffortPatchOp(ops, params.effort, 'add')
      appendFieldPatchOp(
        ops,
        'Microsoft.VSTS.Scheduling.StartDate',
        params.startDate,
        'add',
        'string'
      )
      appendFieldPatchOp(
        ops,
        'Microsoft.VSTS.Scheduling.TargetDate',
        params.targetDate,
        'add',
        'string'
      )
      appendFieldPatchOp(ops, 'Microsoft.VSTS.Common.Activity', params.activity, 'add', 'string')
      appendFieldPatchOp(
        ops,
        'Microsoft.VSTS.Scheduling.RemainingWork',
        params.remainingWork,
        'add',
        'number'
      )
      appendFieldPatchOp(
        ops,
        'Microsoft.VSTS.Scheduling.CompletedWork',
        params.completedWork,
        'add',
        'number'
      )
      if (params.areaPath) {
        ops.push({ op: 'add', path: '/fields/System.AreaPath', value: params.areaPath })
      }
      if (params.iterationPath) {
        ops.push({ op: 'add', path: '/fields/System.IterationPath', value: params.iterationPath })
      }
      if (params.tags) {
        ops.push({ op: 'add', path: '/fields/System.Tags', value: params.tags })
      }
      return ops
    },
  },

  transformResponse: async (response) => {
    const raw: AzureDevOpsRawWorkItem = await response.json()
    const workItem: AzureDevOpsWorkItem = mapWorkItem(raw)
    return {
      success: true,
      output: {
        content: `Created work item #${workItem.id}:\n\n${formatWorkItem(workItem)}`,
        metadata: { workItem },
      },
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'Human-readable summary of the created work item',
    },
    metadata: {
      type: 'object',
      description: 'Created work item metadata',
      properties: {
        workItem: {
          type: 'object',
          description: 'Full details of the created work item',
          properties: {
            id: { type: 'number', description: 'Assigned work item ID' },
            title: { type: 'string', description: 'Work item title' },
            state: {
              type: 'string',
              description: 'Initial state for Basic process (e.g. To Do, Doing, Done)',
            },
            workItemType: {
              type: 'string',
              description: 'Work item type returned by Azure DevOps (e.g. Issue, Task, Epic)',
            },
            assignedTo: {
              type: 'string',
              description: 'Display name of assigned user, or null if unassigned',
            },
            areaPath: { type: 'string', description: 'Area path of the work item' },
            url: { type: 'string', description: 'API URL for the created work item' },
          },
        },
      },
    },
  },
}
