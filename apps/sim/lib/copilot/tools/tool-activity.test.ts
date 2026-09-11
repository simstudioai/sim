/**
 * @vitest-environment node
 */
import { isRecordLike } from '@sim/utils/object'
import { describe, expect, it } from 'vitest'
import { TOOL_CATALOG } from '@/lib/copilot/generated/tool-catalog-v1'
import { isToolHiddenInUi } from '@/lib/copilot/tools/client/hidden-tools'
import { getToolActivityLabel, TOOL_ACTIVITIES } from '@/lib/copilot/tools/tool-activity'

const visibleTools = Object.values(TOOL_CATALOG).filter(
  (tool) => tool.route !== 'subagent' && !tool.hidden && !isToolHiddenInUi(tool.id)
)

describe('tool activity catalog coverage', () => {
  it.each(visibleTools)('explicitly describes $id and every declared operation', (tool) => {
    expect(Object.hasOwn(TOOL_ACTIVITIES, tool.id), tool.id).toBe(true)
    const activity = TOOL_ACTIVITIES[tool.id]
    const properties = isRecordLike(tool.parameters) ? tool.parameters.properties : undefined
    if (!isRecordLike(properties)) return
    for (const parameter of ['operation', 'action'] as const) {
      const schema = properties[parameter]
      if (!isRecordLike(schema) || !Array.isArray(schema.enum)) continue
      expect(typeof activity, `${tool.id}.${parameter}`).toBe('object')
      if (typeof activity === 'string') continue
      expect(activity.parameter).toBe(parameter)
      expect(Object.keys(activity.operations).sort()).toEqual([...schema.enum].sort())
      if (typeof schema.default === 'string') {
        expect(activity.defaultOperation).toBe(schema.default)
      }
      for (const operation of schema.enum) {
        expect(typeof operation).toBe('string')
        expect(getToolActivityLabel(tool.id, { [parameter]: operation })).not.toMatch(
          /^used (tools|the browser)$/
        )
      }
    }
  })
})

describe('getToolActivityLabel', () => {
  it.each([
    ['browser_go_back', 'navigated pages'],
    ['browser_go_forward', 'navigated pages'],
    ['browser_reload', 'navigated pages'],
    ['browser_wait_for', 'waited'],
    ['browser_list_sessions', 'checked signed-in sites'],
    ['browser_hover', 'hovered over elements'],
    ['browser_press_key', 'pressed keys'],
    ['run_block', 'ran workflows'],
    ['run_from_block', 'ran workflows'],
    ['redeploy', 'deployed workflows'],
    ['generate_image', 'generated images'],
    ['generate_audio', 'generated audio'],
    ['generate_video', 'generated video'],
    ['create_empty_file', 'created files'],
    ['cp', 'copied resources'],
    ['mv', 'moved resources'],
    ['rm', 'deleted resources'],
    ['terminal_run', 'ran commands'],
    ['terminal_read', 'read terminal output'],
    ['terminal_input', 'sent terminal input'],
  ])('describes %s as %s', (toolName, expected) => {
    expect(getToolActivityLabel(toolName)).toBe(expected)
  })

  it.each([
    ['terminal', 'read', 'read terminal output'],
    ['terminal', 'input', 'sent terminal input'],
    ['terminal', 'kill', 'stopped commands'],
    ['terminal', 'panes', 'listed terminal panes'],
    ['search_knowledge_base', 'get', 'read knowledge bases'],
    ['ffmpeg', 'probe', 'inspected media'],
    ['ffmpeg', 'trim', 'edited media'],
    ['query_user_table', 'query_rows', 'searched rows'],
    ['table_rows', 'batch_insert_rows', 'added rows'],
    ['table_rows', 'update_rows_by_filter', 'updated rows'],
    ['table_rows', 'delete_rows_by_filter', 'deleted rows'],
    ['table_manage', 'import_file', 'imported table data'],
    ['table_views', 'get_view', 'read table views'],
    ['table_views', 'update_view', 'edited table views'],
    ['table_automations', 'list_workflow_outputs', 'read table automations'],
    ['table_automations', 'run_column', 'ran table automations'],
    ['table_automations', 'cancel_table_runs', 'stopped table runs'],
    ['manage_knowledge_base', 'get', 'read knowledge bases'],
    ['manage_knowledge_base', 'query', 'searched sources'],
    ['manage_knowledge_base', 'update', 'updated knowledge bases'],
    ['manage_mcp_connection', 'list', 'read connections'],
    ['manage_mcp_connection', 'edit', 'edited connections'],
    ['manage_sandbox', 'list', 'read sandboxes'],
    ['manage_skill', 'list', 'read skills'],
    ['manage_custom_tool', 'list', 'read custom tools'],
    ['save_upload', 'import', 'imported workflows'],
    ['save_upload', 'extract', 'extracted files'],
  ])('describes %s %s accurately', (toolName, operation, expected) => {
    expect(getToolActivityLabel(toolName, { operation })).toBe(expected)
  })

  it.each(['deploy_as_api', 'deploy_as_chat', 'deploy_as_mcp'])(
    'distinguishes deploying and undeploying with %s',
    (toolName) => {
      expect(getToolActivityLabel(toolName)).toBe('deployed workflows')
      expect(getToolActivityLabel(toolName, { action: 'deploy' })).toBe('deployed workflows')
      expect(getToolActivityLabel(toolName, { action: 'undeploy' })).toBe('undeployed workflows')
    }
  )

  it('preserves default operations and distinguishes reversing published access', () => {
    expect(getToolActivityLabel('save_upload')).toBe('saved files')
    expect(getToolActivityLabel('share_file')).toBe('shared files')
    expect(getToolActivityLabel('share_file', { action: 'unshare' })).toBe('stopped sharing files')
    expect(getToolActivityLabel('publish_custom_block')).toBe('published custom blocks')
    expect(getToolActivityLabel('publish_custom_block', { action: 'undeploy' })).toBe(
      'unpublished custom blocks'
    )
  })

  it.each([
    'query_user_table',
    'table_manage',
    'table_rows',
    'table_columns',
    'table_automations',
    'table_enrichments',
  ])('keeps legacy combined table operations consistent with %s', (toolName) => {
    const activity = TOOL_ACTIVITIES[toolName]
    expect(typeof activity).toBe('object')
    if (typeof activity === 'string') return
    for (const operation of Object.keys(activity.operations)) {
      expect(getToolActivityLabel('user_table', { operation })).toBe(
        getToolActivityLabel(toolName, { operation })
      )
    }
  })

  it.each(['future_operation', '', null, 4, [], {}, 'constructor', 'toString', '__proto__'])(
    'uses neutral fallbacks for invalid or unknown operations: %j',
    (operation) => {
      expect(getToolActivityLabel('terminal', { operation })).toBe('used the terminal')
      expect(getToolActivityLabel('table_rows', { operation })).toBe('used tables')
      expect(getToolActivityLabel('deploy_as_api', { action: operation })).toBe('used deployments')
    }
  )

  it.each(['future_tool', '', 'constructor', 'toString', '__proto__'])(
    'keeps unknown/historical tool %s safe',
    (toolName) => {
      expect(getToolActivityLabel(toolName)).toBe('used tools')
    }
  )

  it('keeps unknown browser calls visible', () => {
    expect(getToolActivityLabel('browser_future_action')).toBe('used the browser')
  })
})
