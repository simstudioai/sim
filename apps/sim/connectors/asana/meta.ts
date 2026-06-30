import { AsanaIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const asanaConnectorMeta: ConnectorMeta = {
  id: 'asana',
  name: 'Asana',
  description: 'Sync tasks from Asana',
  version: '1.0.0',
  icon: AsanaIcon,

  auth: { mode: 'oauth', provider: 'asana', requiredScopes: ['default'] },

  configFields: [
    {
      id: 'workspaceSelector',
      title: 'Workspace',
      type: 'selector',
      selectorKey: 'asana.workspaces',
      canonicalParamId: 'workspace',
      mode: 'basic',
      placeholder: 'Select a workspace',
      required: true,
    },
    {
      id: 'workspace',
      title: 'Workspace GID',
      type: 'short-input',
      canonicalParamId: 'workspace',
      mode: 'advanced',
      placeholder: 'e.g. 1234567890',
      required: true,
    },
    {
      id: 'project',
      title: 'Project GID',
      type: 'short-input',
      placeholder: 'e.g. 9876543210 (leave empty for all projects)',
      required: false,
    },
    {
      id: 'maxTasks',
      title: 'Max Tasks',
      type: 'short-input',
      placeholder: 'e.g. 500 (default: unlimited)',
      required: false,
    },
  ],

  tagDefinitions: [
    { id: 'project', displayName: 'Project', fieldType: 'text' },
    { id: 'assignee', displayName: 'Assignee', fieldType: 'text' },
    { id: 'completed', displayName: 'Completed', fieldType: 'boolean' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'labels', displayName: 'Labels', fieldType: 'text' },
  ],
}
