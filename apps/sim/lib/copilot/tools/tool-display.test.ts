/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  FfmpegOperationValues,
  ManageKnowledgeBaseOperationValues,
  QueryUserTableOperationValues,
  SaveUploadOperationValues,
  SearchKnowledgeBaseOperationValues,
  TOOL_CATALOG,
  type ToolCatalogEntry,
  UserTableOperationValues,
} from '@/lib/copilot/generated/tool-catalog-v1'
import { getHiddenToolNames } from '@/lib/copilot/tools/client/hidden-tools'
import {
  getToolCompletedTitle,
  getToolDisplayTitle,
  getToolStatusDisplayTitle,
  getWaitCountdownTitle,
  humanizeToolName,
  mvDisplayVerb,
} from '@/lib/copilot/tools/tool-display'

function representativeToolArgs(entry: ToolCatalogEntry): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  if (!entry.parameters || typeof entry.parameters !== 'object') return args
  const properties = (entry.parameters as { properties?: unknown }).properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return args

  for (const [key, rawSchema] of Object.entries(properties)) {
    if (!rawSchema || typeof rawSchema !== 'object' || Array.isArray(rawSchema)) continue
    const schema = rawSchema as { default?: unknown; enum?: unknown; type?: unknown }
    if (schema.default !== undefined) {
      args[key] = schema.default
    } else if (Array.isArray(schema.enum) && schema.enum.length > 0) {
      args[key] = schema.enum[0]
    } else if (schema.type === 'boolean') {
      args[key] = true
    } else if (schema.type === 'object') {
      args[key] = {}
    }
  }
  return args
}

function toolPropertyEnum(entry: ToolCatalogEntry, property: string): unknown[] {
  if (!entry.parameters || typeof entry.parameters !== 'object') return []
  const properties = (entry.parameters as { properties?: unknown }).properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return []
  const schema = (properties as Record<string, unknown>)[property]
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return []
  const values = (schema as { enum?: unknown }).enum
  return Array.isArray(values) ? values : []
}

describe('humanizeToolName', () => {
  it('title-cases snake_case names', () => {
    expect(humanizeToolName('manage_custom_tool')).toBe('Manage Custom Tool')
  })

  it('title-cases kebab-case names', () => {
    expect(humanizeToolName('read-oauth-integrations')).toBe('Read OAuth Integrations')
  })

  it('keeps canonical acronym casing', () => {
    expect(humanizeToolName('create_workspace_mcp_server')).toBe('Create Workspace MCP Server')
    expect(humanizeToolName('deploy_as_api')).toBe('Deploy As API')
    expect(humanizeToolName('oauth_request_access')).toBe('OAuth Request Access')
  })
})

describe('getToolDisplayTitle natural-language coverage', () => {
  it('gives gerund titles to tools that previously fell through to humanize', () => {
    expect(getToolDisplayTitle('deploy_as_api')).toBe('Deploying as API')
    expect(getToolDisplayTitle('list_workspace_mcp_servers')).toBe('Listing MCP servers')
    expect(getToolDisplayTitle('oauth_get_auth_link')).toBe('Creating sign-in link')
    expect(getToolDisplayTitle('diff_workflows')).toBe('Comparing workflows')
    expect(getToolDisplayTitle('get_enterprise_context')).toBe('Checking enterprise access')
  })

  it('includes the query in search_docs titles', () => {
    expect(getToolDisplayTitle('search_docs')).toBe('Searching Sim docs')
    expect(getToolDisplayTitle('search_docs', { query: 'loop blocks iteration' })).toBe(
      'Searching Sim docs for "loop blocks iteration"'
    )
    expect(
      getToolCompletedTitle(
        getToolDisplayTitle('search_docs', { query: 'how to read workflow logs' })
      )
    ).toBe('Searched Sim docs for "how to read workflow logs"')
    expect(
      getToolDisplayTitle('search_docs', {
        query:
          'reference block outputs connection tags blockname.field pass data between blocks in a workflow',
      })?.length
    ).toBeLessThanOrEqual('Searching Sim docs for ""'.length + 32 + '...'.length)
  })

  it('falls back to running code for run_function without a title', () => {
    expect(getToolDisplayTitle('run_function')).toBe('Running code')
    expect(getToolDisplayTitle('run_function', { title: 'Crunching numbers' })).toBe(
      'Crunching numbers'
    )
  })

  it('has an intentional display title for every visible catalog tool', () => {
    const hiddenToolNames = getHiddenToolNames()
    const fallbackToolNames = Object.keys(TOOL_CATALOG).filter(
      (name) => !hiddenToolNames.has(name) && getToolDisplayTitle(name) === humanizeToolName(name)
    )

    expect(fallbackToolNames).toEqual([])
  })

  it('has a completed-verb rewrite for every visible non-agent catalog tool', () => {
    const hiddenToolNames = getHiddenToolNames()
    const missingCompletedVerbs = Object.entries(TOOL_CATALOG).flatMap(([name, entry]) => {
      if (entry.internal || hiddenToolNames.has(name)) return []
      const title = getToolDisplayTitle(name, representativeToolArgs(entry))
      return getToolCompletedTitle(title) ? [] : [`${name}: ${title}`]
    })

    expect(missingCompletedVerbs).toEqual([])
  })

  it('resolves every catalog action and operation enum without a generic placeholder', () => {
    const genericPlaceholders = new Set([
      'Managing credential',
      'Managing custom tool',
      'Editing file',
      'Folder action',
      'Managing MCP server',
      'Managing knowledge base',
      'Managing table',
      'Preparing file',
      'Processing media',
      'Managing skill',
    ])
    const unresolvedVariants: string[] = []

    for (const [name, entry] of Object.entries(TOOL_CATALOG)) {
      for (const property of ['action', 'operation']) {
        for (const value of toolPropertyEnum(entry, property)) {
          const title = getToolDisplayTitle(name, {
            ...representativeToolArgs(entry),
            [property]: value,
            title: 'resource',
          })
          if (genericPlaceholders.has(title) || !getToolCompletedTitle(title)) {
            unresolvedVariants.push(`${name}.${property}=${String(value)}: ${title}`)
          }
        }
      }
    }

    expect(unresolvedVariants).toEqual([])
  })
})

describe('getToolDisplayTitle for deployments', () => {
  it.each([
    ['deploy_as_api', undefined, 'Deploying as API'],
    ['deploy_as_api', { action: 'deploy' }, 'Deploying as API'],
    ['deploy_as_api', { action: 'undeploy' }, 'Undeploying as API'],
    ['deploy_as_chat', { action: 'deploy' }, 'Deploying as chat'],
    ['deploy_as_chat', { action: 'undeploy' }, 'Undeploying as chat'],
    ['publish_custom_block', { action: 'deploy' }, 'Publishing custom block'],
    ['publish_custom_block', { action: 'undeploy' }, 'Unpublishing custom block'],
    ['deploy_as_mcp', undefined, 'Deploying as MCP tool'],
    ['redeploy', undefined, 'Redeploying API'],
  ])('uses the action and deployment type for %s', (toolName, args, expected) => {
    expect(getToolDisplayTitle(toolName, args)).toBe(expected)
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
    expect(getToolCompletedTitle('Undeploying as API')).toBe('Undeployed as API')
    expect(getToolCompletedTitle('Duplicating workflow')).toBe('Duplicated workflow')
    expect(getToolCompletedTitle('Viewing custom tools')).toBe('Viewed custom tools')
    expect(getToolCompletedTitle('Saving report.pdf')).toBe('Saved report.pdf')
  })

  it('returns undefined for non-gerund titles', () => {
    expect(getToolCompletedTitle('Run Agent')).toBeUndefined()
    expect(getToolCompletedTitle('Folder action')).toBeUndefined()
    expect(getToolCompletedTitle('Custom title from the model')).toBeUndefined()
  })

  it('projects a terminal tense for every settled row, present tense only while running', () => {
    expect(getToolStatusDisplayTitle('Comparing workflows', 'success')).toBe('Compared workflows')
    expect(getToolStatusDisplayTitle('Comparing workflows', 'executing')).toBe(
      'Comparing workflows'
    )
    // An errored row must not read as still running — the frozen present-tense
    // title ("Searching for X" forever) was reported as a stuck tool call.
    expect(getToolStatusDisplayTitle('Comparing workflows', 'error')).toBe(
      'Failed comparing workflows'
    )
    expect(getToolStatusDisplayTitle('Searching for admin mentions', 'error')).toBe(
      'Failed searching for admin mentions'
    )
    expect(getToolStatusDisplayTitle('Comparing workflows', 'cancelled')).toBe(
      'Stopped comparing workflows'
    )
    // Non-gerund titles get a prefix rather than a bad rewrite.
    expect(getToolStatusDisplayTitle('Read recent emails', 'error')).toBe(
      'Failed: Read recent emails'
    )
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
      getToolDisplayTitle('create_empty_file', {
        outputs: {
          files: [{ path: 'files/Reports/Quarterly%20Report.pdf', mode: 'create' }],
        },
      })
    ).toBe('Creating Quarterly Report.pdf')
    expect(getToolDisplayTitle('create_empty_file', { fileName: 'notes.md' })).toBe(
      'Creating notes.md'
    )
    expect(
      getToolDisplayTitle('create_empty_file', {
        outputs: { files: [{ path: 'files/notes.md', mode: 'overwrite' }] },
      })
    ).toBe('Overwriting notes.md')
    expect(getToolDisplayTitle('create_empty_file')).toBe('Creating file')
  })

  it('titles rm from toolTitle, falling back to the paths', () => {
    expect(getToolDisplayTitle('rm', { toolTitle: 'Old Report.pdf' })).toBe(
      'Deleting Old Report.pdf'
    )
    // rm spans categories, so with no toolTitle the paths are the only signal.
    expect(
      getToolDisplayTitle('rm', {
        paths: ['files/Old%20Reports', 'files/Drafts'],
      })
    ).toBe('Deleting Old Reports and Drafts')
    expect(
      getToolDisplayTitle('rm', {
        paths: ['workflows/Lead%20Router'],
      })
    ).toBe('Deleting Lead Router')
    // rm has no TOOL_TITLES entry (its case always returns), so a bare call
    // must not fall through to the humanizer and render as "Rm".
    expect(getToolDisplayTitle('rm', {})).toBe('Deleting resource')
    expect(getToolDisplayTitle('rm')).toBe('Deleting resource')
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
      getToolDisplayTitle('rm', {
        paths: ['workflows/Lead%20Router', 'workflows/Lead%20Enricher'],
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
    ['manage_mcp_connection', { operation: 'edit', config: { name: 'Linear' } }, 'Updating Linear'],
    ['manage_skill', { operation: 'delete', name: 'sales-research' }, 'Deleting sales-research'],
    [
      'manage_credential',
      {
        operation: 'rename',
        previousDisplayName: 'Stripe',
        displayName: 'Production Stripe',
      },
      'Renaming Stripe to Production Stripe',
    ],
    ['rm', { paths: ['workflows/Marketing/Q3%20Campaigns'] }, 'Deleting Q3 Campaigns'],
    ['manage_custom_tool', { operation: 'list' }, 'Viewing custom tools'],
    ['manage_mcp_connection', { operation: 'list' }, 'Viewing MCP servers'],
    ['manage_skill', { operation: 'list' }, 'Viewing skills'],
  ])('uses verb + resource name for %s', (toolName, args, expected) => {
    expect(getToolDisplayTitle(toolName, args)).toBe(expected)
  })
})

describe('getToolDisplayTitle for operation-driven tools', () => {
  it('covers every FFmpeg operation with a specific activity', () => {
    for (const operation of FfmpegOperationValues) {
      expect(getToolDisplayTitle('ffmpeg', { operation })).not.toBe('Processing media')
    }
    expect(getToolDisplayTitle('ffmpeg', { operation: 'probe' })).toBe('Inspecting media')
    expect(getToolDisplayTitle('ffmpeg', { operation: 'extract_audio' })).toBe('Extracting audio')
  })

  it('covers every knowledge-base operation with its actual verb and resource', () => {
    for (const operation of ManageKnowledgeBaseOperationValues) {
      expect(getToolDisplayTitle('manage_knowledge_base', { operation })).not.toBe(
        'Managing knowledge base'
      )
    }
    expect(getToolDisplayTitle('manage_knowledge_base', { operation: 'query' })).toBe(
      'Searching knowledge base'
    )
    expect(
      getToolDisplayTitle('manage_knowledge_base', {
        operation: 'query',
        args: { query: 'volvo delivery process' },
      })
    ).toBe('Searching knowledge base for volvo delivery process')
    expect(getToolDisplayTitle('manage_knowledge_base', { operation: 'sync_connector' })).toBe(
      'Syncing knowledge base connector'
    )
  })

  it('covers every read-only table and knowledge-base operation', () => {
    for (const operation of QueryUserTableOperationValues) {
      expect(getToolDisplayTitle('query_user_table', { operation })).not.toBe('Query User Table')
    }
    for (const operation of SearchKnowledgeBaseOperationValues) {
      expect(getToolDisplayTitle('search_knowledge_base', { operation })).not.toBe(
        'Search Knowledge Base'
      )
    }
    expect(getToolDisplayTitle('query_user_table', { operation: 'get_schema' })).toBe(
      'Reading table schema'
    )
    expect(getToolDisplayTitle('search_knowledge_base', { operation: 'list_tags' })).toBe(
      'Listing knowledge base tags'
    )
  })

  it('covers every table operation with a specific activity', () => {
    for (const operation of UserTableOperationValues) {
      expect(getToolDisplayTitle('user_table', { operation })).not.toBe('Managing table')
    }
    expect(
      getToolDisplayTitle('user_table', {
        operation: 'rename_column',
        args: { columnName: 'status', newName: 'stage' },
      })
    ).toBe('Renaming column status to stage')
    expect(getToolDisplayTitle('user_table', { operation: 'cancel_table_runs' })).toBe(
      'Cancelling table runs'
    )
  })

  it('distinguishes saving uploads from importing workflows', () => {
    for (const operation of SaveUploadOperationValues) {
      expect(
        getToolDisplayTitle('save_upload', { operation, fileNames: ['Lead Router.json'] })
      ).not.toBe('Preparing file')
    }
    expect(
      getToolDisplayTitle('save_upload', {
        operation: 'save',
        fileNames: ['Quarterly Report.pdf'],
      })
    ).toBe('Saving Quarterly Report.pdf')
    expect(
      getToolDisplayTitle('save_upload', {
        operation: 'import',
        fileNames: ['Lead Router.json'],
      })
    ).toBe('Importing Lead Router.json')
  })

  it('uses boolean and resource-type arguments where they change the action', () => {
    expect(getToolDisplayTitle('set_block_enabled', { enabled: true })).toBe('Enabling block')
    expect(getToolDisplayTitle('set_block_enabled', { enabled: false })).toBe('Disabling block')
    expect(getToolDisplayTitle('restore_resource', { type: 'knowledgebase' })).toBe(
      'Restoring knowledge base'
    )
  })

  it('includes deployment versions when available', () => {
    expect(getToolDisplayTitle('load_deployment', { version: 'live' })).toBe(
      'Loading live deployment'
    )
    expect(getToolDisplayTitle('load_deployment', { version: '5' })).toBe(
      'Loading deployment version 5'
    )
    expect(getToolDisplayTitle('promote_to_live', { version: 5 })).toBe(
      'Promoting version 5 to live'
    )
    expect(getToolDisplayTitle('update_deployment_version', { version: 5 })).toBe(
      'Updating deployment version 5'
    )
  })

  it('uses the integration, variable scope, and nested variable operations', () => {
    expect(getToolDisplayTitle('list_integration_tools', { integration: 'google_sheets' })).toBe(
      'Listing Google Sheets tools'
    )
    expect(getToolDisplayTitle('set_environment_variables', { scope: 'personal' })).toBe(
      'Setting personal environment variables'
    )
    expect(
      getToolDisplayTitle('set_global_workflow_variables', {
        operations: [{ operation: 'delete', name: 'OLD_URL' }],
      })
    ).toBe('Deleting workflow variable OLD_URL')
    expect(
      getToolDisplayTitle('set_global_workflow_variables', {
        operations: [
          { operation: 'add', name: 'API_URL' },
          { operation: 'edit', name: 'TIMEOUT' },
        ],
      })
    ).toBe('Updating 2 workflow variables')
  })
})

describe('getToolDisplayTitle for request-scoped MCP tools', () => {
  it('hides the internal server id and humanizes the tool name', () => {
    expect(getToolDisplayTitle('mcp-363de040-web_search_exa')).toBe('Web Search Exa')
    expect(getToolDisplayTitle('mcp-363de040-read-oauth-integrations')).toBe(
      'Read OAuth Integrations'
    )
  })
})

describe('getToolDisplayTitle for context management', () => {
  it('describes compaction in user-facing language', () => {
    expect(getToolDisplayTitle('context_compaction')).toBe('Summarizing context')
    expect(getToolStatusDisplayTitle('Summarizing context', 'success')).toBe('Summarized context')
  })
})

describe('getToolStatusDisplayTitle for browser takeover', () => {
  it('uses a neutral completed title after browser control resumes', () => {
    expect(
      getToolStatusDisplayTitle(
        'Waiting for you: Pick a match in the draw',
        'success',
        'browser_request_takeover'
      )
    ).toBe('Resumed browser control')
  })
})

describe('wait titles', () => {
  // The row is on screen for the whole pause, so a bare "Wait" reads as a
  // stall. The duration is the entire content of this tool.
  it('names the duration it is pausing for', () => {
    expect(getToolDisplayTitle('wait', { seconds: 30 })).toBe('Waiting 30s')
  })

  it('includes the reason when the model gives one', () => {
    expect(getToolDisplayTitle('wait', { seconds: 15, reason: 'the test suite to finish' })).toBe(
      'Waiting 15s for the test suite to finish'
    )
  })

  it('degrades to a bare verb rather than printing a bogus duration', () => {
    expect(getToolDisplayTitle('wait', {})).toBe('Waiting')
    expect(getToolDisplayTitle('wait', { seconds: 0 })).toBe('Waiting')
    expect(getToolDisplayTitle('wait', { seconds: 'soon' })).toBe('Waiting')
  })

  it('rounds a fractional duration instead of showing decimals', () => {
    expect(getToolDisplayTitle('wait', { seconds: 2.4 })).toBe('Waiting 2s')
  })

  it('reads as past tense once the pause is over', () => {
    expect(getToolCompletedTitle('Waiting 30s')).toBe('Waited 30s')
    expect(getToolCompletedTitle('Waiting 15s for the test suite to finish')).toBe(
      'Waited 15s for the test suite to finish'
    )
  })
})

describe('terminal titles', () => {
  const call = (operation: string, args?: Record<string, unknown>) =>
    getToolDisplayTitle('terminal', { operation, ...(args ? { args } : {}) })

  it('names the command being run', () => {
    expect(call('run', { command: 'bun test' })).toBe('Running bun test')
  })

  it('titles each operation rather than reading as a bare "Terminal"', () => {
    expect(call('read')).toBe('Reading terminal')
    expect(call('input')).toBe('Typing into terminal')
    expect(call('kill')).toBe('Stopping command')
    expect(call('list')).toBe('Listing terminals')
    expect(call('new')).toBe('Opening terminal')
    expect(call('panes')).toBe('Listing tmux panes')
  })

  it('collapses newlines so a multi-line command stays one row', () => {
    expect(call('run', { command: 'cd apps/sim\n  bun test' })).toBe('Running cd apps/sim bun test')
  })

  it('truncates a long command rather than wrapping the row', () => {
    const title = call('run', { command: 'echo '.repeat(40) })
    expect(title.length).toBeLessThanOrEqual('Running '.length + 48)
    expect(title.endsWith('…')).toBe(true)
  })

  it('falls back to a generic label before the arguments have streamed in', () => {
    expect(call('run')).toBe('Running command')
    expect(getToolDisplayTitle('terminal', {})).toBe('Using terminal')
  })

  it('names what the user has to do when the terminal is handed over', () => {
    expect(call('handoff', { reason: 'Enter your sudo password' })).toBe(
      'Waiting for you: Enter your sudo password'
    )
    expect(call('handoff')).toBe('Waiting for you in the terminal')
  })

  it('still titles rows from before the tools were consolidated', () => {
    // Persisted transcripts reference the old one-tool-per-operation names.
    expect(getToolDisplayTitle('terminal_run', { command: 'bun test' })).toBe('Running bun test')
    expect(getToolDisplayTitle('terminal_read')).toBe('Reading terminal')
  })

  it('reads as past tense once each terminal action settles', () => {
    expect(getToolCompletedTitle('Running bun test')).toBe('Ran bun test')
    expect(getToolCompletedTitle('Stopping command')).toBe('Stopped command')
    expect(getToolCompletedTitle('Reading terminal')).toBe('Read terminal')
    expect(getToolCompletedTitle('Using terminal')).toBe('Used terminal')
  })
})

describe('wait countdown', () => {
  const args = { seconds: 30, reason: 'Claude Code to finish the summary' }

  it('starts at the full duration', () => {
    expect(getWaitCountdownTitle(args, 0)).toBe('Waiting 30s for Claude Code to finish the summary')
  })

  it('counts down as the pause runs', () => {
    expect(getWaitCountdownTitle(args, 5_000)).toBe(
      'Waiting 25s for Claude Code to finish the summary'
    )
    expect(getWaitCountdownTitle(args, 29_000)).toBe(
      'Waiting 1s for Claude Code to finish the summary'
    )
  })

  it('holds a whole second rather than ticking on partial ones', () => {
    expect(getWaitCountdownTitle(args, 999)).toBe(getWaitCountdownTitle(args, 0))
    expect(getWaitCountdownTitle(args, 1_001)).toBe(getWaitCountdownTitle(args, 1_999))
  })

  it('drops the number at zero instead of freezing on "0s"', () => {
    // The row can outlive its own countdown while the turn picks back up, and
    // a stuck "0s" reads as broken.
    expect(getWaitCountdownTitle(args, 30_000)).toBe(
      'Waiting for Claude Code to finish the summary'
    )
    expect(getWaitCountdownTitle(args, 90_000)).toBe(
      'Waiting for Claude Code to finish the summary'
    )
  })

  it('never counts up from a clock that jumped backwards', () => {
    expect(getWaitCountdownTitle(args, -5_000)).toBe(
      'Waiting 30s for Claude Code to finish the summary'
    )
  })

  it('stays a bare verb when there is no duration to count', () => {
    expect(getWaitCountdownTitle({}, 3_000)).toBe('Waiting')
  })

  it('matches the static title at zero elapsed', () => {
    expect(getWaitCountdownTitle(args, 0)).toBe(getToolDisplayTitle('wait', args))
  })
})

describe('opaque id suppression', () => {
  const uuid = '5bae7849-ffa5-4f57-984f-feab73e513df'

  it('falls back to the generic label instead of printing a workflow id', () => {
    expect(getToolDisplayTitle('run_workflow', { workflowName: uuid })).toBe('Running workflow')
    expect(getToolDisplayTitle('run_workflow', { name: uuid })).toBe('Running workflow')
    expect(getToolDisplayTitle('cancel_workflow_run', { executionId: uuid })).toBe(
      'Cancelling workflow run'
    )
  })

  it('suppresses a bare-hex id too', () => {
    expect(getToolDisplayTitle('run_workflow', { name: 'a'.repeat(32) })).toBe('Running workflow')
  })

  it('still shows real names, including id-adjacent ones', () => {
    expect(getToolDisplayTitle('run_workflow', { workflowName: 'Elder v1' })).toBe(
      'Running Elder v1'
    )
    expect(getToolDisplayTitle('run_workflow', { workflowName: 'GoogleSheets_v2Block' })).toBe(
      'Running GoogleSheets_v2Block'
    )
  })

  it('degrades a block-id fallback rather than leaking it', () => {
    expect(getToolDisplayTitle('run_block', { blockId: uuid })).toBe('Running block')
  })
})

describe('terminal-title projection is idempotent', () => {
  // The client tool store phrases its own error/skip labels, so the render
  // boundary must not project a second time onto them.
  const storeErrorLabel = 'Attempted to read metadata for thread_tracking'
  const storeSkipLabel = 'Skipped reading metadata for thread_tracking'

  it('leaves a store-phrased error label alone instead of prefixing it', () => {
    expect(getToolStatusDisplayTitle(storeErrorLabel, 'error')).toBe(storeErrorLabel)
    expect(getToolStatusDisplayTitle(storeErrorLabel, 'rejected')).toBe(storeErrorLabel)
  })

  it('never stacks a second Failed prefix', () => {
    const once = getToolStatusDisplayTitle('Reading table', 'error')
    expect(once).toBe('Failed reading table')
    expect(getToolStatusDisplayTitle(once, 'error')).toBe(once)
    expect(getToolStatusDisplayTitle('Failed: Something', 'error')).toBe('Failed: Something')
  })

  it('leaves a store-phrased skip label alone when cancelled', () => {
    expect(getToolStatusDisplayTitle(storeSkipLabel, 'aborted')).toBe(storeSkipLabel)
    const stopped = getToolStatusDisplayTitle('Reading table', 'cancelled')
    expect(stopped).toBe('Stopped reading table')
    expect(getToolStatusDisplayTitle(stopped, 'cancelled')).toBe(stopped)
  })

  it('still projects an ordinary present-tense title', () => {
    expect(getToolStatusDisplayTitle('Searching Sim docs', 'error')).toBe(
      'Failed searching Sim docs'
    )
    expect(getToolStatusDisplayTitle('Running workflow', 'cancelled')).toBe(
      'Stopped running workflow'
    )
  })
})

describe('resource-naming titles', () => {
  it('names the table a row/column operation targets', () => {
    expect(
      getToolDisplayTitle('table_rows', { operation: 'insert_row', tableName: 'Runtimes' })
    ).toBe('Adding rows to Runtimes')
    expect(
      getToolDisplayTitle('table_columns', {
        operation: 'add_column',
        columnName: 'status',
        tableName: 'Runtimes',
      })
    ).toBe('Adding column status in Runtimes')
    expect(
      getToolDisplayTitle('table_views', { operation: 'list_views', tableName: 'Runtimes' })
    ).toBe('Reading views of Runtimes')
  })

  it('matches the verb inside compound operation ids', () => {
    expect(
      getToolDisplayTitle('table_rows', { operation: 'batch_update_rows', tableName: 'Runtimes' })
    ).toBe('Updating rows in Runtimes')
    expect(
      getToolDisplayTitle('table_rows', {
        operation: 'delete_rows_by_filter',
        tableName: 'Runtimes',
      })
    ).toBe('Deleting rows in Runtimes')
    expect(
      getToolDisplayTitle('table_views', { operation: 'set_default_view', tableName: 'Runtimes' })
    ).toBe('Editing views of Runtimes')
  })

  it('falls back cleanly when the table is unnamed', () => {
    expect(getToolDisplayTitle('table_rows', { operation: 'update_row' })).toBe('Updating rows')
  })

  it('names the block behind a block-schema read', () => {
    expect(getToolDisplayTitle('read', { path: 'components/blocks/slack_v2.json' })).toBe(
      'Loading Slack'
    )
    expect(
      getToolDisplayTitle('read', { path: 'components/blocks/google_sheets_v2/README.md' })
    ).toBe('Loading Google Sheets tips')
  })

  it('shows the text a browser type/insert call sends', () => {
    expect(getToolDisplayTitle('browser_type', { text: 'hello there' })).toBe(
      'Typing "hello there"'
    )
    expect(getToolDisplayTitle('browser_insert_text', {})).toBe('Inserting text')
  })

  it('describes semantic browser controls without exposing element ids', () => {
    expect(getToolDisplayTitle('browser_find', { query: 'Submit order' })).toBe(
      'Finding "Submit order"'
    )
    expect(getToolDisplayTitle('browser_set_checked', { elementId: 42, checked: false })).toBe(
      'Unchecking control'
    )
    expect(getToolDisplayTitle('browser_wait_for', { elementId: 42, state: 'visible' })).toBe(
      'Waiting for element to be visible'
    )
    expect(getToolDisplayTitle('browser_zoom', { action: 'reset' })).toBe('Resetting page zoom')
    expect(getToolCompletedTitle('Unchecking control')).toBe('Unchecked control')
    expect(getToolCompletedTitle('Changing page zoom')).toBe('Changed page zoom')
  })

  it('names downloads, docs searches, and generated files', () => {
    expect(getToolDisplayTitle('download_file', { fileName: 'report.csv' })).toBe(
      'Downloading report.csv'
    )
    expect(
      getToolDisplayTitle('search_library_docs', { library_name: 'React', query: 'useEffect' })
    ).toBe('Searching React docs for useEffect')
    expect(getToolDisplayTitle('generate_image', { path: 'files/hero.png' })).toBe(
      'Generating hero.png'
    )
  })
})
