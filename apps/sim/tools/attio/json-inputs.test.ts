import { describe, expect, it } from 'vitest'
import { attioCreateWebhookTool } from '@/tools/attio/create_webhook'
import { attioQueryListEntriesTool } from '@/tools/attio/query_list_entries'
import { attioUpdateTaskTool } from '@/tools/attio/update_task'

function bodyOf<P>(tool: { request: { body?: (params: P) => unknown } }, params: P): unknown {
  return tool.request.body?.(params)
}

describe('Attio JSON inputs', () => {
  it('rejects malformed assignees instead of clearing every assignee on the task', () => {
    expect(() =>
      bodyOf(attioUpdateTaskTool, { accessToken: 't', taskId: 'task-1', assignees: '[{bad' })
    ).toThrow('Invalid JSON provided for assignees')
  })

  it('rejects a malformed filter instead of returning every list entry', () => {
    expect(() =>
      bodyOf(attioQueryListEntriesTool, { accessToken: 't', list: 'list-1', filter: '{bad' })
    ).toThrow('Invalid JSON provided for filter')
  })

  it('rejects malformed subscriptions instead of creating a webhook with none', () => {
    expect(() =>
      bodyOf(attioCreateWebhookTool, {
        accessToken: 't',
        targetUrl: 'https://example.com/hook',
        subscriptions: '[{bad',
      })
    ).toThrow('Invalid JSON provided for subscriptions')
  })
})
