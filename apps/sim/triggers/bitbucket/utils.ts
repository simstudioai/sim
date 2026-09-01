import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

export const bitbucketTriggerOptions = [
  { label: 'Push', id: 'bitbucket_push' },
  { label: 'Repository Forked', id: 'bitbucket_repository_forked' },
  { label: 'Repository Updated', id: 'bitbucket_repository_updated' },
  { label: 'Commit Comment Created', id: 'bitbucket_commit_comment_created' },
  { label: 'Build Status Created', id: 'bitbucket_build_status_created' },
  { label: 'Build Status Updated', id: 'bitbucket_build_status_updated' },
  { label: 'Pull Request Created', id: 'bitbucket_pull_request_created' },
  { label: 'Pull Request Updated', id: 'bitbucket_pull_request_updated' },
  { label: 'Pull Request Approved', id: 'bitbucket_pull_request_approved' },
  {
    label: 'Pull Request Approval Removed',
    id: 'bitbucket_pull_request_approval_removed',
  },
  {
    label: 'Pull Request Changes Requested',
    id: 'bitbucket_pull_request_changes_requested',
  },
  {
    label: 'Pull Request Changes Request Removed',
    id: 'bitbucket_pull_request_changes_request_removed',
  },
  { label: 'Pull Request Merged', id: 'bitbucket_pull_request_merged' },
  { label: 'Pull Request Declined', id: 'bitbucket_pull_request_declined' },
  {
    label: 'Pull Request Comment Created',
    id: 'bitbucket_pull_request_comment_created',
  },
  {
    label: 'Pull Request Comment Updated',
    id: 'bitbucket_pull_request_comment_updated',
  },
  {
    label: 'Pull Request Comment Deleted',
    id: 'bitbucket_pull_request_comment_deleted',
  },
  {
    label: 'Pull Request Comment Resolved',
    id: 'bitbucket_pull_request_comment_resolved',
  },
  {
    label: 'Pull Request Comment Reopened',
    id: 'bitbucket_pull_request_comment_reopened',
  },
] as const

/** Maps Sim trigger IDs to the exact Bitbucket Cloud repository-hook event keys. */
export const BITBUCKET_TRIGGER_EVENT_MAP = {
  bitbucket_push: 'repo:push',
  bitbucket_repository_forked: 'repo:fork',
  bitbucket_repository_updated: 'repo:updated',
  bitbucket_commit_comment_created: 'repo:commit_comment_created',
  bitbucket_build_status_created: 'repo:commit_status_created',
  bitbucket_build_status_updated: 'repo:commit_status_updated',
  bitbucket_pull_request_created: 'pullrequest:created',
  bitbucket_pull_request_updated: 'pullrequest:updated',
  bitbucket_pull_request_approved: 'pullrequest:approved',
  bitbucket_pull_request_approval_removed: 'pullrequest:unapproved',
  bitbucket_pull_request_changes_requested: 'pullrequest:changes_request_created',
  bitbucket_pull_request_changes_request_removed: 'pullrequest:changes_request_removed',
  bitbucket_pull_request_merged: 'pullrequest:fulfilled',
  bitbucket_pull_request_declined: 'pullrequest:rejected',
  bitbucket_pull_request_comment_created: 'pullrequest:comment_created',
  bitbucket_pull_request_comment_updated: 'pullrequest:comment_updated',
  bitbucket_pull_request_comment_deleted: 'pullrequest:comment_deleted',
  bitbucket_pull_request_comment_resolved: 'pullrequest:comment_resolved',
  bitbucket_pull_request_comment_reopened: 'pullrequest:comment_reopened',
} as const satisfies Record<string, string>

export type BitbucketTriggerId = keyof typeof BITBUCKET_TRIGGER_EVENT_MAP

export function getBitbucketEventForTrigger(triggerId: string): string | undefined {
  return BITBUCKET_TRIGGER_EVENT_MAP[triggerId as BitbucketTriggerId]
}

export function isBitbucketEventMatch(triggerId: string, eventKey: string | undefined): boolean {
  const expectedEvent = getBitbucketEventForTrigger(triggerId)
  return Boolean(expectedEvent && eventKey && expectedEvent === eventKey)
}

export function bitbucketSetupInstructions(eventLabel: string): string {
  const instructions = [
    'Connect the <strong>Bitbucket account</strong> that administers the repository.',
    'Select the <strong>workspace</strong> and <strong>repository</strong> to monitor.',
    `Deploy the workflow. Sim automatically creates a signed webhook for <strong>${eventLabel}</strong> events.`,
    'Bitbucket allows up to <strong>50 webhooks per repository</strong>; each deployed Sim trigger uses one.',
    'Undeploying the workflow automatically removes the webhook from Bitbucket.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/** Fields shared by every automatically managed Bitbucket repository trigger. */
export function buildBitbucketExtraFields(triggerId: BitbucketTriggerId): SubBlockConfig[] {
  const condition = { field: 'selectedTriggerId', value: triggerId }

  return [
    {
      id: 'triggerCredentials',
      title: 'Bitbucket Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      serviceId: 'bitbucket',
      requiredScopes: ['account', 'repository', 'pullrequest', 'webhook'],
      placeholder: 'Select Bitbucket account',
      description:
        'The Bitbucket account used to create and remove the repository webhook. Repository administrator access is required.',
      required: true,
      mode: 'trigger',
      condition,
    },
    {
      id: 'workspacePicker',
      title: 'Workspace',
      canvasNoun: 'a workspace',
      type: 'project-selector',
      canonicalParamId: 'workspaceSlug',
      serviceId: 'bitbucket',
      selectorKey: 'bitbucket.workspaces',
      dependsOn: ['triggerCredentials'],
      placeholder: 'Select Bitbucket workspace',
      description: 'The workspace containing the repository to monitor.',
      required: true,
      mode: 'trigger',
      condition,
    },
    {
      id: 'workspaceSlugInput',
      title: 'Workspace Slug',
      type: 'short-input',
      canonicalParamId: 'workspaceSlug',
      placeholder: 'Enter workspace slug',
      description: 'Enter the workspace slug directly instead of selecting a workspace.',
      required: true,
      mode: 'trigger-advanced',
      condition,
    },
    {
      id: 'repositoryPicker',
      title: 'Repository',
      canvasNoun: 'a repository',
      type: 'project-selector',
      canonicalParamId: 'repoSlug',
      serviceId: 'bitbucket',
      selectorKey: 'bitbucket.repositories',
      dependsOn: ['triggerCredentials', 'workspacePicker'],
      placeholder: 'Select Bitbucket repository',
      description: 'The repository where Sim creates the webhook.',
      required: true,
      mode: 'trigger',
      condition,
    },
    {
      id: 'repositorySlugInput',
      title: 'Repository Slug',
      type: 'short-input',
      canonicalParamId: 'repoSlug',
      placeholder: 'Enter repository slug',
      description: 'Enter the repository slug directly instead of selecting a repository.',
      required: true,
      mode: 'trigger-advanced',
      condition,
    },
  ]
}

function buildCommonOutputs(): Record<string, TriggerOutput> {
  return {
    eventType: {
      type: 'string',
      description: 'Bitbucket event key from X-Event-Key',
    },
    hookUuid: {
      type: 'string',
      description: 'UUID of the Bitbucket repository webhook',
    },
    requestUuid: {
      type: 'string',
      description: 'Bitbucket delivery request UUID',
    },
    attemptNumber: {
      type: 'number',
      description: 'Bitbucket delivery attempt number',
    },
    actor: { type: 'json', description: 'User or app that caused the event' },
    repository: {
      type: 'json',
      description: 'Repository where the event occurred',
    },
    payload: {
      type: 'json',
      description: 'Full parsed Bitbucket webhook payload',
    },
  }
}

function buildCommentOutputs(): Record<string, TriggerOutput> {
  return {
    comment: { type: 'json', description: 'Bitbucket comment object' },
    commentId: { type: 'number', description: 'Repository-scoped comment ID' },
    commentContent: {
      type: 'string',
      description: 'Raw text content of the comment',
    },
  }
}

function buildPullRequestOutputs(): Record<string, TriggerOutput> {
  return {
    pullRequest: { type: 'json', description: 'Bitbucket pull request object' },
    pullRequestId: {
      type: 'number',
      description: 'Repository-scoped pull request ID',
    },
    pullRequestTitle: { type: 'string', description: 'Pull request title' },
    pullRequestState: { type: 'string', description: 'Pull request state' },
    sourceBranch: { type: 'string', description: 'Pull request source branch' },
    destinationBranch: {
      type: 'string',
      description: 'Pull request destination branch',
    },
  }
}

export function buildBitbucketPushOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildCommonOutputs(),
    push: {
      type: 'json',
      description: 'Push details, including changes and commits',
    },
  }
}

export function buildBitbucketForkOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildCommonOutputs(),
    fork: { type: 'json', description: 'Newly created repository fork' },
  }
}

export function buildBitbucketRepositoryUpdatedOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildCommonOutputs(),
    changes: {
      type: 'json',
      description: 'Repository fields changed by the update',
    },
  }
}

export function buildBitbucketCommitCommentOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildCommonOutputs(),
    ...buildCommentOutputs(),
    commit: { type: 'json', description: 'Commit the comment was created on' },
  }
}

export function buildBitbucketBuildStatusOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildCommonOutputs(),
    commitStatus: {
      type: 'json',
      description: 'Bitbucket commit status object',
    },
    commitHash: {
      type: 'string',
      description: 'Hash of the commit with this status',
    },
    statusKey: {
      type: 'string',
      description: 'Key identifying the build status',
    },
    statusState: { type: 'string', description: 'Current build status state' },
    statusName: {
      type: 'string',
      description: 'Display name of the build status',
    },
    statusUrl: {
      type: 'string',
      description: 'URL associated with the build status',
    },
  }
}

export function buildBitbucketPullRequestOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildCommonOutputs(),
    ...buildPullRequestOutputs(),
  }
}

export function buildBitbucketPullRequestApprovalOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBitbucketPullRequestOutputs(),
    approval: { type: 'json', description: 'Pull request approval details' },
  }
}

export function buildBitbucketPullRequestChangesRequestOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBitbucketPullRequestOutputs(),
    changesRequest: {
      type: 'json',
      description: 'Pull request changes-request details',
    },
  }
}

export function buildBitbucketPullRequestCommentOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBitbucketPullRequestOutputs(),
    ...buildCommentOutputs(),
  }
}

export function buildBitbucketOutputs(
  triggerId: BitbucketTriggerId
): Record<string, TriggerOutput> {
  switch (triggerId) {
    case 'bitbucket_push':
      return buildBitbucketPushOutputs()
    case 'bitbucket_repository_forked':
      return buildBitbucketForkOutputs()
    case 'bitbucket_repository_updated':
      return buildBitbucketRepositoryUpdatedOutputs()
    case 'bitbucket_commit_comment_created':
      return buildBitbucketCommitCommentOutputs()
    case 'bitbucket_build_status_created':
    case 'bitbucket_build_status_updated':
      return buildBitbucketBuildStatusOutputs()
    case 'bitbucket_pull_request_approved':
    case 'bitbucket_pull_request_approval_removed':
      return buildBitbucketPullRequestApprovalOutputs()
    case 'bitbucket_pull_request_changes_requested':
    case 'bitbucket_pull_request_changes_request_removed':
      return buildBitbucketPullRequestChangesRequestOutputs()
    case 'bitbucket_pull_request_comment_created':
    case 'bitbucket_pull_request_comment_updated':
    case 'bitbucket_pull_request_comment_deleted':
    case 'bitbucket_pull_request_comment_resolved':
    case 'bitbucket_pull_request_comment_reopened':
      return buildBitbucketPullRequestCommentOutputs()
    case 'bitbucket_pull_request_created':
    case 'bitbucket_pull_request_updated':
    case 'bitbucket_pull_request_merged':
    case 'bitbucket_pull_request_declined':
      return buildBitbucketPullRequestOutputs()
  }
}
