import { PlaneIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const planeConnectorMeta: ConnectorMeta = {
  id: 'plane',
  name: 'Plane',
  description: 'Sync work items or project pages from Plane',
  version: '1.0.0',
  icon: PlaneIcon,
  auth: {
    mode: 'apiKey',
    label: 'API Token',
    placeholder: 'Enter your Plane personal access token',
  },
  configFields: [
    {
      id: 'workspaceSlug',
      title: 'Workspace Slug',
      type: 'short-input',
      required: true,
      placeholder: 'my-team',
    },
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      required: true,
      placeholder: 'Project UUID',
    },
    {
      id: 'contentType',
      title: 'Content',
      type: 'dropdown',
      required: false,
      options: [
        { id: 'work_items', label: 'Work items' },
        { id: 'pages', label: 'Project pages' },
      ],
      description: 'Project pages require a Plane edition with the public pages API.',
    },
    {
      id: 'baseUrl',
      title: 'Instance URL',
      type: 'short-input',
      required: false,
      placeholder: 'https://api.plane.so',
      description:
        'Cloud API or self-hosted instance origin, optionally with a path prefix. Omit /api/v1 and /api/v2.',
    },
    {
      id: 'webUrl',
      title: 'App URL',
      type: 'short-input',
      required: false,
      placeholder: 'https://app.plane.so',
      description:
        'Plane app origin for source links. Defaults to the cloud app, or the configured self-hosted instance.',
    },
    {
      id: 'maxDocuments',
      title: 'Max Documents',
      type: 'short-input',
      required: false,
      placeholder: 'Unlimited',
    },
  ],
  tagDefinitions: [
    { id: 'projectId', displayName: 'Project ID', fieldType: 'text' },
    { id: 'state', displayName: 'State', fieldType: 'text' },
    { id: 'priority', displayName: 'Priority', fieldType: 'text' },
    { id: 'assignees', displayName: 'Assignees', fieldType: 'text' },
    { id: 'labels', displayName: 'Labels', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
  ],
}
