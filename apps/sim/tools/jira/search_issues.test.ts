import { describe, expect, it } from 'vitest'
import { jiraSearchIssuesTool } from '@/tools/jira/search_issues'
import type { JiraSearchIssuesParams } from '@/tools/jira/types'

const ISSUE = {
  id: '10001',
  key: 'PROJ-1',
  self: 'https://api.atlassian.com/ex/jira/cloud/rest/api/3/issue/10001',
  fields: {
    summary: 'Broken login',
    description: {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Steps' }] }],
    },
    status: { id: '1', name: 'Open' },
    labels: ['auth'],
    customfield_10016: 5,
    subtasks: [
      { id: '10002', key: 'PROJ-2', fields: { summary: 'Fix', status: { name: 'Open' } } },
    ],
    attachment: [{ id: 'a1', filename: 'log.txt' }],
    resolutiondate: null,
  },
  renderedFields: { description: '<p>Steps</p>' },
}

async function search(params: Partial<JiraSearchIssuesParams>) {
  const transform = jiraSearchIssuesTool.transformResponse
  if (!transform) throw new Error('jira_search_issues has no transformResponse')
  const response = new Response(JSON.stringify({ issues: [ISSUE], isLast: true }))
  const result = await transform(response, {
    accessToken: 'token',
    domain: 'example.atlassian.net',
    cloudId: 'cloud',
    jql: 'project = PROJ',
    ...params,
  })
  const [issue] = result.output.issues
  if (!issue) throw new Error('expected one issue')
  return issue
}

describe('jira_search_issues items', () => {
  it('leaves the heavy fields off a default search item', async () => {
    const issue = await search({})
    expect(issue).toMatchObject({ key: 'PROJ-1', summary: 'Broken login', description: 'Steps' })
    for (const heavy of [
      'descriptionAdf',
      'customFields',
      'attachments',
      'issuelinks',
      'subtasks',
      'renderedDescription',
    ]) {
      expect(issue).not.toHaveProperty(heavy)
    }
  })

  it('includes the heavy fields when the caller passes fields', async () => {
    const issue = await search({ fields: ['summary', 'description', 'customfield_10016'] })
    expect(issue.customFields).toEqual({ customfield_10016: 5 })
    expect(issue.descriptionAdf).toEqual(ISSUE.fields.description)
    expect(issue.subtasks).toMatchObject([{ key: 'PROJ-2' }])
    expect(issue.attachments).toMatchObject([{ id: 'a1', filename: 'log.txt' }])
    expect(issue.issuelinks).toEqual([])
  })

  it('includes renderedDescription only with the renderedFields expansion', async () => {
    const issue = await search({ expand: 'names, renderedFields' })
    expect(issue.renderedDescription).toBe('<p>Steps</p>')
  })
})
