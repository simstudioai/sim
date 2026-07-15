import { GrainIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildGenericOutputs,
  buildGrainV2ExtraFields,
  buildHighlightOutputs,
  buildRecordingOutputs,
  buildStoryOutputs,
  grainV2EventSetupInstructions,
  grainV2TriggerOptions,
} from '@/triggers/grain/utils'
import type { TriggerConfig } from '@/triggers/types'

export const grainRecordingAddedV2Trigger: TriggerConfig = {
  id: 'grain_recording_added_v2',
  name: 'Grain Recording Added',
  provider: 'grain',
  description: 'Trigger when a new recording is added in Grain',
  version: '2.0.0',
  icon: GrainIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'grain_recording_added_v2',
    triggerOptions: grainV2TriggerOptions,
    includeWebhookUrl: false,
    includeDropdown: true,
    setupInstructions: grainV2EventSetupInstructions('Recording Added'),
    extraFields: buildGrainV2ExtraFields('grain_recording_added_v2'),
  }),
  outputs: buildRecordingOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}

export const grainRecordingUpdatedV2Trigger: TriggerConfig = {
  id: 'grain_recording_updated_v2',
  name: 'Grain Recording Updated',
  provider: 'grain',
  description: 'Trigger when a recording is updated in Grain',
  version: '2.0.0',
  icon: GrainIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'grain_recording_updated_v2',
    triggerOptions: grainV2TriggerOptions,
    includeWebhookUrl: false,
    setupInstructions: grainV2EventSetupInstructions('Recording Updated'),
    extraFields: buildGrainV2ExtraFields('grain_recording_updated_v2'),
  }),
  outputs: buildRecordingOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}

export const grainRecordingDeletedV2Trigger: TriggerConfig = {
  id: 'grain_recording_deleted_v2',
  name: 'Grain Recording Deleted',
  provider: 'grain',
  description: 'Trigger when a recording is deleted in Grain',
  version: '2.0.0',
  icon: GrainIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'grain_recording_deleted_v2',
    triggerOptions: grainV2TriggerOptions,
    includeWebhookUrl: false,
    setupInstructions: grainV2EventSetupInstructions('Recording Deleted'),
    extraFields: buildGrainV2ExtraFields('grain_recording_deleted_v2'),
  }),
  outputs: buildGenericOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}

export const grainHighlightAddedV2Trigger: TriggerConfig = {
  id: 'grain_highlight_added_v2',
  name: 'Grain Highlight Added',
  provider: 'grain',
  description: 'Trigger when a new highlight/clip is created in Grain',
  version: '2.0.0',
  icon: GrainIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'grain_highlight_added_v2',
    triggerOptions: grainV2TriggerOptions,
    includeWebhookUrl: false,
    setupInstructions: grainV2EventSetupInstructions('Highlight Added'),
    extraFields: buildGrainV2ExtraFields('grain_highlight_added_v2'),
  }),
  outputs: buildHighlightOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}

export const grainHighlightUpdatedV2Trigger: TriggerConfig = {
  id: 'grain_highlight_updated_v2',
  name: 'Grain Highlight Updated',
  provider: 'grain',
  description: 'Trigger when a highlight/clip is updated in Grain',
  version: '2.0.0',
  icon: GrainIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'grain_highlight_updated_v2',
    triggerOptions: grainV2TriggerOptions,
    includeWebhookUrl: false,
    setupInstructions: grainV2EventSetupInstructions('Highlight Updated'),
    extraFields: buildGrainV2ExtraFields('grain_highlight_updated_v2'),
  }),
  outputs: buildHighlightOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}

export const grainHighlightDeletedV2Trigger: TriggerConfig = {
  id: 'grain_highlight_deleted_v2',
  name: 'Grain Highlight Deleted',
  provider: 'grain',
  description: 'Trigger when a highlight/clip is deleted in Grain',
  version: '2.0.0',
  icon: GrainIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'grain_highlight_deleted_v2',
    triggerOptions: grainV2TriggerOptions,
    includeWebhookUrl: false,
    setupInstructions: grainV2EventSetupInstructions('Highlight Deleted'),
    extraFields: buildGrainV2ExtraFields('grain_highlight_deleted_v2'),
  }),
  outputs: buildGenericOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}

export const grainStoryAddedV2Trigger: TriggerConfig = {
  id: 'grain_story_added_v2',
  name: 'Grain Story Added',
  provider: 'grain',
  description: 'Trigger when a new story is created in Grain',
  version: '2.0.0',
  icon: GrainIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'grain_story_added_v2',
    triggerOptions: grainV2TriggerOptions,
    includeWebhookUrl: false,
    setupInstructions: grainV2EventSetupInstructions('Story Added'),
    extraFields: buildGrainV2ExtraFields('grain_story_added_v2'),
  }),
  outputs: buildStoryOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}

export const grainStoryUpdatedV2Trigger: TriggerConfig = {
  id: 'grain_story_updated_v2',
  name: 'Grain Story Updated',
  provider: 'grain',
  description: 'Trigger when a story is updated in Grain',
  version: '2.0.0',
  icon: GrainIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'grain_story_updated_v2',
    triggerOptions: grainV2TriggerOptions,
    includeWebhookUrl: false,
    setupInstructions: grainV2EventSetupInstructions('Story Updated'),
    extraFields: buildGrainV2ExtraFields('grain_story_updated_v2'),
  }),
  outputs: buildStoryOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}

export const grainStoryDeletedV2Trigger: TriggerConfig = {
  id: 'grain_story_deleted_v2',
  name: 'Grain Story Deleted',
  provider: 'grain',
  description: 'Trigger when a story is deleted in Grain',
  version: '2.0.0',
  icon: GrainIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'grain_story_deleted_v2',
    triggerOptions: grainV2TriggerOptions,
    includeWebhookUrl: false,
    setupInstructions: grainV2EventSetupInstructions('Story Deleted'),
    extraFields: buildGrainV2ExtraFields('grain_story_deleted_v2'),
  }),
  outputs: buildGenericOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}

export const grainUploadStatusV2Trigger: TriggerConfig = {
  id: 'grain_upload_status_v2',
  name: 'Grain Upload Status',
  provider: 'grain',
  description: 'Trigger on progress updates for recordings uploaded to Grain',
  version: '2.0.0',
  icon: GrainIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'grain_upload_status_v2',
    triggerOptions: grainV2TriggerOptions,
    includeWebhookUrl: false,
    setupInstructions: grainV2EventSetupInstructions('Upload Status'),
    extraFields: buildGrainV2ExtraFields('grain_upload_status_v2'),
  }),
  outputs: buildGenericOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}

export const grainAllEventsV2Trigger: TriggerConfig = {
  id: 'grain_all_events_v2',
  name: 'Grain All Events',
  provider: 'grain',
  description: 'Trigger on every Grain event (recordings, highlights, stories, uploads)',
  version: '2.0.0',
  icon: GrainIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'grain_all_events_v2',
    triggerOptions: grainV2TriggerOptions,
    includeWebhookUrl: false,
    setupInstructions: grainV2EventSetupInstructions('All Events'),
    extraFields: buildGrainV2ExtraFields('grain_all_events_v2'),
  }),
  outputs: buildGenericOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
