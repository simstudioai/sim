/**
 * @vitest-environment node
 *
 * Attio tools accept several structured fields as JSON *strings*
 * (`linkedRecords`, `assignees`, `subscriptions`, `entryValues`, `filter`,
 * `sorts`, `workspaceMemberAccess`), all `visibility: 'user-or-llm'`.
 *
 * Each one used to swallow a `JSON.parse` failure and substitute a value the
 * caller never asked for — an empty `[]`/`{}`, or (in `create_list` /
 * `update_list`) the raw unparsed string into a field the API expects as an
 * array. The request was then sent and reported `success: true`, so an LLM
 * emitting slightly-off JSON had its input silently discarded while the caller
 * saw a success.
 *
 * `update_record` already had the right behavior — it throws
 * `Invalid JSON provided for record values`. These tests pin every sibling to
 * that precedent: malformed JSON throws, valid JSON still parses through
 * unchanged.
 */
import { describe, expect, it } from 'vitest'
import { attioCreateListTool } from '@/tools/attio/create_list'
import { attioCreateListEntryTool } from '@/tools/attio/create_list_entry'
import { attioCreateTaskTool } from '@/tools/attio/create_task'
import { attioCreateWebhookTool } from '@/tools/attio/create_webhook'
import { attioQueryListEntriesTool } from '@/tools/attio/query_list_entries'
import { attioUpdateListTool } from '@/tools/attio/update_list'
import { attioUpdateListEntryTool } from '@/tools/attio/update_list_entry'
import { attioUpdateTaskTool } from '@/tools/attio/update_task'
import { attioUpdateWebhookTool } from '@/tools/attio/update_webhook'
import type { ToolConfig } from '@/tools/types'

type AnyTool = ToolConfig<any, any>

const MALFORMED = "{'not': json}"

interface JsonParamCase {
  name: string
  tool: AnyTool
  param: string
  /** Other params the body builder needs to run to completion. */
  base: Record<string, unknown>
  /** A well-formed value for the field, as the caller would send it. */
  valid: unknown
  /** Pulls the field back out of the built body. */
  read: (body: any) => unknown
}

const CASES: JsonParamCase[] = [
  {
    name: 'update_task.linkedRecords',
    tool: attioUpdateTaskTool,
    param: 'linkedRecords',
    base: { taskId: 'task-1' },
    valid: [{ target_object: 'people', target_record_id: 'rec-1' }],
    read: (body) => body.data.linked_records,
  },
  {
    name: 'update_task.assignees',
    tool: attioUpdateTaskTool,
    param: 'assignees',
    base: { taskId: 'task-1' },
    valid: [{ referenced_actor_type: 'workspace-member', referenced_actor_id: 'wm-1' }],
    read: (body) => body.data.assignees,
  },
  {
    name: 'create_task.linkedRecords',
    tool: attioCreateTaskTool,
    param: 'linkedRecords',
    base: { content: 'Follow up' },
    valid: [{ target_object: 'people', target_record_id: 'rec-1' }],
    read: (body) => body.data.linked_records,
  },
  {
    name: 'create_task.assignees',
    tool: attioCreateTaskTool,
    param: 'assignees',
    base: { content: 'Follow up' },
    valid: [{ referenced_actor_type: 'workspace-member', referenced_actor_id: 'wm-1' }],
    read: (body) => body.data.assignees,
  },
  {
    name: 'update_webhook.subscriptions',
    tool: attioUpdateWebhookTool,
    param: 'subscriptions',
    base: { webhookId: 'wh-1' },
    valid: [{ event_type: 'record.created', filter: null }],
    read: (body) => body.data.subscriptions,
  },
  {
    name: 'create_webhook.subscriptions',
    tool: attioCreateWebhookTool,
    param: 'subscriptions',
    base: { targetUrl: 'https://example.com/hook' },
    valid: [{ event_type: 'record.created', filter: null }],
    read: (body) => body.data.subscriptions,
  },
  {
    name: 'update_list_entry.entryValues',
    tool: attioUpdateListEntryTool,
    param: 'entryValues',
    base: { list: 'leads', entryId: 'entry-1' },
    valid: { stage: [{ status: 'Contacted' }] },
    read: (body) => body.data.entry_values,
  },
  {
    name: 'create_list_entry.entryValues',
    tool: attioCreateListEntryTool,
    param: 'entryValues',
    base: { list: 'leads', parentRecordId: 'rec-1', parentObject: 'people' },
    valid: { stage: [{ status: 'Contacted' }] },
    read: (body) => body.data.entry_values,
  },
  {
    name: 'query_list_entries.filter',
    tool: attioQueryListEntriesTool,
    param: 'filter',
    base: { list: 'leads' },
    valid: { stage: 'Contacted' },
    read: (body) => body.filter,
  },
  {
    name: 'query_list_entries.sorts',
    tool: attioQueryListEntriesTool,
    param: 'sorts',
    base: { list: 'leads' },
    valid: [{ direction: 'asc', attribute: 'created_at' }],
    read: (body) => body.sorts,
  },
  {
    name: 'create_list.workspaceMemberAccess',
    tool: attioCreateListTool,
    param: 'workspaceMemberAccess',
    base: { name: 'Leads', parentObject: 'people' },
    valid: [{ workspace_member_id: 'wm-1', level: 'full-access' }],
    read: (body) => body.data.workspace_member_access,
  },
  {
    name: 'update_list.workspaceMemberAccess',
    tool: attioUpdateListTool,
    param: 'workspaceMemberAccess',
    base: { list: 'leads' },
    valid: [{ workspace_member_id: 'wm-1', level: 'full-access' }],
    read: (body) => body.data.workspace_member_access,
  },
]

function buildBody(testCase: JsonParamCase, value: unknown): any {
  const body = testCase.tool.request?.body
  if (typeof body !== 'function') {
    throw new Error(`${testCase.tool.id} has no body builder`)
  }
  return body({ ...testCase.base, [testCase.param]: value } as any)
}

describe('attio JSON parameter integrity', () => {
  describe.each(CASES)('$name', (testCase) => {
    it('throws on malformed JSON instead of substituting a value', () => {
      expect(() => buildBody(testCase, MALFORMED)).toThrow(/Invalid JSON provided for/)
    })

    it('does not send a substituted empty value', () => {
      let body: unknown
      try {
        body = buildBody(testCase, MALFORMED)
      } catch {
        return
      }
      throw new Error(
        `${testCase.name} silently substituted ${JSON.stringify(testCase.read(body))}`
      )
    })

    it('passes valid JSON through unchanged', () => {
      const body = buildBody(testCase, JSON.stringify(testCase.valid))

      expect(testCase.read(body)).toEqual(testCase.valid)
    })

    it('accepts an already-parsed value unchanged', () => {
      const body = buildBody(testCase, testCase.valid)

      expect(testCase.read(body)).toEqual(testCase.valid)
    })
  })
})

/** The precedent these fixes were matched to. */
describe('update_record precedent', () => {
  it('still throws the message the sweep copied', async () => {
    const { attioUpdateRecordTool } = await import('@/tools/attio/update_record')
    expect(() =>
      (attioUpdateRecordTool.request!.body as (p: any) => unknown)({
        objectType: 'people',
        recordId: 'rec-1',
        values: MALFORMED,
      })
    ).toThrow('Invalid JSON provided for record values')
  })
})
