/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getToolCompletedTitle,
  getToolDisplayTitle,
  humanizeToolName,
} from '@/lib/copilot/tools/tool-display'

describe('humanizeToolName', () => {
  it('title-cases snake_case names', () => {
    expect(humanizeToolName('manage_folder')).toBe('Manage Folder')
  })

  it('keeps canonical acronym casing', () => {
    expect(humanizeToolName('create_workspace_mcp_server')).toBe('Create Workspace MCP Server')
    expect(humanizeToolName('deploy_api')).toBe('Deploy API')
    expect(humanizeToolName('oauth_request_access')).toBe('OAuth Request Access')
  })
})

describe('getToolDisplayTitle natural-language coverage', () => {
  it('gives gerund titles to tools that previously fell through to humanize', () => {
    expect(getToolDisplayTitle('deploy_api')).toBe('Deploying API')
    expect(getToolDisplayTitle('list_workspace_mcp_servers')).toBe('Listing MCP servers')
    expect(getToolDisplayTitle('oauth_get_auth_link')).toBe('Getting authorization link')
    expect(getToolDisplayTitle('diff_workflows')).toBe('Comparing workflows')
  })

  it('falls back to running code for function_execute without a title', () => {
    expect(getToolDisplayTitle('function_execute')).toBe('Running code')
    expect(getToolDisplayTitle('function_execute', { title: 'Crunching numbers' })).toBe(
      'Crunching numbers'
    )
  })
})

describe('getToolCompletedTitle', () => {
  it('flips a leading gerund to past tense', () => {
    expect(getToolCompletedTitle('Querying logs')).toBe('Queried logs')
    expect(getToolCompletedTitle('Querying logs for Invoice Bot')).toBe(
      'Queried logs for Invoice Bot'
    )
    expect(getToolCompletedTitle('Searching online for pricing')).toBe(
      'Searched online for pricing'
    )
    expect(getToolCompletedTitle('Creating workflow')).toBe('Created workflow')
    expect(getToolCompletedTitle('Running workflow')).toBe('Ran workflow')
    expect(getToolCompletedTitle('Reading file')).toBe('Read file')
  })

  it('returns undefined for non-gerund titles', () => {
    expect(getToolCompletedTitle('Run Agent')).toBeUndefined()
    expect(getToolCompletedTitle('Folder action')).toBeUndefined()
    expect(getToolCompletedTitle('Custom title from the model')).toBeUndefined()
  })
})
