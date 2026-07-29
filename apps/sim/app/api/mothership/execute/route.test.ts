import { describe, expect, it } from 'vitest'
import {
  buildExecuteResponsePayload,
  CALLER_VISIBLE_SERVER_TOOLS,
} from '@/app/api/mothership/execute/route'

type Payload = Parameters<typeof buildExecuteResponsePayload>[0]

function resultWithToolCalls(names: string[]): Payload {
  return { content: '', toolCalls: names.map((name) => ({ name })) } as unknown as Payload
}

describe('buildExecuteResponsePayload', () => {
  // The scheduled-task runner branches on whether the agent called
  // complete_scheduled_task (background/schedule-execution.ts reads
  // responseBody.toolCalls). This filter used to admit only integration tools
  // and mcp-*, so that check was permanently false: a job completed itself, the
  // signal was dropped here, and the runner's post-run bookkeeping wrote
  // status='active' with a fresh nextRunAt straight back over the completion —
  // the job then reran forever, each time telling the model it was done.
  it('keeps complete_scheduled_task so the schedule runner can see it', () => {
    const payload = buildExecuteResponsePayload(
      resultWithToolCalls(['complete_scheduled_task']),
      'chat-1',
      []
    )

    expect(payload.toolCalls.map((tc: { name: string }) => tc.name)).toContain(
      'complete_scheduled_task'
    )
  })

  it('still admits integration and mcp tool calls, and still drops other server tools', () => {
    const payload = buildExecuteResponsePayload(
      resultWithToolCalls(['gmail_send', 'mcp-notion-create', 'read', 'edit_workflow']),
      'chat-1',
      [{ name: 'gmail_send' }]
    )

    const names = payload.toolCalls.map((tc: { name: string }) => tc.name)
    expect(names).toEqual(['gmail_send', 'mcp-notion-create'])
  })

  // Guards the cross-file contract: the literal the runner greps for must be in
  // the allowlist above. These live in different files and nothing else ties
  // them together.
  it('exposes the exact tool name the schedule runner looks for', () => {
    expect(CALLER_VISIBLE_SERVER_TOOLS.has('complete_scheduled_task')).toBe(true)
  })
})
