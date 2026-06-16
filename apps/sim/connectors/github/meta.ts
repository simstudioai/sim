import { GithubIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const githubConnectorMeta: ConnectorMeta = {
  id: 'github',
  name: 'GitHub',
  description: 'Sync files from a GitHub repository',
  version: '1.0.0',
  icon: GithubIcon,

  auth: {
    mode: 'apiKey',
    label: 'Personal Access Token',
    placeholder: 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  },

  configFields: [
    {
      id: 'repository',
      title: 'Repository',
      type: 'short-input',
      placeholder: 'owner/repo',
      required: true,
    },
    {
      id: 'branch',
      title: 'Branch',
      type: 'short-input',
      placeholder: 'main (default)',
      required: false,
    },
    {
      id: 'pathPrefix',
      title: 'Path Filter',
      type: 'short-input',
      placeholder: 'e.g. docs/, src/components/',
      required: false,
    },
    {
      id: 'extensions',
      title: 'File Extensions',
      type: 'short-input',
      placeholder: 'e.g. .md, .txt, .mdx',
      required: false,
    },
    {
      id: 'maxFiles',
      title: 'Max Files',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  tagDefinitions: [
    { id: 'path', displayName: 'File Path', fieldType: 'text' },
    { id: 'repository', displayName: 'Repository', fieldType: 'text' },
    { id: 'branch', displayName: 'Branch', fieldType: 'text' },
    { id: 'size', displayName: 'File Size', fieldType: 'number' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
  ],
}
