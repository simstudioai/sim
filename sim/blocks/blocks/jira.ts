import { JiraIcon } from '@/components/icons'
import { JiraRetrieveResponse, JiraUpdateResponse, JiraWriteResponse } from '@/tools/jira/types'
import { BlockConfig } from '../types'

type JiraResponse = JiraRetrieveResponse | JiraUpdateResponse | JiraWriteResponse

export const JiraBlock: BlockConfig<JiraResponse> = {
  type: 'jira',
  name: 'Jira',
  description: 'Interact with Jira',
  longDescription:
    'Connect to Jira workspaces to read, write, and update issues. Access content, metadata, and integrate Jira documentation into your workflows.',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: JiraIcon,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Read Issue', id: 'read' },
        { label: 'Update Issue', id: 'update' },
        { label: 'Create Issue', id: 'create' },
      ],
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Jira domain (e.g., simstudio.atlassian.net)',
    },
    {
      id: 'credential',
      title: 'Jira Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'jira',
      serviceId: 'jira',
      requiredScopes: [
        'read:page:jira',
        'update:page:jira',
        'read:jira-content.all',
        'write:jira-content',
        'read:me',
        'offline_access',
      ],
      placeholder: 'Select Jira account',
    },
    // Use file-selector component for page selection
    {
      id: 'issueKey',
      title: 'Select Issue',
      type: 'file-selector',
      layout: 'full',
      provider: 'jira',
      serviceId: 'jira',
      placeholder: 'Select jira issue',
    },
    // Update page fields
    {
      id: 'title',
      title: 'New Title',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter new title for the page',
      condition: { field: 'operation', value: 'update' },
    },
    {
      id: 'content',
      title: 'New Content',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter new content for the page',
      condition: { field: 'operation', value: 'update' },
    },
  ],
  tools: {
    access: ['jira_retrieve', 'jira_update', 'jira_write'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'read':
            return 'jira_retrieve'
          case 'update':
            return 'jira_update'
          case 'create':
            return 'jira_create'
          default:
            return 'jira_retrieve'
        }
      },
      params: (params) => {
        const { credential, ...rest } = params

        return {
          accessToken: credential,
          ...rest,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    domain: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    issueKey: { type: 'string', required: true },
    // Update operation inputs
    title: { type: 'string', required: false },
    content: { type: 'string', required: false },
  },
  outputs: {
    response: {
      type: {
        ts: 'string',
        issueKey: 'string',
        summary: 'string',
        description: 'string',
        created: 'string',
        updated: 'string',
        success: 'boolean',
        url: 'string'
      },
    },
  },
}
