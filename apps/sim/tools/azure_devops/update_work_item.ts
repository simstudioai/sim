import type {
  AzureDevOpsWorkItem,
  UpdateWorkItemParams,
  UpdateWorkItemResponse,
} from '@/tools/azure_devops/types'
import type { AzureDevOpsJsonPatchOp, AzureDevOpsRawWorkItem } from '@/tools/azure_devops/utils'
import {
  appendEffortPatchOp,
  appendFieldPatchOp,
  formatWorkItem,
  mapWorkItem,
} from '@/tools/azure_devops/utils'
import type { ToolConfig } from '@/tools/types'

export const updateWorkItemTool: ToolConfig<UpdateWorkItemParams, UpdateWorkItemResponse> = {
  id: 'azure_devops_update_work_item',
  name: 'Azure DevOps Update Work Item',
  description:
    'Update one or more fields on an existing work item in Azure DevOps. Provide only the fields you want to change.',
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
    workItemId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the work item to update',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New title for the work item (optional)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New HTML description for the work item (optional)',
    },
    assignedTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email or display name to reassign the work item to (optional)',
    },
    areaPath: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New area path for the work item (optional)',
    },
    priority: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Priority of the work item (1 = Critical, 2 = High, 3 = Medium, 4 = Low) (optional)',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New state for Basic-process work items: "To Do", "Doing", or "Done" (optional)',
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
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated tags to set on the work item (optional)',
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
      `https://dev.azure.com/${params.organization.trim()}/${params.project.trim()}/_apis/wit/workitems/${Number(params.workItemId)}?api-version=7.2-preview.3`,
    method: 'PATCH',
    headers: (params) => ({
      'Content-Type': 'application/json-patch+json',
      Authorization: `Basic ${btoa(`:${params.accessToken}`)}`,
    }),
    body: (params) => {
      const ops: AzureDevOpsJsonPatchOp[] = []
      if (
        !params.title &&
        !params.description &&
        !params.assignedTo &&
        !params.areaPath &&
        params.priority === undefined &&
        !params.state &&
        params.effort === undefined &&
        !params.startDate &&
        !params.targetDate &&
        !params.activity &&
        params.remainingWork === undefined &&
        params.completedWork === undefined &&
        !params.tags
      ) {
        throw new Error('Update Work Item requires at least one field to update.')
      }
      if (params.title) {
        ops.push({ op: 'replace', path: '/fields/System.Title', value: params.title })
      }
      if (params.description) {
        ops.push({ op: 'replace', path: '/fields/System.Description', value: params.description })
      }
      if (params.assignedTo) {
        ops.push({ op: 'replace', path: '/fields/System.AssignedTo', value: params.assignedTo })
      }
      if (params.areaPath) {
        ops.push({ op: 'replace', path: '/fields/System.AreaPath', value: params.areaPath })
      }
      if (params.priority !== undefined) {
        ops.push({
          op: 'replace',
          path: '/fields/Microsoft.VSTS.Common.Priority',
          value: String(Number(params.priority)),
        })
      }
      if (params.state) {
        ops.push({ op: 'replace', path: '/fields/System.State', value: params.state })
      }
      appendEffortPatchOp(ops, params.effort, 'replace')
      appendFieldPatchOp(
        ops,
        'Microsoft.VSTS.Scheduling.StartDate',
        params.startDate,
        'replace',
        'string'
      )
      appendFieldPatchOp(
        ops,
        'Microsoft.VSTS.Scheduling.TargetDate',
        params.targetDate,
        'replace',
        'string'
      )
      appendFieldPatchOp(
        ops,
        'Microsoft.VSTS.Common.Activity',
        params.activity,
        'replace',
        'string'
      )
      appendFieldPatchOp(
        ops,
        'Microsoft.VSTS.Scheduling.RemainingWork',
        params.remainingWork,
        'replace',
        'number'
      )
      appendFieldPatchOp(
        ops,
        'Microsoft.VSTS.Scheduling.CompletedWork',
        params.completedWork,
        'replace',
        'number'
      )
      if (params.tags) {
        ops.push({ op: 'replace', path: '/fields/System.Tags', value: params.tags })
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
        content: `Updated work item #${workItem.id}:\n\n${formatWorkItem(workItem)}`,
        metadata: { workItem },
      },
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'Human-readable summary of the updated work item',
    },
    metadata: {
      type: 'object',
      description: 'Updated work item metadata',
      properties: {
        workItem: {
          type: 'object',
          description: 'Full details of the updated work item',
          properties: {
            id: { type: 'number', description: 'Work item ID' },
            title: { type: 'string', description: 'Work item title' },
            state: { type: 'string', description: 'Current state after update' },
            workItemType: {
              type: 'string',
              description: 'Work item type returned by Azure DevOps (e.g. Issue, Task, Epic)',
            },
            assignedTo: {
              type: 'string',
              description: 'Display name of assigned user, or null if unassigned',
            },
            areaPath: { type: 'string', description: 'Area path of the work item' },
            url: { type: 'string', description: 'API URL for the work item' },
          },
        },
      },
    },
  },
}
