import { describe, expect, it } from 'vitest'
import type { JiraUpdateParams } from '@/tools/jira/types'
import { jiraUpdateTool } from '@/tools/jira/update'

function operationInput(params: Partial<JiraUpdateParams>) {
  return jiraUpdateTool.operation.input({
    accessToken: 'token',
    domain: 'example.atlassian.net',
    issueKey: 'PROJ-1',
    ...params,
  }) as Record<string, unknown>
}

describe('jira_update operation input', () => {
  it.each(['', '   '])('drops a blank parent %j instead of sending it to Jira', (parent) => {
    expect(operationInput({ parent }).parent).toBeUndefined()
  })

  it.each(['PROJ-9', { key: 'PROJ-9' }])('keeps the parent reference %j', (parent) => {
    expect(operationInput({ parent }).parent).toEqual(parent)
  })
})
