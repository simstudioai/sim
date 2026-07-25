/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  FfmpegOperationValues,
  KnowledgeBaseOperationValues,
  MaterializeFileOperationValues,
  QueryUserTableOperationValues,
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
    expect(humanizeToolName('manage_folder')).toBe('Manage Folder')
  })

  it('title-cases kebab-case names', () => {
    expect(humanizeToolName('read-oauth-integrations')).toBe('Read OAuth Integrations')
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
      'Credential action',
      'Custom tool action',
      'Editing file',
      'Folder action',
      'MCP server action',
      'Managing knowledge base',
      'Managing table',
      'Preparing file',
      'Processing media',
      'Scheduled task action',
      'Skill action',
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
    ['deploy_api', undefined, 'Deploying API'],
    ['deploy_api', { action: 'deploy' }, 'Deploying API'],
    ['deploy_api', { action: 'undeploy' }, 'Undeploying API'],
    ['deploy_chat', { action: 'deploy' }, 'Deploying chat'],
    ['deploy_chat', { action: 'undeploy' }, 'Undeploying chat'],
    ['deploy_custom_block', { action: 'deploy' }, 'Deploying custom block'],
    ['deploy_custom_block', { action: 'undeploy' }, 'Undeploying custom block'],
    ['deploy_mcp', undefined, 'Deploying MCP tool'],
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
    expect(getToolCompletedTitle('Undeploying API')).toBe('Undeployed API')
    expect(getToolCompletedTitle('Duplicating workflow')).toBe('Duplicated workflow')
    expect(getToolCompletedTitle('Viewing custom tools')).toBe('Viewed custom tools')
    expect(getToolCompletedTitle('Saving report.pdf')).toBe('Saved report.pdf')
  })

  it('returns undefined for non-gerund titles', () => {
    expect(getToolCompletedTitle('Run Agent')).toBeUndefined()
    expect(getToolCompletedTitle('Folder action')).toBeUndefined()
    expect(getToolCompletedTitle('Custom title from the model')).toBeUndefined()
  })

  it('projects completed titles only for successful rows', () => {
    expect(getToolStatusDisplayTitle('Comparing workflows', 'success')).toBe('Compared workflows')
    expect(getToolStatusDisplayTitle('Comparing workflows', 'executing')).toBe(
      'Comparing workflows'
    )
    expect(getToolStatusDisplayTitle('Comparing workflows', 'error')).toBe('Comparing workflows')
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
    expect(
      getToolDisplayTitle('create_file', {
        outputs: { files: [{ path: 'files/notes.md', mode: 'overwrite' }] },
      })
    ).toBe('Overwriting notes.md')
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

describe('getToolDisplayTitle for operation-driven tools', () => {
  it('covers every FFmpeg operation with a specific activity', () => {
    for (const operation of FfmpegOperationValues) {
      expect(getToolDisplayTitle('ffmpeg', { operation })).not.toBe('Processing media')
    }
    expect(getToolDisplayTitle('ffmpeg', { operation: 'probe' })).toBe('Inspecting media')
    expect(getToolDisplayTitle('ffmpeg', { operation: 'extract_audio' })).toBe('Extracting audio')
  })

  it('covers every knowledge-base operation with its actual verb and resource', () => {
    for (const operation of KnowledgeBaseOperationValues) {
      expect(getToolDisplayTitle('knowledge_base', { operation })).not.toBe(
        'Managing knowledge base'
      )
    }
    expect(getToolDisplayTitle('knowledge_base', { operation: 'query' })).toBe(
      'Searching knowledge base'
    )
    expect(getToolDisplayTitle('knowledge_base', { operation: 'sync_connector' })).toBe(
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
    for (const operation of MaterializeFileOperationValues) {
      expect(
        getToolDisplayTitle('materialize_file', { operation, fileNames: ['Lead Router.json'] })
      ).not.toBe('Preparing file')
    }
    expect(
      getToolDisplayTitle('materialize_file', {
        operation: 'save',
        fileNames: ['Quarterly Report.pdf'],
      })
    ).toBe('Saving Quarterly Report.pdf')
    expect(
      getToolDisplayTitle('materialize_file', {
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
    expect(getToolDisplayTitle('open_resource', { resources: [{ type: 'scheduledtask' }] })).toBe(
      'Opening scheduled task'
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
