import { LinearIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const linearConnectorMeta: ConnectorMeta = {
  id: 'linear',
  name: 'Linear',
  description: 'Sync issues from Linear',
  version: '1.0.0',
  icon: LinearIcon,

  auth: { mode: 'oauth', provider: 'linear', requiredScopes: ['read'] },

  configFields: [
    {
      id: 'teamSelector',
      title: 'Teams',
      type: 'selector',
      selectorKey: 'linear.teams',
      canonicalParamId: 'teamId',
      mode: 'basic',
      multi: true,
      placeholder: 'Select one or more teams (optional)',
      required: false,
    },
    {
      id: 'teamId',
      title: 'Team IDs',
      type: 'short-input',
      canonicalParamId: 'teamId',
      mode: 'advanced',
      multi: true,
      placeholder: 'e.g. abc123, def456 (comma-separated for multiple)',
      required: false,
    },
    {
      id: 'projectSelector',
      title: 'Projects',
      type: 'selector',
      selectorKey: 'linear.projects',
      canonicalParamId: 'projectId',
      mode: 'basic',
      multi: true,
      dependsOn: ['teamSelector'],
      placeholder: 'Select one or more projects (optional)',
      required: false,
    },
    {
      id: 'projectId',
      title: 'Project IDs',
      type: 'short-input',
      canonicalParamId: 'projectId',
      mode: 'advanced',
      multi: true,
      placeholder: 'e.g. def456, ghi789 (comma-separated for multiple)',
      required: false,
    },
    {
      id: 'stateFilter',
      title: 'State Filter',
      type: 'short-input',
      placeholder: 'e.g. In Progress, Todo',
      required: false,
    },
    {
      id: 'maxIssues',
      title: 'Max Issues',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  tagDefinitions: [
    { id: 'labels', displayName: 'Labels', fieldType: 'text' },
    { id: 'state', displayName: 'State', fieldType: 'text' },
    { id: 'priority', displayName: 'Priority', fieldType: 'text' },
    { id: 'assignee', displayName: 'Assignee', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
  ],
}
