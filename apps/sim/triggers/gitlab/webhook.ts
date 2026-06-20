import { GitLabIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildGitLabExtraFields,
  buildGitLabWebhookOutputs,
  gitlabSetupInstructions,
  gitlabTriggerOptions,
} from '@/triggers/gitlab/utils'
import type { TriggerConfig } from '@/triggers/types'

export const gitlabWebhookTrigger: TriggerConfig = {
  id: 'gitlab_webhook',
  name: 'GitLab Event',
  provider: 'gitlab',
  description: 'Trigger workflow from any GitLab webhook event',
  version: '1.0.0',
  icon: GitLabIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'gitlab_webhook',
    triggerOptions: gitlabTriggerOptions,
    setupInstructions: gitlabSetupInstructions('all'),
    extraFields: buildGitLabExtraFields('gitlab_webhook'),
  }),
  outputs: buildGitLabWebhookOutputs(),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gitlab-Event': 'Push Hook',
      'X-Gitlab-Token': '...',
    },
  },
}
