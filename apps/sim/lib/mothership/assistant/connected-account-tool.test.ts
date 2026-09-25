import { describe, expect, it } from 'vitest'
import {
  assistantConnectedAccountTokenParam,
  projectAssistantConnectedAccountTool,
} from '@/lib/mothership/assistant/connected-account-tool'
import { getIssueV2Tool } from '@/tools/github/get_issue'
import { searchIssuesV2Tool } from '@/tools/github/search_issues'

describe('GitHub Assistant connected-account adapter', () => {
  it('preserves Build and flag-off tool configuration without mutating the registry', () => {
    expect(projectAssistantConnectedAccountTool(getIssueV2Tool, false)).toBe(getIssueV2Tool)
    const adapted = projectAssistantConnectedAccountTool(getIssueV2Tool, true)
    expect(adapted).not.toBe(getIssueV2Tool)
    expect(getIssueV2Tool.params.apiKey.required).toBe(true)
    expect(getIssueV2Tool.oauth).toBeUndefined()
    expect(adapted.oauth).toMatchObject({
      required: true,
      provider: 'github-repositories',
      credentialKind: 'oauth',
    })
    expect(adapted.params.apiKey).toMatchObject({ visibility: 'hidden', required: false })
    expect(adapted.params.credentialId.required).toBe(true)
    expect(assistantConnectedAccountTokenParam(adapted)).toBe('apiKey')
  })
  it('uses the same adapter for the existing issue/PR search tool with total_count', () => {
    const adapted = projectAssistantConnectedAccountTool(searchIssuesV2Tool, true)
    expect(adapted.request).toBe(searchIssuesV2Tool.request)
    expect(adapted.transformResponse).toBe(searchIssuesV2Tool.transformResponse)
    expect(adapted.outputs).toBe(searchIssuesV2Tool.outputs)
    expect(assistantConnectedAccountTokenParam(adapted)).toBe('apiKey')
  })
  it('does not turn unrelated API-key tools or GitLab admin sources into personal credentials', () => {
    const tool = { ...getIssueV2Tool, id: 'gitlab_get_project' }
    expect(projectAssistantConnectedAccountTool(tool, true)).toBe(tool)
    expect(assistantConnectedAccountTokenParam(tool)).toBeUndefined()
  })
})
