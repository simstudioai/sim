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
 * Generate setup instructions for a specific GitLab webhook event.
 *
 * @param triggerLabel - Friendly event name shown to the user.
 * @param checkboxLabel - The exact checkbox label in the GitLab "Trigger" section.
 */
export function gitlabSetupInstructions(triggerLabel: string, checkboxLabel: string): string {
  const instructions = [
    'In GitLab, go to your <strong>Project &gt; Settings &gt; Webhooks</strong> and click <strong>Add new webhook</strong>.',
    'Paste the <strong>Webhook URL</strong> above into the <strong>URL</strong> field.',
    'Enter the same <strong>Secret token</strong> you set above so deliveries can be verified.',
    `Under <strong>Trigger</strong>, enable <strong>${checkboxLabel}</strong>.`,
    'Click <strong>Add webhook</strong> to save.',
  ]
  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Secret token field used to verify the X-Gitlab-Token header.
 */
export function buildGitLabExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'webhookSecret',
      title: 'Secret Token',
      type: 'short-input',
      placeholder: 'Generate or enter a strong secret token',
      description: 'Validates that webhook deliveries originate from GitLab (X-Gitlab-Token).',
      password: true,
      required: false,
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
      merge_status: { type: 'string', description: 'Merge status' },
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
