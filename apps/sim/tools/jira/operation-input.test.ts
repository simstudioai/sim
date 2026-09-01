/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { jiraAddAttachmentTool } from '@/tools/jira/add_attachment'
import { jiraUpdateTool } from '@/tools/jira/update'
import { jiraWriteTool } from '@/tools/jira/write'

const TOOLS = [jiraWriteTool, jiraUpdateTool, jiraAddAttachmentTool]

describe('Jira internal tool declarations', () => {
  it('exposes semantic operation input without HTTP transport metadata', () => {
    for (const tool of TOOLS) {
      expect(tool.operation.input).toBeTypeOf('function')
      expect(tool).not.toHaveProperty('request')
    }
  })

  it('preserves resolved secrets, dynamic fields, and file references verbatim', () => {
    expect(
      jiraWriteTool.operation.input({
        accessToken: '{{JIRA_TOKEN}}',
        domain: 'example.atlassian.net',
        projectId: '<project.output>',
        summary: '<agent.summary>',
        issueType: 'Task',
      })
    ).toMatchObject({
      accessToken: '{{JIRA_TOKEN}}',
      projectId: '<project.output>',
      summary: '<agent.summary>',
    })

    const files = [{ key: 'workspace/file.txt', name: 'file.txt', size: 4 }]
    expect(
      jiraAddAttachmentTool.operation.input({
        accessToken: 'token',
        domain: 'example.atlassian.net',
        issueKey: 'PROJ-1',
        files,
      }).files
    ).toBe(files)
  })
})
