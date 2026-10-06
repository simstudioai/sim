import { toRecord } from '@sim/utils/object'
import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

export const planeTriggerOptions = [
  { label: 'All Events', id: 'plane_webhook' },
  { label: 'Project Created', id: 'plane_project_created' },
  { label: 'Project Updated', id: 'plane_project_updated' },
  { label: 'Project Archived', id: 'plane_project_archived' },
  { label: 'Project Deleted', id: 'plane_project_deleted' },
  { label: 'Cycle Created', id: 'plane_cycle_created' },
  { label: 'Cycle Updated', id: 'plane_cycle_updated' },
  { label: 'Cycle Archived', id: 'plane_cycle_archived' },
  { label: 'Cycle Deleted', id: 'plane_cycle_deleted' },
  { label: 'Module Created', id: 'plane_module_created' },
  { label: 'Module Updated', id: 'plane_module_updated' },
  { label: 'Module Archived', id: 'plane_module_archived' },
  { label: 'Module Deleted', id: 'plane_module_deleted' },
  { label: 'Milestone Created', id: 'plane_milestone_created' },
  { label: 'Milestone Updated', id: 'plane_milestone_updated' },
  { label: 'Milestone Deleted', id: 'plane_milestone_deleted' },
  { label: 'Page Created', id: 'plane_page_created' },
  { label: 'Page Updated', id: 'plane_page_updated' },
  { label: 'Page Archived', id: 'plane_page_archived' },
  { label: 'Page Deleted', id: 'plane_page_deleted' },
  { label: 'Page Comment Created', id: 'plane_page_comment_created' },
  { label: 'Page Comment Updated', id: 'plane_page_comment_updated' },
  { label: 'Page Comment Deleted', id: 'plane_page_comment_deleted' },
  { label: 'Work Item Created', id: 'plane_workitem_created' },
  { label: 'Work Item Updated', id: 'plane_workitem_updated' },
  { label: 'Work Item Archived', id: 'plane_workitem_archived' },
  { label: 'Work Item Deleted', id: 'plane_workitem_deleted' },
  { label: 'Work Item Comment Created', id: 'plane_workitem_comment_created' },
  { label: 'Work Item Comment Updated', id: 'plane_workitem_comment_updated' },
  { label: 'Work Item Comment Deleted', id: 'plane_workitem_comment_deleted' },
  { label: 'Work Item Link Created', id: 'plane_workitem_link_created' },
  { label: 'Work Item Link Updated', id: 'plane_workitem_link_updated' },
  { label: 'Work Item Link Deleted', id: 'plane_workitem_link_deleted' },
  { label: 'Work Item Vote Created', id: 'plane_workitem_vote_created' },
  { label: 'Work Item Vote Deleted', id: 'plane_workitem_vote_deleted' },
  { label: 'Work Item Attachment Created', id: 'plane_workitem_attachment_created' },
  { label: 'Work Item Attachment Updated', id: 'plane_workitem_attachment_updated' },
  { label: 'Work Item Attachment Deleted', id: 'plane_workitem_attachment_deleted' },
  { label: 'Work Item Relation Created', id: 'plane_workitem_relation_created' },
  { label: 'Work Item Relation Deleted', id: 'plane_workitem_relation_deleted' },
  { label: 'Work Item Dependency Created', id: 'plane_workitem_dependency_created' },
  { label: 'Work Item Dependency Deleted', id: 'plane_workitem_dependency_deleted' },
  { label: 'Work Item Page Link Created', id: 'plane_workitem_page_link_created' },
  { label: 'Work Item Page Link Deleted', id: 'plane_workitem_page_link_deleted' },
  { label: 'Cycle Membership (v1) Created', id: 'plane_cycle_issue_created' },
  { label: 'Cycle Membership (v1) Updated', id: 'plane_cycle_issue_updated' },
  { label: 'Cycle Membership (v1) Deleted', id: 'plane_cycle_issue_deleted' },
  { label: 'Module Membership (v1) Created', id: 'plane_module_issue_created' },
  { label: 'Module Membership (v1) Updated', id: 'plane_module_issue_updated' },
  { label: 'Module Membership (v1) Deleted', id: 'plane_module_issue_deleted' },
]

export const PLANE_TRIGGER_EVENTS: Record<string, string> = {
  plane_project_created: 'project.created',
  plane_project_updated: 'project.updated',
  plane_project_archived: 'project.archived',
  plane_project_deleted: 'project.deleted',
  plane_cycle_created: 'cycle.created',
  plane_cycle_updated: 'cycle.updated',
  plane_cycle_archived: 'cycle.archived',
  plane_cycle_deleted: 'cycle.deleted',
  plane_module_created: 'module.created',
  plane_module_updated: 'module.updated',
  plane_module_archived: 'module.archived',
  plane_module_deleted: 'module.deleted',
  plane_milestone_created: 'milestone.created',
  plane_milestone_updated: 'milestone.updated',
  plane_milestone_deleted: 'milestone.deleted',
  plane_page_created: 'page.created',
  plane_page_updated: 'page.updated',
  plane_page_archived: 'page.archived',
  plane_page_deleted: 'page.deleted',
  plane_page_comment_created: 'page.comment.created',
  plane_page_comment_updated: 'page.comment.updated',
  plane_page_comment_deleted: 'page.comment.deleted',
  plane_workitem_created: 'workitem.created',
  plane_workitem_updated: 'workitem.updated',
  plane_workitem_archived: 'workitem.archived',
  plane_workitem_deleted: 'workitem.deleted',
  plane_workitem_comment_created: 'workitem.comment.created',
  plane_workitem_comment_updated: 'workitem.comment.updated',
  plane_workitem_comment_deleted: 'workitem.comment.deleted',
  plane_workitem_link_created: 'workitem.link.created',
  plane_workitem_link_updated: 'workitem.link.updated',
  plane_workitem_link_deleted: 'workitem.link.deleted',
  plane_workitem_vote_created: 'workitem.vote.created',
  plane_workitem_vote_deleted: 'workitem.vote.deleted',
  plane_workitem_attachment_created: 'workitem.attachment.created',
  plane_workitem_attachment_updated: 'workitem.attachment.updated',
  plane_workitem_attachment_deleted: 'workitem.attachment.deleted',
  plane_workitem_relation_created: 'workitem.relation.created',
  plane_workitem_relation_deleted: 'workitem.relation.deleted',
  plane_workitem_dependency_created: 'workitem.dependency.created',
  plane_workitem_dependency_deleted: 'workitem.dependency.deleted',
  plane_workitem_page_link_created: 'workitem.page_link.created',
  plane_workitem_page_link_deleted: 'workitem.page_link.deleted',
  plane_cycle_issue_created: 'cycle_issue.created',
  plane_cycle_issue_updated: 'cycle_issue.updated',
  plane_cycle_issue_deleted: 'cycle_issue.deleted',
  plane_module_issue_created: 'module_issue.created',
  plane_module_issue_updated: 'module_issue.updated',
  plane_module_issue_deleted: 'module_issue.deleted',
}

/** Normalizes Community Edition v1 resource/actions to the v2 event vocabulary. */
export function planeEventName(body: unknown): string | null {
  const payload = toRecord(body)
  if (typeof payload.event !== 'string' || !payload.event) return null
  if (payload.version === 'v2') return payload.event
  const resources: Record<string, string> = { issue: 'workitem', issue_comment: 'workitem.comment' }
  const actions: Record<string, string> = {
    create: 'created',
    update: 'updated',
    delete: 'deleted',
  }
  if (typeof payload.action !== 'string' || !payload.action) return null
  return `${resources[payload.event] ?? payload.event}.${actions[payload.action] ?? payload.action}`
}

export function planeSetupInstructions(): string {
  return [
    'Manual setup works with Plane Cloud and self-hosted Community or Commercial editions. In Plane, open <strong>Workspace settings → Webhooks</strong> and add a webhook with the URL above.',
    'Select the event shown in this trigger. For v1, select the corresponding resource category. For All Events, select every category you want to receive.',
    'Copy Plane’s generated secret (from the downloaded CSV or webhook edit form) into <strong>Webhook Secret</strong> below, then save the Sim configuration. Keep this secret distinct from your API token.',
    'Automatic registration requires the Plane v2 webhook management API and an administrator token with webhook write permission. It creates and removes a dedicated v2 webhook when you save or remove the trigger.',
    'Project filters require project information. Self-hosted v1 deletion payloads that contain only a resource ID are skipped when a project filter is set.',
    'The Webhook URL must be publicly reachable from Plane. Plane v2 retries use the event ID for deduplication; v1 deliveries use a payload fingerprint.',
  ]
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

export function buildPlaneExtraFields(triggerId: string): SubBlockConfig[] {
  const condition = { field: 'selectedTriggerId', value: triggerId }
  const automaticCondition = { ...condition, and: { field: 'autoRegister', value: true } }
  return [
    {
      id: 'autoRegister',
      title: 'Automatic Registration',
      type: 'switch',
      defaultValue: false,
      mode: 'trigger',
      condition,
      description: 'Requires the Plane v2 webhook API. Use manual setup for Community Edition.',
    },
    {
      id: 'triggerApiKey',
      title: 'API Token',
      type: 'short-input',
      password: true,
      placeholder: 'Enter secret',
      paramVisibility: 'user-only',
      required: true,
      mode: 'trigger',
      condition: automaticCondition,
    },
    {
      id: 'triggerBaseUrl',
      title: 'Instance URL',
      type: 'short-input',
      placeholder: 'https://api.plane.so',
      paramVisibility: 'user-only',
      mode: 'trigger',
      condition: automaticCondition,
    },
    {
      id: 'triggerWorkspaceSlug',
      title: 'Workspace Slug',
      type: 'short-input',
      placeholder: 'my-team',
      required: true,
      mode: 'trigger',
      condition: automaticCondition,
    },
    {
      id: 'webhookSecret',
      title: 'Webhook Secret',
      type: 'short-input',
      password: true,
      placeholder: 'Enter secret',
      paramVisibility: 'user-only',
      required: true,
      mode: 'trigger',
      condition: { ...condition, and: { field: 'autoRegister', value: true, not: true } },
    },
    {
      id: 'projectId',
      title: 'Project ID',
      description:
        'Self-hosted v1 deletions without project information are skipped when this filter is set.',
      type: 'short-input',
      placeholder: 'All projects (optional)',
      mode: 'trigger',
      condition,
    },
    {
      id: 'workspaceId',
      title: 'Workspace ID',
      type: 'short-input',
      placeholder: 'Any workspace (optional)',
      mode: 'trigger',
      condition,
    },
  ]
}

export function buildPlaneOutputs(): Record<string, TriggerOutput> {
  return {
    version: { type: 'string', description: 'Payload version: v1 or v2.' },
    event: { type: 'string', description: 'Original Plane event or v1 resource name.' },
    eventName: { type: 'string', description: 'Normalized event name, such as workitem.updated.' },
    action: { type: 'string', description: 'v1 action; null for v2.' },
    event_id: { type: 'string', description: 'v2 event ID, stable across retries; null for v1.' },
    delivery_id: {
      type: 'string',
      description: 'Delivery attempt ID from the payload or X-Plane-Delivery header.',
    },
    entity_id: { type: 'string', description: 'v2 primary entity ID; null for v1.' },
    entity_type: { type: 'string', description: 'v2 entity type; null for v1.' },
    webhook_id: { type: 'string', description: 'Plane webhook configuration ID.' },
    workspace_id: { type: 'string', description: 'Plane workspace ID.' },
    workspace_slug: { type: 'string', description: 'v1 workspace slug; null for v2.' },
    data: {
      type: 'json',
      description:
        'Complete entity payload, including resource-specific fields. v2 deletions send an empty object.',
    },
    activity: {
      type: 'json',
      description: 'v1 changed field, old/new values, actor and identifiers; null for v2.',
    },
    previous_attributes: {
      type: 'json',
      description: 'v2 previous changed values or full deleted record; null for v1.',
    },
  }
}
