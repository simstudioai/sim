import { GrainIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildStoryOutputs, grainSetupInstructions } from './utils'

export const grainStoryCreatedTrigger: TriggerConfig = {
  id: 'grain_story_created',
  name: 'Grain Story Created',
  provider: 'grain',
  description: 'Trigger workflow when a new story is created in Grain',
  version: '1.0.0',
  icon: GrainIcon,

  subBlocks: [
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Grain API key (Personal Access Token)',
      description: 'Required to create the webhook in Grain.',
      password: true,
      required: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_story_created',
      },
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'grain_story_created',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_story_created',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: grainSetupInstructions('Story (new)'),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'grain_story_created',
      },
    },
  ],

  outputs: buildStoryOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
