import { GithubIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const githubConnectorMeta: ConnectorMeta = {
  id: 'github',
  name: 'GitHub',
  description: 'Sync files from a GitHub repository',
  version: '1.0.0',
  icon: GithubIcon,
  search: true,
  searchDocsUrl: 'https://docs.sim.ai/search/github',
  permissionScopedListing: { capFieldIds: ['maxFiles'] },
  supportsSeparateContentCredential: true,
  memberSetupHint:
    'Install the GitHub App on the repositories you want to search. Each person connects their own GitHub account with a verified email matching their Sim account.',

  auth: {
    mode: 'oauth',
    provider: 'github-repositories',
    apiKey: {
      label: 'Personal Access Token',
      placeholder: 'github_pat_…',
    },
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
      placeholder: 'e.g. main',
      required: false,
      description:
        'Leave blank for the repository’s default branch in member connections, or main in workspace connections.',
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
