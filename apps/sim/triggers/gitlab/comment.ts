import { GitLabIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildGitLabCommentOutputs,
  buildGitLabExtraFields,
  gitlabSetupInstructions,
  gitlabTriggerOptions,
} from '@/triggers/gitlab/utils'
import type { TriggerConfig } from '@/triggers/types'

export const gitlabCommentTrigger: TriggerConfig = {
  id: 'gitlab_comment',
  name: 'GitLab Comment',
  provider: 'gitlab',
  description: 'Trigger workflow when a comment is added on a commit, merge request, or issue',
  version: '1.0.0',
  icon: GitLabIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'gitlab_comment',
    triggerOptions: gitlabTriggerOptions,
    setupInstructions: gitlabSetupInstructions('Comment'),
    extraFields: buildGitLabExtraFields('gitlab_comment'),
  }),
  outputs: buildGitLabCommentOutputs(),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gitlab-Event': 'Note Hook',
      'X-Gitlab-Token': '...',
    },
  },
}
