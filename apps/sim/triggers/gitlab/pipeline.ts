import { GitLabIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildGitLabExtraFields,
  buildGitLabPipelineOutputs,
  gitlabSetupInstructions,
  gitlabTriggerOptions,
} from '@/triggers/gitlab/utils'
import type { TriggerConfig } from '@/triggers/types'

export const gitlabPipelineTrigger: TriggerConfig = {
  id: 'gitlab_pipeline',
  name: 'GitLab Pipeline',
  provider: 'gitlab',
  description: 'Trigger workflow when a pipeline status changes in GitLab',
  version: '1.0.0',
  icon: GitLabIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'gitlab_pipeline',
    triggerOptions: gitlabTriggerOptions,
    setupInstructions: gitlabSetupInstructions('Pipeline'),
    extraFields: buildGitLabExtraFields('gitlab_pipeline'),
  }),
  outputs: buildGitLabPipelineOutputs(),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gitlab-Event': 'Pipeline Hook',
      'X-Gitlab-Token': '...',
    },
  },
}
