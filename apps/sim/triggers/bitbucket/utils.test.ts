/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  bitbucketBuildStatusCreatedTrigger,
  bitbucketBuildStatusUpdatedTrigger,
  bitbucketCommitCommentCreatedTrigger,
  bitbucketPullRequestApprovalRemovedTrigger,
  bitbucketPullRequestApprovedTrigger,
  bitbucketPullRequestChangesRequestedTrigger,
  bitbucketPullRequestChangesRequestRemovedTrigger,
  bitbucketPullRequestCommentCreatedTrigger,
  bitbucketPullRequestCommentDeletedTrigger,
  bitbucketPullRequestCommentReopenedTrigger,
  bitbucketPullRequestCommentResolvedTrigger,
  bitbucketPullRequestCommentUpdatedTrigger,
  bitbucketPullRequestCreatedTrigger,
  bitbucketPullRequestDeclinedTrigger,
  bitbucketPullRequestMergedTrigger,
  bitbucketPullRequestUpdatedTrigger,
  bitbucketPushTrigger,
  bitbucketRepositoryForkedTrigger,
  bitbucketRepositoryUpdatedTrigger,
} from '@/triggers/bitbucket'
import {
  BITBUCKET_TRIGGER_EVENT_MAP,
  bitbucketTriggerOptions,
  getBitbucketEventForTrigger,
  isBitbucketEventMatch,
} from '@/triggers/bitbucket/utils'
import type { TriggerConfig } from '@/triggers/types'

const triggers: TriggerConfig[] = [
  bitbucketPushTrigger,
  bitbucketRepositoryForkedTrigger,
  bitbucketRepositoryUpdatedTrigger,
  bitbucketCommitCommentCreatedTrigger,
  bitbucketBuildStatusCreatedTrigger,
  bitbucketBuildStatusUpdatedTrigger,
  bitbucketPullRequestCreatedTrigger,
  bitbucketPullRequestUpdatedTrigger,
  bitbucketPullRequestApprovedTrigger,
  bitbucketPullRequestApprovalRemovedTrigger,
  bitbucketPullRequestChangesRequestedTrigger,
  bitbucketPullRequestChangesRequestRemovedTrigger,
  bitbucketPullRequestMergedTrigger,
  bitbucketPullRequestDeclinedTrigger,
  bitbucketPullRequestCommentCreatedTrigger,
  bitbucketPullRequestCommentUpdatedTrigger,
  bitbucketPullRequestCommentDeletedTrigger,
  bitbucketPullRequestCommentResolvedTrigger,
  bitbucketPullRequestCommentReopenedTrigger,
]

const commonOutputKeys = [
  'actor',
  'attemptNumber',
  'eventType',
  'hookUuid',
  'payload',
  'repository',
  'requestUuid',
]

describe('Bitbucket trigger definitions', () => {
  it('keeps options, event mappings, and trigger configs aligned', () => {
    const triggerIds = triggers.map((trigger) => trigger.id)

    expect(triggerIds).toEqual(bitbucketTriggerOptions.map((option) => option.id))
    expect(triggerIds).toEqual(Object.keys(BITBUCKET_TRIGGER_EVENT_MAP))
    expect(new Set(triggerIds)).toHaveLength(19)

    for (const trigger of triggers) {
      const eventKey = getBitbucketEventForTrigger(trigger.id)
      expect(eventKey).toBeDefined()
      expect(trigger.provider).toBe('bitbucket')
      expect(trigger.version).toBe('1.0.0')
      expect(trigger.webhook?.headers?.['X-Event-Key']).toBe(eventKey)
      expect(isBitbucketEventMatch(trigger.id, eventKey)).toBe(true)
      expect(isBitbucketEventMatch(trigger.id, 'unrelated:event')).toBe(false)
    }

    expect(getBitbucketEventForTrigger('bitbucket_unknown')).toBeUndefined()
    expect(isBitbucketEventMatch('bitbucket_unknown', 'repo:push')).toBe(false)
  })

  it('includes the trigger dropdown only on the primary push trigger', () => {
    const dropdownOwners = triggers
      .filter((trigger) =>
        trigger.subBlocks.some((subBlock) => subBlock.id === 'selectedTriggerId')
      )
      .map((trigger) => trigger.id)

    expect(dropdownOwners).toEqual(['bitbucket_push'])
  })

  it('uses the canonical OAuth, workspace, and repository configuration', () => {
    for (const trigger of triggers) {
      const credential = trigger.subBlocks.find((subBlock) => subBlock.id === 'triggerCredentials')
      const workspace = trigger.subBlocks.find((subBlock) => subBlock.id === 'workspacePicker')
      const manualWorkspace = trigger.subBlocks.find(
        (subBlock) => subBlock.id === 'workspaceSlugInput'
      )
      const repository = trigger.subBlocks.find((subBlock) => subBlock.id === 'repositoryPicker')
      const manualRepository = trigger.subBlocks.find(
        (subBlock) => subBlock.id === 'repositorySlugInput'
      )

      expect(credential).toMatchObject({
        type: 'oauth-input',
        canonicalParamId: 'oauthCredential',
        serviceId: 'bitbucket',
        requiredScopes: ['account', 'repository', 'pullrequest', 'webhook'],
        required: true,
      })
      expect(workspace).toMatchObject({
        canonicalParamId: 'workspaceSlug',
        selectorKey: 'bitbucket.workspaces',
        dependsOn: ['triggerCredentials'],
        required: true,
      })
      expect(manualWorkspace).toMatchObject({
        canonicalParamId: 'workspaceSlug',
        mode: 'trigger-advanced',
        required: true,
      })
      expect(repository).toMatchObject({
        canonicalParamId: 'repoSlug',
        selectorKey: 'bitbucket.repositories',
        dependsOn: ['triggerCredentials', 'workspacePicker'],
        required: true,
      })
      expect(manualRepository).toMatchObject({
        canonicalParamId: 'repoSlug',
        mode: 'trigger-advanced',
        required: true,
      })
    }
  })

  it('declares the common outputs on every event and only its documented family outputs', () => {
    const expectedFamilyOutputs: Record<string, string[]> = {
      bitbucket_push: ['push'],
      bitbucket_repository_forked: ['fork'],
      bitbucket_repository_updated: ['changes'],
      bitbucket_commit_comment_created: ['comment', 'commentContent', 'commentId', 'commit'],
      bitbucket_build_status_created: [
        'commitHash',
        'commitStatus',
        'statusKey',
        'statusName',
        'statusState',
        'statusUrl',
      ],
      bitbucket_build_status_updated: [
        'commitHash',
        'commitStatus',
        'statusKey',
        'statusName',
        'statusState',
        'statusUrl',
      ],
    }
    const pullRequestOutputs = [
      'destinationBranch',
      'pullRequest',
      'pullRequestId',
      'pullRequestState',
      'pullRequestTitle',
      'sourceBranch',
    ]

    for (const trigger of triggers) {
      let familyOutputs = expectedFamilyOutputs[trigger.id]
      if (!familyOutputs) {
        familyOutputs = [...pullRequestOutputs]
        if (
          trigger.id === 'bitbucket_pull_request_approved' ||
          trigger.id === 'bitbucket_pull_request_approval_removed'
        ) {
          familyOutputs.push('approval')
        } else if (
          trigger.id === 'bitbucket_pull_request_changes_requested' ||
          trigger.id === 'bitbucket_pull_request_changes_request_removed'
        ) {
          familyOutputs.push('changesRequest')
        } else if (trigger.id.startsWith('bitbucket_pull_request_comment_')) {
          familyOutputs.push('comment', 'commentContent', 'commentId')
        }
      }

      expect(Object.keys(trigger.outputs).sort()).toEqual(
        [...commonOutputKeys, ...familyOutputs].sort()
      )
    }
  })
})
