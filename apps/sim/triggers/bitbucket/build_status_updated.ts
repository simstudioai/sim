import { BitbucketIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  BITBUCKET_TRIGGER_EVENT_MAP,
  bitbucketSetupInstructions,
  bitbucketTriggerOptions,
  buildBitbucketExtraFields,
  buildBitbucketOutputs,
} from '@/triggers/bitbucket/utils'
import type { TriggerConfig } from '@/triggers/types'

export const bitbucketBuildStatusUpdatedTrigger: TriggerConfig = {
  id: 'bitbucket_build_status_updated',
  name: 'Bitbucket Build Status Updated',
  provider: 'bitbucket',
  description: 'Trigger workflow when a build status is updated for a Bitbucket commit',
  version: '1.0.0',
  icon: BitbucketIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'bitbucket_build_status_updated',
    triggerOptions: [...bitbucketTriggerOptions],
    setupInstructions: bitbucketSetupInstructions('Build Status Updated'),
    extraFields: buildBitbucketExtraFields('bitbucket_build_status_updated'),
  }),
  outputs: buildBitbucketOutputs('bitbucket_build_status_updated'),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Key': BITBUCKET_TRIGGER_EVENT_MAP.bitbucket_build_status_updated,
      'X-Hub-Signature': 'sha256=...',
    },
  },
}
