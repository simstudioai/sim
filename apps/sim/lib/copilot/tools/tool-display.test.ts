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
  it('shows the created file name', () => {
    expect(
      getToolDisplayTitle('create_file', {
        outputs: {
          files: [{ path: 'files/Reports/Quarterly%20Report.pdf', mode: 'create' }],
        },
      })
    ).toBe('Creating Quarterly Report.pdf')
    expect(getToolDisplayTitle('create_file', { fileName: 'notes.md' })).toBe('Creating notes.md')
    expect(getToolDisplayTitle('create_file')).toBe('Creating file')
  })

  it('shows deleted file and folder names', () => {
    expect(
      getToolDisplayTitle('delete_file', {
        paths: ['files/Reports/Old%20Report.pdf'],
      })
    ).toBe('Deleting Old Report.pdf')
    expect(
      getToolDisplayTitle('delete_file_folder', {
        paths: ['files/Old%20Reports', 'files/Drafts'],
      })
    ).toBe('Deleting Old Reports and Drafts')
  })

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

describe('getToolDisplayTitle for workflow resources', () => {
  it('shows workflow names for lifecycle actions', () => {
    expect(getToolDisplayTitle('create_workflow', { name: 'Lead Router' })).toBe(
      'Creating Lead Router'
    )
    expect(getToolDisplayTitle('edit_workflow', { workflowName: 'Lead Router' })).toBe(
      'Editing Lead Router'
    )
    expect(
      getToolDisplayTitle('delete_workflow', {
        workflowNames: ['Lead Router', 'Lead Enricher'],
      })
    ).toBe('Deleting Lead Router and Lead Enricher')
  })
})

describe('getToolDisplayTitle for managed resources', () => {
  it.each([
    [
      'manage_custom_tool',
      {
        operation: 'add',
        schema: { function: { name: 'lookupWeather' } },
      },
      'Creating lookupWeather',
    ],
    ['manage_mcp_tool', { operation: 'edit', config: { name: 'Linear' } }, 'Updating Linear'],
    ['manage_skill', { operation: 'delete', name: 'sales-research' }, 'Deleting sales-research'],
    [
      'manage_scheduled_task',
      { operation: 'create', args: { title: 'Morning Digest' } },
      'Creating Morning Digest',
    ],
    [
      'manage_credential',
      {
        operation: 'rename',
        previousDisplayName: 'Stripe',
        displayName: 'Production Stripe',
      },
      'Renaming Stripe to Production Stripe',
    ],
    [
      'manage_folder',
      { operation: 'rename', path: 'workflows/Old%20Name', name: 'New Name' },
      'Renaming Old Name to New Name',
    ],
    [
      'manage_folder',
      { operation: 'delete', path: 'workflows/Marketing/Q3%20Campaigns' },
      'Deleting Q3 Campaigns',
    ],
    ['manage_custom_tool', { operation: 'list' }, 'Viewing custom tools'],
    ['manage_mcp_tool', { operation: 'list' }, 'Viewing MCP servers'],
    ['manage_skill', { operation: 'list' }, 'Viewing skills'],
    ['manage_scheduled_task', { operation: 'get' }, 'Reading scheduled task'],
    ['manage_scheduled_task', { operation: 'list' }, 'Viewing scheduled tasks'],
  ])('uses verb + resource name for %s', (toolName, args, expected) => {
    expect(getToolDisplayTitle(toolName, args)).toBe(expected)
  })
})

describe('getToolDisplayTitle for request-scoped MCP tools', () => {
  it('hides the internal server id and humanizes the tool name', () => {
    expect(getToolDisplayTitle('mcp-363de040-web_search_exa')).toBe('Web Search Exa')
  })
})

describe('getToolDisplayTitle for context management', () => {
  it('describes compaction in user-facing language', () => {
    expect(getToolDisplayTitle('context_compaction')).toBe('Summarizing context')
  })
})
