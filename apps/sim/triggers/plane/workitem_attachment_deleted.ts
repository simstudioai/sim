import { PlaneIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildPlaneExtraFields,
  buildPlaneOutputs,
  planeSetupInstructions,
  planeTriggerOptions,
} from '@/triggers/plane/utils'
import type { TriggerConfig } from '@/triggers/types'

export const planeWorkitemAttachmentDeletedTrigger: TriggerConfig = {
  id: 'plane_workitem_attachment_deleted',
  name: 'Plane Work Item Attachment Deleted',
  provider: 'plane',
  description: 'Trigger a workflow for Plane work item attachment deleted events.',
  version: '1.0.0',
  icon: PlaneIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'plane_workitem_attachment_deleted',
    triggerOptions: planeTriggerOptions,

    setupInstructions: planeSetupInstructions(),
    extraFields: buildPlaneExtraFields('plane_workitem_attachment_deleted'),
  }),
  outputs: buildPlaneOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
