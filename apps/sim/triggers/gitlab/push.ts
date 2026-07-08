import { GitLabIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildGitLabExtraFields,
  buildGitLabPushOutputs,
  gitlabSetupInstructions,
  gitlabTriggerOptions,
} from '@/triggers/gitlab/utils'
import type { TriggerConfig } from '@/triggers/types'

export const gitlabPushTrigger: TriggerConfig = {
  id: 'gitlab_push',
  name: 'GitLab Push',
  provider: 'gitlab',
  description: 'Trigger workflow when commits are pushed to a GitLab project',
  version: '1.0.0',
  icon: GitLabIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'gitlab_push',
    triggerOptions: gitlabTriggerOptions,
    includeDropdown: true,
    setupInstructions: gitlabSetupInstructions('Push'),
    extraFields: buildGitLabExtraFields('gitlab_push'),
  }),
  outputs: buildGitLabPushOutputs(),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gitlab-Event': 'Push Hook',
      'X-Gitlab-Token': '...',
    },
  },
}
