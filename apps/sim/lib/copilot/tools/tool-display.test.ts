/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getToolCompletedTitle,
  getToolDisplayTitle,
  humanizeToolName,
  mvDisplayVerb,
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

describe('mvDisplayVerb', () => {
  it('reads a leaf-only change in the same folder as a rename', () => {
    expect(mvDisplayVerb('workflows/falling-vacuum', 'workflows/failing-vacuum')).toBe('Renaming')
    expect(mvDisplayVerb('files/Reports/a.md', 'files/Reports/b.md')).toBe('Renaming')
    expect(mvDisplayVerb('tables/Leads', 'tables/Customers')).toBe('Renaming')
  })

  it('decodes segments so encoded sources compare against plain destinations', () => {
    expect(mvDisplayVerb('workflows/My%20Flow', 'workflows/New Flow')).toBe('Renaming')
    expect(mvDisplayVerb('files/My%20Docs/a.md', 'files/My Docs/b.md')).toBe('Renaming')
  })

  it('reads parent changes and folder destinations as moves', () => {
    expect(mvDisplayVerb('files/a.png', 'files/Images/')).toBe('Moving')
    expect(mvDisplayVerb('files/Reports/a.md', 'files/Archive/a.md')).toBe('Moving')
    expect(mvDisplayVerb('files/Reports/a.md', 'files/Archive/b.md')).toBe('Moving')
    expect(mvDisplayVerb('workflows/My Flow', 'workflows/Archive/')).toBe('Moving')
  })

  it('falls back to Moving when arguments are incomplete', () => {
    expect(mvDisplayVerb(undefined, 'files/x.md')).toBe('Moving')
    expect(mvDisplayVerb('files/x.md', undefined)).toBe('Moving')
  })
})

describe('getToolDisplayTitle for the vfs verbs', () => {
  it('uses the derived verb for mv titles', () => {
    expect(
      getToolDisplayTitle('mv', {
        sources: ['workflows/falling-vacuum'],
        destination: 'workflows/failing-vacuum',
        toolTitle: 'falling-vacuum to failing-vacuum',
      })
    ).toBe('Renaming falling-vacuum to failing-vacuum')
    expect(
      getToolDisplayTitle('mv', {
        sources: ['files/a.png', 'files/b.png'],
        destination: 'files/Images/',
        toolTitle: '2 files to Images',
      })
    ).toBe('Moving 2 files to Images')
  })

  it('titles cp and mkdir by intent', () => {
    expect(getToolDisplayTitle('cp', { toolTitle: 'My Workflow' })).toBe('Duplicating My Workflow')
    expect(getToolDisplayTitle('mkdir', { toolTitle: 'Reports/2026' })).toBe(
      'Creating Reports/2026'
    )
    expect(getToolDisplayTitle('cp', {})).toBe('Duplicating workflow')
    expect(getToolDisplayTitle('mkdir', {})).toBe('Creating folder')
  })
})

describe('getToolDisplayTitle for request-scoped MCP tools', () => {
  it('hides the internal server id and humanizes the tool name', () => {
    expect(getToolDisplayTitle('mcp-363de040-web_search_exa')).toBe('Web Search Exa')
  })
})
