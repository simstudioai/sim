import { GitLabIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildGitLabExtraFields,
  buildGitLabIssueOutputs,
  gitlabSetupInstructions,
  gitlabTriggerOptions,
} from '@/triggers/gitlab/utils'
import type { TriggerConfig } from '@/triggers/types'

export const gitlabIssueTrigger: TriggerConfig = {
  id: 'gitlab_issue',
  name: 'GitLab Issue',
  provider: 'gitlab',
  description: 'Trigger workflow when an issue is opened, updated, or closed in GitLab',
  version: '1.0.0',
  icon: GitLabIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'gitlab_issue',
    triggerOptions: gitlabTriggerOptions,
    setupInstructions: gitlabSetupInstructions('Issue'),
    extraFields: buildGitLabExtraFields('gitlab_issue'),
  }),
  outputs: buildGitLabIssueOutputs(),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gitlab-Event': 'Issue Hook',
      'X-Gitlab-Token': '...',
    },
  },
}
