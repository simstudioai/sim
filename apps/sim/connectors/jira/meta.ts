import { JiraIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const jiraConnectorMeta: ConnectorMeta = {
  id: 'jira',
  name: 'Jira',
  description: 'Sync issues from a Jira project',
  version: '1.0.0',
  icon: JiraIcon,

  auth: { mode: 'oauth', provider: 'jira', requiredScopes: ['read:jira-work', 'offline_access'] },

  configFields: [
    {
      id: 'domain',
      title: 'Jira Domain',
      type: 'short-input',
      placeholder: 'yoursite.atlassian.net',
      required: true,
    },
    {
      id: 'projectSelector',
      title: 'Projects',
      type: 'selector',
      selectorKey: 'jira.projects',
      canonicalParamId: 'projectKey',
      mode: 'basic',
      multi: true,
      dependsOn: ['domain'],
      placeholder: 'Select one or more projects',
      required: true,
    },
    {
      id: 'projectKey',
      title: 'Project Keys',
      type: 'short-input',
      canonicalParamId: 'projectKey',
      mode: 'advanced',
      multi: true,
      placeholder: 'e.g. ENG, PROJ (comma-separated for multiple)',
      required: true,
    },
    {
      id: 'jql',
      title: 'JQL Filter',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. status = "Done" AND type = Bug',
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
    { id: 'issueType', displayName: 'Issue Type', fieldType: 'text' },
    { id: 'status', displayName: 'Status', fieldType: 'text' },
    { id: 'priority', displayName: 'Priority', fieldType: 'text' },
    { id: 'labels', displayName: 'Labels', fieldType: 'text' },
    { id: 'assignee', displayName: 'Assignee', fieldType: 'text' },
    { id: 'updated', displayName: 'Last Updated', fieldType: 'date' },
  ],
}
