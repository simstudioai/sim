import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerConfig, TriggerConfigField } from '../types'

/**
 * Maps trigger configuration fields to regular subblock configs
 * This allows triggers to use the same subblock system as regular blocks
 */
export function mapTriggerToSubBlocks(triggerDef: TriggerConfig): SubBlockConfig[] {
  const subBlocks: SubBlockConfig[] = []

  // Add credentials subblock if required
  if (triggerDef.requiresCredentials && triggerDef.credentialProvider) {
    subBlocks.push({
      id: 'triggerCredentials',
      title: 'Credentials',
      type: 'oauth-input',
      description: `This trigger requires ${triggerDef.credentialProvider.replace('-', ' ')} credentials to access your account.`,
      provider: triggerDef.credentialProvider as any,
      requiredScopes: [],
      required: true,
      mode: 'trigger',
    })
  }

  // Convert each config field to a subblock
  Object.entries(triggerDef.configFields).forEach(([fieldId, fieldDef]) => {
    const subBlock = mapFieldToSubBlock(fieldId, fieldDef, triggerDef)
    if (subBlock) {
      subBlocks.push(subBlock)
    }
  })

  // Add instructions as text subblocks (show first, before webhook URL)
  if (triggerDef.instructions && triggerDef.instructions.length > 0) {
    subBlocks.push({
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      defaultValue: triggerDef.instructions
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
    })
  }

  // Add webhook URL display for webhook-based triggers
  if (triggerDef.webhook) {
    subBlocks.push({
      id: 'webhookUrlDisplay',
      title: 'Webhook URL',
      type: 'copyable-text',
      defaultValue: '',
      placeholder: 'Webhook URL will be generated after trigger is configured',
      useWebhookUrl: true, // This tells copyable-text to use the webhook management hook
      // Note: No webhookTriggerId - webhooks are per-block, not per-trigger
      // The trigger type only affects how the webhook payload is processed
      mode: 'trigger',
    })
  }

  // Add sample payload display
  if (triggerDef.samplePayload) {
    subBlocks.push({
      id: 'samplePayload',
      title: 'Event Payload Example',
      type: 'collapsible-json',
      defaultValue: triggerDef.samplePayload,
      mode: 'trigger',
    })
  }

  return subBlocks
}

/**
 * Maps a single trigger field to a subblock config
 */
function mapFieldToSubBlock(
  fieldId: string,
  fieldDef: TriggerConfigField,
  triggerDef: TriggerConfig
): SubBlockConfig | null {
  const baseConfig: Partial<SubBlockConfig> = {
    id: fieldId,
    title: fieldDef.label,
    description: fieldDef.description,
    placeholder: fieldDef.placeholder,
    required: fieldDef.required,
    defaultValue: fieldDef.defaultValue,
    mode: 'trigger', // Mark all trigger config fields to only show in trigger mode
  }

  switch (fieldDef.type) {
    case 'string':
      return {
        ...baseConfig,
        type: 'short-input',
        password: fieldDef.isSecret,
      } as SubBlockConfig

    case 'boolean':
      return {
        ...baseConfig,
        type: 'switch',
      } as SubBlockConfig

    case 'select':
      return {
        ...baseConfig,
        type: 'dropdown',
        options:
          fieldDef.options?.map((opt) =>
            typeof opt === 'string' ? { label: opt, id: opt } : opt
          ) || [],
      } as SubBlockConfig

    case 'number':
      return {
        ...baseConfig,
        type: 'short-input',
        // Note: The short-input component doesn't natively support number validation
        // but we can add it via description
        description: fieldDef.description
          ? `${fieldDef.description} (numeric value)`
          : 'Enter a numeric value',
      } as SubBlockConfig

    case 'multiselect':
      return {
        ...baseConfig,
        type: 'multi-select-dropdown',
        options:
          fieldDef.options?.map((opt) =>
            typeof opt === 'string' ? { label: opt, id: opt } : opt
          ) || [],
      } as SubBlockConfig

    case 'credential':
      return {
        ...baseConfig,
        type: 'oauth-input',
        provider: fieldDef.provider as any,
        requiredScopes: fieldDef.requiredScopes || [],
      } as SubBlockConfig

    default:
      console.warn(`Unknown trigger field type: ${(fieldDef as any).type}`)
      return null
  }
}
