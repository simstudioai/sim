import type { TriggerOutput } from '@/triggers/types'

export const azureDevOpsTriggerOptions = [
  { label: 'Build Failed', id: 'azure_devops_build_failed' },
  { label: 'Work Item Created', id: 'azure_devops_work_item_created' },
  { label: 'All Service Hook Events', id: 'azure_devops_webhook' },
]

export const AZURE_DEVOPS_BUILD_FAILED_EVENT = 'build.complete'
export const AZURE_DEVOPS_WORK_ITEM_CREATED_EVENT = 'workitem.created'

function instructions(steps: string[]): string {
  return steps.map((s, i) => `<div class="mb-3"><strong>${i + 1}.</strong> ${s}</div>`).join('')
}

export const buildFailedSetupInstructions = instructions([
  'Open your Azure DevOps project and go to <strong>Project settings → Service hooks</strong>.',
  'Click <strong>+ Create subscription</strong>, choose <strong>Web Hooks</strong>, then <strong>Next</strong>.',
  'For <strong>Trigger on this type of event</strong>, select <strong>Build completed</strong>.',
  'Under <strong>Filters</strong>, set <strong>Build result</strong> to <strong>Failed</strong> (optionally add Canceled / Partially succeeded).',
  'Click <strong>Next</strong>, paste the <strong>Webhook URL</strong> above into the <strong>URL</strong> field.',
  'Leave other fields as defaults. Click <strong>Test</strong> to verify, then <strong>Finish</strong>.',
])

export const workItemCreatedSetupInstructions = instructions([
  'Open your Azure DevOps project and go to <strong>Project settings → Service hooks</strong>.',
  'Click <strong>+ Create subscription</strong>, choose <strong>Web Hooks</strong>, then <strong>Next</strong>.',
  'For <strong>Trigger on this type of event</strong>, select <strong>Work item created</strong>.',
  'Click <strong>Next</strong>, paste the <strong>Webhook URL</strong> above into the <strong>URL</strong> field.',
  'Leave other fields as defaults. Click <strong>Test</strong> to verify, then <strong>Finish</strong>.',
])

export const webhookSetupInstructions = instructions([
  'Open your Azure DevOps project and go to <strong>Project settings → Service hooks</strong>.',
  'Click <strong>+ Create subscription</strong>, choose <strong>Web Hooks</strong>, then <strong>Next</strong>.',
  'Select whichever <strong>event types</strong> you want this URL to receive (build, work item, release, etc.).',
  'Click <strong>Next</strong>, paste the <strong>Webhook URL</strong> above into the <strong>URL</strong> field.',
  'Leave other fields as defaults. Click <strong>Test</strong> to verify, then <strong>Finish</strong>.',
  'Sim does not filter deliveries for this trigger — configure event types in Azure DevOps.',
])

/**
 * Returns whether an Azure DevOps service hook payload matches the configured trigger.
 */
export function isAzureDevOpsEventMatch(triggerId: string, body: Record<string, unknown>): boolean {
  if (triggerId === 'azure_devops_webhook') {
    return true
  }

  const eventType = body.eventType as string | undefined

  if (triggerId === 'azure_devops_build_failed') {
    if (eventType !== AZURE_DEVOPS_BUILD_FAILED_EVENT) {
      return false
    }
    const resource = body.resource as Record<string, unknown> | undefined
    const result = (resource?.result as string | undefined)?.toLowerCase()
    return (
      result === 'failed' ||
      result === 'canceled' ||
      result === 'cancelled' ||
      result === 'stopped' ||
      result === 'partiallysucceeded'
    )
  }

  if (triggerId === 'azure_devops_work_item_created') {
    return eventType === AZURE_DEVOPS_WORK_ITEM_CREATED_EVENT
  }

  return false
}

export function buildBuildFailedOutputs(): Record<string, TriggerOutput> {
  return {
    buildId: {
      type: 'number',
      description: 'Build ID',
    },
    buildNumber: {
      type: 'string',
      description: 'Build number string (e.g. 20240101.1)',
    },
    result: {
      type: 'string',
      description: 'Build result: failed | canceled | partiallySucceeded',
    },
    pipelineId: {
      type: 'number',
      description: 'Pipeline definition ID',
    },
    pipelineName: {
      type: 'string',
      description: 'Pipeline definition name',
    },
    projectName: {
      type: 'string',
      description: 'Azure DevOps project name',
    },
    branch: {
      type: 'string',
      description: 'Source branch name (refs/heads/ prefix stripped)',
    },
    commitSha: {
      type: 'string',
      description: 'Source commit SHA',
    },
    triggeredBy: {
      type: 'string',
      description: 'Display name of the person who triggered the build',
    },
    triggeredByEmail: {
      type: 'string',
      description: 'Email/unique name of the person who triggered the build, or null if not set',
    },
    startTime: {
      type: 'string',
      description: 'Build start time (ISO 8601)',
    },
    finishTime: {
      type: 'string',
      description: 'Build finish time (ISO 8601)',
    },
    buildUrl: {
      type: 'string',
      description: 'API URL for the build resource',
    },
  }
}

export function buildWorkItemCreatedOutputs(): Record<string, TriggerOutput> {
  return {
    workItemId: {
      type: 'number',
      description: 'Work item ID',
    },
    workItemType: {
      type: 'string',
      description: 'Work item type for Basic process (e.g. Issue, Task, Epic)',
    },
    title: {
      type: 'string',
      description: 'Work item title',
    },
    state: {
      type: 'string',
      description: 'Work item state for Basic process (e.g. To Do, Doing, Done)',
    },
    createdBy: {
      type: 'string',
      description: 'Display name of the creator, or null if not set',
    },
    assignedTo: {
      type: 'string',
      description: 'Assignee display name, or null if unassigned',
    },
    priority: {
      type: 'number',
      description: 'Priority (1–4), or 0 if not set',
    },
    areaPath: {
      type: 'string',
      description: 'Area path',
    },
    iterationPath: {
      type: 'string',
      description: 'Iteration path',
    },
    description: {
      type: 'string',
      description: 'Work item description (HTML), or null if not set',
    },
    projectName: {
      type: 'string',
      description: 'Azure DevOps project name',
    },
    workItemUrl: {
      type: 'string',
      description: 'API URL for the work item resource',
    },
  }
}

export function buildWebhookOutputs(): Record<string, TriggerOutput> {
  return {
    eventType: {
      type: 'string',
      description: 'Service hook event type (e.g. build.complete, workitem.created)',
    },
    notificationId: {
      type: 'number',
      description: 'Notification ID',
    },
    subscriptionId: {
      type: 'string',
      description: 'Service hook subscription ID',
    },
    publisherId: {
      type: 'string',
      description: 'Publisher ID (e.g. tfs)',
    },
    createdDate: {
      type: 'string',
      description: 'Event creation time (ISO 8601)',
    },
    resource: {
      type: 'json',
      description: 'Event resource payload',
    },
    resourceContainers: {
      type: 'json',
      description: 'Resource container references (project, collection, etc.)',
    },
    message: {
      type: 'json',
      description: 'Short message object',
    },
    detailedMessage: {
      type: 'json',
      description: 'Detailed message object',
    },
  }
}

export function formatBuildCompleteInput(body: Record<string, unknown>): Record<string, unknown> {
  const resource = (body.resource ?? {}) as Record<string, unknown>
  const definition = (resource.definition ?? {}) as Record<string, unknown>
  const project = (resource.project ?? {}) as Record<string, unknown>
  const requestedFor = (resource.requestedFor ?? {}) as Record<string, unknown>
  const sourceBranch = (resource.sourceBranch as string) ?? ''

  return {
    buildId: Number(resource.id ?? 0),
    buildNumber: (resource.buildNumber as string) ?? '',
    result: (resource.result as string) ?? '',
    pipelineId: Number(definition.id ?? 0),
    pipelineName: (definition.name as string) ?? '',
    projectName: (project.name as string) ?? '',
    branch: sourceBranch.replace(/^refs\/heads\//, ''),
    commitSha: (resource.sourceVersion as string) ?? '',
    triggeredBy: (requestedFor.displayName as string) ?? null,
    triggeredByEmail: (requestedFor.uniqueName as string) ?? null,
    startTime: (resource.startTime as string) ?? '',
    finishTime: (resource.finishTime as string) ?? '',
    buildUrl: (resource.url as string) ?? '',
  }
}

export function formatWorkItemCreatedInput(body: Record<string, unknown>): Record<string, unknown> {
  const resource = (body.resource ?? {}) as Record<string, unknown>
  const fields = (resource.fields ?? {}) as Record<string, unknown>

  return {
    workItemId: Number(resource.id ?? 0),
    workItemType: (fields['System.WorkItemType'] as string) ?? '',
    title: (fields['System.Title'] as string) ?? '',
    state: (fields['System.State'] as string) ?? '',
    createdBy:
      (fields['System.CreatedBy'] as { displayName?: string } | undefined)?.displayName ?? null,
    assignedTo:
      (fields['System.AssignedTo'] as { displayName?: string } | undefined)?.displayName ?? null,
    priority: Number(fields['Microsoft.VSTS.Common.Priority'] ?? 0),
    areaPath: (fields['System.AreaPath'] as string) ?? '',
    iterationPath: (fields['System.IterationPath'] as string) ?? '',
    description: (fields['System.Description'] as string) ?? null,
    projectName: (fields['System.TeamProject'] as string) ?? '',
    workItemUrl: (resource.url as string) ?? '',
  }
}

export function formatWebhookEnvelopeInput(body: Record<string, unknown>): Record<string, unknown> {
  return {
    eventType: (body.eventType as string) ?? '',
    notificationId: Number(body.notificationId ?? 0),
    subscriptionId: (body.subscriptionId as string) ?? '',
    publisherId: (body.publisherId as string) ?? '',
    createdDate: (body.createdDate as string) ?? '',
    resource: body.resource ?? null,
    resourceContainers: body.resourceContainers ?? null,
    message: body.message ?? null,
    detailedMessage: body.detailedMessage ?? null,
  }
}
