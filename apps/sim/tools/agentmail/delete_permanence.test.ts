/**
 * @vitest-environment node
 *
 * AgentMail's `DELETE /v0/inboxes/{inbox_id}/threads/{thread_id}` declares exactly three
 * parameters — `inbox_id`, `thread_id`, `Authorization` — and its description reads
 * "Permanently deletes a thread and all of its messages."
 *
 * There is no `permanent` query parameter, so a `?permanent=` we appended was inert and the
 * block's "No (move to trash)" default told the user the opposite of what the request did.
 * These pin that no delete request carries a phantom parameter and that the editor no longer
 * offers a non-permanent choice.
 */
import { describe, expect, it } from 'vitest'
import { AgentMailBlock } from '@/blocks/blocks/agentmail'
import { agentmailDeleteDraftTool } from '@/tools/agentmail/delete_draft'
import { agentmailDeleteInboxTool } from '@/tools/agentmail/delete_inbox'
import { agentmailDeleteThreadTool } from '@/tools/agentmail/delete_thread'
import type { ToolConfig } from '@/tools/types'

function buildUrl(tool: ToolConfig<any, any>, params: Record<string, unknown>): string {
  const url = tool.request.url
  return typeof url === 'function' ? url(params as never) : url
}

const INBOX = 'yourinbox@agentmail.to'
const THREAD = 'thread_01HQ8ZK4N2XW9V'

describe('agentmail delete tools carry no phantom parameters', () => {
  it('never appends a `permanent` query parameter, whatever the caller passes', () => {
    for (const extra of [{}, { permanent: true }, { permanent: false }, { permanent: 'true' }]) {
      const url = new URL(
        buildUrl(agentmailDeleteThreadTool, { inboxId: INBOX, threadId: THREAD, ...extra })
      )
      expect(url.searchParams.has('permanent')).toBe(false)
      expect(url.search).toBe('')
    }
  })

  it('produces the byte-identical URL today`s legitimate call produced, minus the phantom param', () => {
    expect(buildUrl(agentmailDeleteThreadTool, { inboxId: INBOX, threadId: THREAD })).toBe(
      `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(INBOX)}/threads/${THREAD}`
    )
  })

  it('does not declare a `permanent` tool param', () => {
    expect(Object.keys(agentmailDeleteThreadTool.params)).not.toContain('permanent')
  })

  it('leaves the sibling delete tools query-free', () => {
    expect(
      new URL(buildUrl(agentmailDeleteDraftTool, { inboxId: INBOX, draftId: 'd_1' })).search
    ).toBe('')
    expect(new URL(buildUrl(agentmailDeleteInboxTool, { inboxId: INBOX })).search).toBe('')
  })

  it('describes thread deletion as permanent and irreversible', () => {
    expect(agentmailDeleteThreadTool.description.toLowerCase()).toContain('permanent')
    expect(agentmailDeleteThreadTool.description.toLowerCase()).not.toContain('trash')
  })
})

describe('the AgentMail block offers no non-permanent delete option', () => {
  const permanentSubBlock = AgentMailBlock.subBlocks.find((sub) => sub.id === 'permanent')

  it('no longer renders a selectable control for `permanent`', () => {
    if (!permanentSubBlock) return
    expect(permanentSubBlock.type).toBe('text')
    expect(permanentSubBlock).not.toHaveProperty('options')
  })

  it('states plainly that the deletion cannot be undone', () => {
    if (!permanentSubBlock) return
    const content = String(permanentSubBlock.defaultValue ?? '').toLowerCase()
    expect(content).toContain('permanent')
    expect(content).toContain('cannot be undone')
  })

  it('never forwards a `permanent` value to the tool', () => {
    const transform = AgentMailBlock.tools.config!.params!
    const resolved = transform({
      operation: 'delete_thread',
      inboxId: INBOX,
      threadId: THREAD,
      permanent: 'false',
    } as never) as Record<string, unknown>

    expect(resolved).not.toHaveProperty('permanent')
  })

  it('does not declare `permanent` as a block input', () => {
    expect(Object.keys(AgentMailBlock.inputs)).not.toContain('permanent')
  })
})
