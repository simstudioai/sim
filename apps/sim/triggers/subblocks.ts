import type { SubBlockConfig } from '@/blocks/types'

interface BuildTriggerSubBlocksOptions {
  triggerId: string
  triggerOptions: Array<{ label: string; id: string }>
  includeDropdown?: boolean
  setupInstructions: string
  extraFields?: SubBlockConfig[]
  fieldsBeforeWebhookUrl?: SubBlockConfig[]
  providerWebhookUrl?: NonNullable<SubBlockConfig['providerWebhookUrl']>
  webhookPlaceholder?: string
}

export function buildTriggerSubBlocks(options: BuildTriggerSubBlocksOptions): SubBlockConfig[] {
  const {
    triggerId,
    triggerOptions,
    includeDropdown = false,
    setupInstructions,
    extraFields = [],
    fieldsBeforeWebhookUrl = [],
    providerWebhookUrl,
    webhookPlaceholder = 'Webhook URL will be generated',
  } = options

  const blocks: SubBlockConfig[] = []

  if (includeDropdown) {
    blocks.push({
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      canvasNoun: 'an event',
      type: 'dropdown',
      mode: 'trigger',
      options: triggerOptions,
      value: () => triggerId,
      required: true,
    })
  }

  blocks.push(...fieldsBeforeWebhookUrl)
  blocks.push({
    id: 'webhookUrlDisplay',
    title: 'Webhook URL',
    type: 'short-input',
    readOnly: true,
    showCopyButton: true,
    ...(providerWebhookUrl ? { providerWebhookUrl } : { useWebhookUrl: true }),
    placeholder: webhookPlaceholder,
    mode: 'trigger',
    condition: { field: 'selectedTriggerId', value: triggerId },
  })
  blocks.push(...extraFields)
  blocks.push({
    id: 'triggerInstructions',
    title: 'Setup Instructions',
    hideFromPreview: true,
    type: 'text',
    defaultValue: setupInstructions,
    mode: 'trigger',
    condition: { field: 'selectedTriggerId', value: triggerId },
  })

  return blocks
}
