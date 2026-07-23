import { createLogger } from '@sim/logger'
import { requestJson } from '@/lib/api/client/request'
import { clickupWorkspacesSelectorContract } from '@/lib/api/contracts/selectors/clickup'
import type { SubBlockConfig } from '@/blocks/types'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { clickupSetupInstructions } from '@/triggers/clickup/utils'

const logger = createLogger('ClickUpTriggerSubBlocks')

async function fetchWorkspaceOptions(
  blockId: string
): Promise<Array<{ id: string; label: string }>> {
  const credentialId = useSubBlockStore.getState().getValue(blockId, 'triggerCredentials') as
    | string
    | null
  if (!credentialId) {
    throw new Error('No ClickUp credential selected')
  }
  try {
    const data = await requestJson(clickupWorkspacesSelectorContract, {
      body: { credential: credentialId },
    })
    return (data.workspaces ?? []).map((workspace) => ({
      id: workspace.id,
      label: workspace.name,
    }))
  } catch (error) {
    logger.error('Error fetching ClickUp workspaces:', error)
    throw error
  }
}

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
      placeholder: 'Select a workspace',
      description: 'The ClickUp Workspace the webhook is registered in',
      required: true,
      options: [],
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
      fetchOptions: fetchWorkspaceOptions,
      fetchOptionById: async (blockId: string, optionId: string) => {
        const workspaces = await fetchWorkspaceOptions(blockId)
        return workspaces.find((workspace) => workspace.id === optionId) ?? null
      },
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
