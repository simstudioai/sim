import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Shared trigger dropdown options for all GitLab triggers
 */
export const gitlabTriggerOptions = [
  { label: 'Push', id: 'gitlab_push' },
  { label: 'Merge Request', id: 'gitlab_merge_request' },
  { label: 'Issue', id: 'gitlab_issue' },
  { label: 'Pipeline', id: 'gitlab_pipeline' },
  { label: 'Comment', id: 'gitlab_comment' },
  { label: 'All Events', id: 'gitlab_webhook' },
]

/**
 * Maps each GitLab trigger to the payload `object_kind` it listens for.
 * `gitlab_webhook` is intentionally absent — it matches every event.
 */
const TRIGGER_OBJECT_KINDS: Record<string, string> = {
  gitlab_push: 'push',
  gitlab_merge_request: 'merge_request',
  gitlab_issue: 'issue',
  gitlab_pipeline: 'pipeline',
  gitlab_comment: 'note',
}

/**
 * Boolean event flags sent to the GitLab project-hooks API, keyed by trigger.
 * `gitlab_webhook` subscribes to every supported event.
 */
const ALL_EVENT_FLAGS = {
  push_events: true,
  merge_requests_events: true,
  issues_events: true,
  pipeline_events: true,
  note_events: true,
  tag_push_events: true,
} as const

/**
 * Tag pushes (object_kind 'tag_push') only flow through the all-events
 * trigger; there is no dedicated single-event trigger for them. A future
 * "GitLab Tag Push" trigger would need its own object_kind mapping in
 * TRIGGER_OBJECT_KINDS above.
 */
const TRIGGER_EVENT_FLAGS: Record<string, Record<string, boolean>> = {
  gitlab_push: { push_events: true },
  gitlab_merge_request: { merge_requests_events: true },
  gitlab_issue: { issues_events: true },
  gitlab_pipeline: { pipeline_events: true },
  gitlab_comment: { note_events: true },
}

/**
 * Returns the GitLab hook event flags to enable for a given trigger.
 */
export function getGitLabEventFlags(triggerId: string): Record<string, boolean> {
  return TRIGGER_EVENT_FLAGS[triggerId] ?? { ...ALL_EVENT_FLAGS }
}

/**
 * Generate setup instructions for a specific GitLab webhook event. The webhook
 * is created automatically on deploy, so the user only supplies credentials.
 */
export function gitlabSetupInstructions(eventLabel: string): string {
  const instructions = [
    'Create a <strong>Personal Access Token</strong> with the <strong>api</strong> scope under <strong>GitLab &gt; Settings &gt; Access Tokens</strong>.',
    'Enter the token and your <strong>Project ID</strong> (numeric ID or <code>group/project</code> path) above.',
    `Deploy the workflow — Sim creates the webhook in GitLab automatically and starts listening for <strong>${eventLabel}</strong> events.`,
    'Undeploying the workflow removes the webhook from GitLab.',
  ]
  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Credentials Sim uses to create and delete the GitLab project webhook.
 */
export function buildGitLabExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'accessToken',
      title: 'Personal Access Token',
      type: 'short-input',
      placeholder: 'GitLab PAT with the api scope',
      description:
        'Used to create the webhook in your project. Requires the Maintainer or Owner role.',
      password: true,
      paramVisibility: 'user-only',
      required: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Numeric ID or group/project path',
      description: 'The GitLab project to register the webhook on.',
      required: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'host',
      title: 'GitLab Host',
      type: 'short-input',
      placeholder: 'gitlab.com',
      description: 'Self-managed GitLab host. Leave blank for gitlab.com.',
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

const projectOutputs = {
  id: { type: 'number', description: 'Project ID' },
  name: { type: 'string', description: 'Project name' },
  web_url: { type: 'string', description: 'Project web URL' },
  path_with_namespace: { type: 'string', description: 'Full path (namespace/project)' },
} as const

const actorUserOutputs = {
  id: { type: 'number', description: 'User ID' },
  name: { type: 'string', description: 'User display name' },
  username: { type: 'string', description: 'Username' },
} as const

export function buildGitLabPushOutputs(): Record<string, TriggerOutput> {
  return {
    object_kind: { type: 'string', description: 'Event kind (push)' },
    event_type: { type: 'string', description: 'GitLab event type from the X-Gitlab-Event header' },
    ref: { type: 'string', description: 'Git ref that was pushed (e.g. refs/heads/main)' },
    branch: { type: 'string', description: 'Branch name derived from ref' },
    before: { type: 'string', description: 'SHA before the push' },
    after: { type: 'string', description: 'SHA after the push' },
    checkout_sha: { type: 'string', description: 'SHA of the most recent commit' },
    user_username: { type: 'string', description: 'Username of the pusher' },
    user_name: { type: 'string', description: 'Display name of the pusher' },
    user_email: { type: 'string', description: 'Email of the pusher' },
    total_commits_count: { type: 'number', description: 'Number of commits in the push' },
    project: projectOutputs,
    commits: { type: 'json', description: 'Array of commit objects included in this push' },
  }
}

export function buildGitLabMergeRequestOutputs(): Record<string, TriggerOutput> {
  return {
    object_kind: { type: 'string', description: 'Event kind (merge_request)' },
    event_type: { type: 'string', description: 'GitLab event type from the X-Gitlab-Event header' },
    user: actorUserOutputs,
    project: projectOutputs,
    object_attributes: {
      id: { type: 'number', description: 'Global merge request ID' },
      iid: { type: 'number', description: 'Project-scoped merge request number' },
      title: { type: 'string', description: 'Merge request title' },
      state: { type: 'string', description: 'State (opened, closed, merged, locked)' },
      action: { type: 'string', description: 'Action (open, close, reopen, update, merge, etc.)' },
      source_branch: { type: 'string', description: 'Source branch' },
      target_branch: { type: 'string', description: 'Target branch' },
      merge_status: { type: 'string', description: 'Merge status (deprecated by GitLab)' },
      detailed_merge_status: { type: 'string', description: 'Detailed merge status' },
      draft: { type: 'boolean', description: 'Whether the merge request is a draft' },
      url: { type: 'string', description: 'Merge request URL' },
    },
  }
}

export function buildGitLabIssueOutputs(): Record<string, TriggerOutput> {
  return {
    object_kind: { type: 'string', description: 'Event kind (issue)' },
    event_type: { type: 'string', description: 'GitLab event type from the X-Gitlab-Event header' },
    user: actorUserOutputs,
    project: projectOutputs,
    object_attributes: {
      id: { type: 'number', description: 'Global issue ID' },
      iid: { type: 'number', description: 'Project-scoped issue number' },
      title: { type: 'string', description: 'Issue title' },
      state: { type: 'string', description: 'State (opened, closed)' },
      action: { type: 'string', description: 'Action (open, close, reopen, update)' },
      description: { type: 'string', description: 'Issue description' },
      confidential: { type: 'boolean', description: 'Whether the issue is confidential' },
      url: { type: 'string', description: 'Issue URL' },
      work_item_type: {
        type: 'string',
        description: 'Work item type (e.g. Issue, Incident, Task); GitLab 17.2+ only',
      },
    },
  }
}

export function buildGitLabPipelineOutputs(): Record<string, TriggerOutput> {
  return {
    object_kind: { type: 'string', description: 'Event kind (pipeline)' },
    event_type: { type: 'string', description: 'GitLab event type from the X-Gitlab-Event header' },
    user: actorUserOutputs,
    project: projectOutputs,
    object_attributes: {
      id: { type: 'number', description: 'Pipeline ID' },
      status: { type: 'string', description: 'Pipeline status (success, failed, running, etc.)' },
      detailed_status: { type: 'string', description: 'Detailed pipeline status' },
      ref: { type: 'string', description: 'Ref the pipeline ran on' },
      sha: { type: 'string', description: 'Commit SHA' },
      source: { type: 'string', description: 'Pipeline source (push, web, schedule, etc.)' },
      duration: { type: 'number', description: 'Pipeline duration in seconds' },
      url: { type: 'string', description: 'Pipeline URL' },
    },
  }
}

export function buildGitLabCommentOutputs(): Record<string, TriggerOutput> {
  return {
    object_kind: { type: 'string', description: 'Event kind (note)' },
    event_type: { type: 'string', description: 'GitLab event type from the X-Gitlab-Event header' },
    user: actorUserOutputs,
    project: projectOutputs,
    object_attributes: {
      id: { type: 'number', description: 'Comment ID' },
      note: { type: 'string', description: 'Comment body' },
      noteable_type: {
        type: 'string',
        description: 'What the comment is on (Commit, MergeRequest, Issue, Snippet)',
      },
      action: { type: 'string', description: 'Action (create, update)' },
      url: { type: 'string', description: 'Comment URL' },
    },
  }
}

export function buildGitLabWebhookOutputs(): Record<string, TriggerOutput> {
  return {
    object_kind: { type: 'string', description: 'Event kind (push, merge_request, issue, etc.)' },
    event_type: { type: 'string', description: 'GitLab event type from the X-Gitlab-Event header' },
    user: { type: 'json', description: 'Actor that triggered the event (when present)' },
    project: projectOutputs,
    object_attributes: {
      type: 'json',
      description: 'Event-specific attributes (varies by object_kind)',
    },
  }
}

/**
 * Returns true when an incoming webhook's object_kind matches the configured trigger.
 */
export function isGitLabEventMatch(triggerId: string, objectKind: string): boolean {
  const expected = TRIGGER_OBJECT_KINDS[triggerId]
  if (!expected) {
    return true
  }
  return expected === objectKind
}
