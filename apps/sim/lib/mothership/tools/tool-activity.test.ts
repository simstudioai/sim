/**
 * @vitest-environment node
 */
import { isRecordLike } from '@sim/utils/object'
import { describe, expect, it } from 'vitest'
import { TOOL_CATALOG } from '@/lib/mothership/generated/tool-catalog-v1'
import { CLI_TOOL_TITLES } from '@/lib/mothership/tools/cli-tool-display'
import { isToolHiddenInUi } from '@/lib/mothership/tools/client/hidden-tools'
import {
  getToolActivitySummaryActions,
  readToolActivity,
  TOOL_ACTIVITIES,
} from '@/lib/mothership/tools/tool-activity'

/** One call's summary phrase, read through the public summary API. */
function getToolActivityLabel(toolName: string, params?: Record<string, unknown>): string {
  return getToolActivitySummaryActions([{ toolName, params }], 1)[0]
}

import { TOOL_ICONS } from '@/app/workspace/[workspaceId]/home/components/message-content/utils'

const visibleTools = Object.values(TOOL_CATALOG).filter(
  (tool) => tool.route !== 'subagent' && !tool.hidden && !isToolHiddenInUi(tool.id)
)

describe('tool icon catalog coverage', () => {
  it('covers subagent icons under their dispatch and stream names', () => {
    for (const tool of Object.values(TOOL_CATALOG)) {
      if (tool.route !== 'subagent') continue
      expect(Object.hasOwn(TOOL_ICONS, tool.id), tool.id).toBe(true)
      if (tool.subagentId) {
        expect(Object.hasOwn(TOOL_ICONS, tool.subagentId), tool.subagentId).toBe(true)
      }
    }
  })

  it.each(visibleTools)('provides an icon for visible tool $id', (tool) => {
    expect(Object.hasOwn(TOOL_ICONS, tool.id), `${tool.id} icon`).toBe(true)
  })
})

describe('activity argument streaming', () => {
  const activity = {
    id: 'inputs',
    title: 'Checking {invoice} inputs',
    completedTitle: 'Checked {invoice} inputs',
  }
  const input = JSON.stringify({ activity, args: ['workflows', 'get'] })
  it('waits for a complete activity object but not the rest of the tool arguments', () => {
    const end = input.indexOf('},"args"') + 1
    for (let index = 0; index < end; index++)
      expect(readToolActivity(undefined, input.slice(0, index))).toBeUndefined()
    expect(readToolActivity(undefined, input.slice(0, end))).toEqual(activity)
    expect(readToolActivity({ activity })).toEqual(activity)
  })
  it('ignores nested business arguments and quoted content named activity', () => {
    expect(readToolActivity(undefined, JSON.stringify({ arguments: { activity } }))).toBeUndefined()
    expect(
      readToolActivity(undefined, JSON.stringify({ code: JSON.stringify({ activity }) }))
    ).toBeUndefined()
    expect(
      readToolActivity(undefined, JSON.stringify({ arguments: { activity }, activity }))
    ).toEqual(activity)
  })
  it('does not mistake an unrelated tool title or malformed activity for an intent', () => {
    expect(readToolActivity({ title: 'Invoice API' })).toBeUndefined()
    expect(readToolActivity({ activity: { title: 'Checking' } })).toBeUndefined()
    expect(readToolActivity({ activity })).toEqual(activity)
    expect(readToolActivity(undefined, '{"activity":{"title":"Checking",oops}')).toBeUndefined()
  })
  it('retains both labels and accepts historical completion-only or identity-only metadata', () => {
    expect(readToolActivity({ activity })).toEqual(activity)
    expect(
      readToolActivity({ activity: { id: 'inputs', completedTitle: activity.completedTitle } })
    ).toEqual({
      id: 'inputs',
      completedTitle: activity.completedTitle,
    })
    expect(readToolActivity({ activity: { id: 'inputs' } })).toEqual({ id: 'inputs' })
  })
  it('preserves escaped quotes and braces in streamed labels', () => {
    const escaped = {
      id: 'quoted',
      title: 'Checking "invoice" inputs',
      completedTitle: 'Checked {invoice} inputs',
    }
    expect(readToolActivity(undefined, JSON.stringify({ activity: escaped }))).toEqual(escaped)
  })
})

describe('tool activity catalog coverage', () => {
  it.each(visibleTools)('explicitly describes $id and every declared operation', (tool) => {
    expect(Object.hasOwn(TOOL_ACTIVITIES, tool.id), `${tool.id} summary`).toBe(true)
    const activity = TOOL_ACTIVITIES[tool.id]
    const properties = isRecordLike(tool.parameters) ? tool.parameters.properties : undefined
    if (!isRecordLike(properties)) return
    for (const parameter of ['operation', 'action'] as const) {
      const schema = properties[parameter]
      if (!isRecordLike(schema) || !Array.isArray(schema.enum)) continue
      expect(typeof activity, `${tool.id}.${parameter}`).toBe('object')
      if (typeof activity === 'string' || !('parameter' in activity)) continue
      expect(activity.parameter).toBe(parameter)
      expect(Object.keys(activity.operations).sort()).toEqual([...schema.enum].sort())
      if (typeof schema.default === 'string') {
        expect(activity.defaultOperation).toBe(schema.default)
      }
      for (const operation of schema.enum) {
        expect(getToolActivityLabel(tool.id, { [parameter]: operation })).not.toMatch(
          /^used (tools|the browser)$/
        )
      }
    }
  })

  /** `sim_cli` is the placeholder before a command is named; its own title describes it. */
  it.each(Object.keys(CLI_TOOL_TITLES).filter((name) => name !== 'sim_cli'))(
    'describes CLI tool %s with a concrete action',
    (name) => {
      expect(getToolActivityLabel(name)).not.toMatch(/^used (tools|the browser)$/)
    }
  )
})

describe('getToolActivityLabel', () => {
  it.each([
    ['browser_go_back', 'navigated pages'],
    ['browser_batch', 'ran page actions'],
    ['run_code', 'ran code'],
    ['call_integration_tool', 'used integrations'],
    ['terminal_run', 'ran commands'],
    ['cli_tables_list', 'listed tables'],
    ['cli_tables_rows_query', 'queried table rows'],
    ['cli_files_set_content', 'wrote files'],
    ['cli_knowledge_search', 'searched knowledge bases'],
    ['cli_workflows_deploy', 'deployed workflows'],
    ['cli_workflows_runs_get', 'checked workflow runs'],
    ['cli_workflows_rollback', 'rolled back workflows'],
    ['cli_workflow_mcp_servers_tools_create', 'published workflow MCP tools'],
    ['cli_settings_workspace_update', 'updated settings'],
    ['cli_workspaces_create', 'created workspaces'],
    ['cli_help', 'read the CLI reference'],
    ['cli_files_mkdir', 'created file folders'],
    ['cli_knowledge_mkdir', 'created knowledge folders'],
    ['cli_tables_mkdir', 'created table folders'],
    ['cli_workflows_mkdir', 'created workflow folders'],
    ['cli_tables_upsert', 'wrote table rows'],
  ])('describes %s as %s', (toolName, expected) => {
    expect(getToolActivityLabel(toolName)).toBe(expected)
  })

  it.each([
    ['terminal', 'handoff', 'handed over terminal control'],
    ['table_rows', 'batch_insert_rows', 'added rows'],
    ['manage_knowledge_base', 'query', 'searched sources'],
    ['prepare_file_edit', 'create', 'prepared file edits'],
  ])('describes %s %s accurately', (toolName, operation, expected) => {
    expect(getToolActivityLabel(toolName, { operation })).toBe(expected)
  })

  it.each(['future_operation', '', null, 4, [], {}, 'constructor', 'toString', '__proto__'])(
    'uses neutral fallbacks for invalid or unknown operations: %j',
    (operation) => {
      expect(getToolActivityLabel('terminal', { operation })).toBe('used the terminal')
      expect(getToolActivityLabel('deploy_as_api', { action: operation })).toBe('used deployments')
    }
  )

  it.each(['future_tool', '', 'constructor', 'toString', '__proto__', 'cli_future_command'])(
    'keeps unknown or historical tool %s safe without a title',
    (toolName) => {
      expect(getToolActivityLabel(toolName)).toBe('used tools')
    }
  )
})

describe('getToolActivitySummaryActions', () => {
  it('orders distinct actions by first occurrence and stops at the limit', () => {
    expect(
      getToolActivitySummaryActions(
        [
          { toolName: 'grep' },
          { toolName: 'read' },
          { toolName: 'grep' },
          { toolName: 'web_search' },
          { toolName: 'run_code' },
        ],
        3
      )
    ).toEqual(['searched files', 'read files', 'searched the web'])
  })

  it('shares an object only between adjacent chosen phrases', () => {
    expect(
      getToolActivitySummaryActions(
        [{ toolName: 'cli_tables_list' }, { toolName: 'cli_tables_get' }, { toolName: 'read' }],
        3
      )
    ).toEqual(['listed', 'read tables', 'read files'])
    expect(
      getToolActivitySummaryActions(
        [{ toolName: 'cli_tables_list' }, { toolName: 'read' }, { toolName: 'cli_tables_get' }],
        3
      )
    ).toEqual(['listed tables', 'read files', 'read tables'])
  })

  it('names the folder a CLI mkdir creates and shares it with other folder actions', () => {
    expect(
      getToolActivitySummaryActions(
        [{ toolName: 'cli_files_mkdir' }, { toolName: 'cli_files_folders_list' }],
        3
      )
    ).toEqual(['created', 'listed file folders'])
    expect(
      getToolActivitySummaryActions(
        [{ toolName: 'cli_tables_upsert' }, { toolName: 'cli_tables_rows_list' }],
        3
      )
    ).toEqual(['wrote', 'listed table rows'])
  })

  it('prefers a model description over the title for tools outside the catalog', () => {
    expect(
      getToolActivitySummaryActions(
        [
          {
            toolName: 'mcp-crm-sync_accounts',
            displayTitle: 'Sync accounts',
            activityDescription: 'Syncing CRM accounts',
          },
        ],
        3
      )
    ).toEqual(['synced CRM accounts'])
  })
})
