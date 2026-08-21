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

export const bitbucketBuildStatusCreatedTrigger: TriggerConfig = {
  id: 'bitbucket_build_status_created',
  name: 'Bitbucket Build Status Created',
  provider: 'bitbucket',
  description: 'Trigger workflow when a build status is created for a Bitbucket commit',
  version: '1.0.0',
  icon: BitbucketIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'bitbucket_build_status_created',
    triggerOptions: [...bitbucketTriggerOptions],
    setupInstructions: bitbucketSetupInstructions('Build Status Created'),
    extraFields: buildBitbucketExtraFields('bitbucket_build_status_created'),
  }),
  outputs: buildBitbucketOutputs('bitbucket_build_status_created'),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Key': BITBUCKET_TRIGGER_EVENT_MAP.bitbucket_build_status_created,
      'X-Hub-Signature': 'sha256=...',
    },
  },
}
