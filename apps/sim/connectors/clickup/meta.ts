import { ClickUpIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const clickupConnectorMeta: ConnectorMeta = {
  id: 'clickup',
  name: 'ClickUp',
  description: 'Sync Docs from a ClickUp Workspace',
  version: '1.0.0',
  icon: ClickUpIcon,

  auth: {
    mode: 'oauth',
    provider: 'clickup',
  },

  configFields: [
    {
      id: 'workspaceSelector',
      title: 'Workspace',
      type: 'selector',
      selectorKey: 'clickup.workspaces',
      canonicalParamId: 'teamId',
      mode: 'basic',
      placeholder: 'Select a workspace',
      required: true,
    },
    {
      id: 'teamId',
      title: 'Workspace ID',
      type: 'short-input',
      canonicalParamId: 'teamId',
      mode: 'advanced',
      placeholder: 'e.g. 9012345678',
      required: true,
    },
    {
      id: 'spaceSelector',
      title: 'Space',
      type: 'selector',
      selectorKey: 'clickup.spaces',
      canonicalParamId: 'spaceId',
      mode: 'basic',
      dependsOn: ['workspaceSelector'],
      placeholder: 'Select a space (optional)',
      required: false,
    },
    {
      id: 'spaceId',
      title: 'Space ID',
      type: 'short-input',
      canonicalParamId: 'spaceId',
      mode: 'advanced',
      placeholder: 'e.g. 90123456789',
      required: false,
    },
    {
      id: 'maxDocs',
      title: 'Max Docs',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  tagDefinitions: [
    { id: 'created', displayName: 'Created', fieldType: 'date' },
    { id: 'lastUpdated', displayName: 'Last Updated', fieldType: 'date' },
    { id: 'public', displayName: 'Public', fieldType: 'boolean' },
  ],
}
