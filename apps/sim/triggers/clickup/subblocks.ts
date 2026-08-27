import type { SubBlockConfig } from '@/blocks/types'
import { clickupSetupInstructions } from '@/triggers/clickup/utils'

/**
 * Builds the shared subBlocks for a ClickUp trigger: OAuth credentials, the
 * workspace selector the webhook is registered in, optional location scoping
 * (space, folder, list, task), and setup instructions. Used by the primary
 * trigger (after its dropdown) and all secondary triggers.
 */
export function buildClickUpTriggerSubBlocks(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'triggerCredentials',
      title: 'ClickUp Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      serviceId: 'clickup',
      requiredScopes: [],
      mode: 'trigger',
      required: true,
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'triggerWorkspaceId',
      title: 'Workspace',
      type: 'dropdown',
      selectorKey: 'clickup.workspaces',
      dependsOn: ['triggerCredentials'],
      placeholder: 'Select a workspace',
      description: 'The ClickUp Workspace the webhook is registered in',
      required: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'triggerSpaceId',
      title: 'Space ID (Optional)',
      type: 'short-input',
      placeholder: 'Leave empty for the entire workspace',
      description:
        'Only receive events from this space. ClickUp applies the most specific location when several are set',
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'triggerFolderId',
      title: 'Folder ID (Optional)',
      type: 'short-input',
      placeholder: 'Leave empty for the entire workspace',
      description:
        'Only receive events from this folder. ClickUp applies the most specific location when several are set',
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'triggerListId',
      title: 'List ID (Optional)',
      type: 'short-input',
      placeholder: 'Leave empty for the entire workspace',
      description:
        'Only receive events from this list. ClickUp applies the most specific location when several are set',
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'triggerTaskId',
      title: 'Task ID (Optional)',
      type: 'short-input',
      placeholder: 'Leave empty for the entire workspace',
      description:
        'Only receive events for this task. ClickUp applies the most specific location when several are set',
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: clickupSetupInstructions(),
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}
