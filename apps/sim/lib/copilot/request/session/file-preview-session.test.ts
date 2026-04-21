/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createFilePreviewSession,
  sortFilePreviewSessions,
} from '@/lib/copilot/request/session/file-preview-session'

describe('file preview session helpers', () => {
  it('preserves baseContent when creating a preview session', () => {
    const session = createFilePreviewSession({
      streamId: 'stream-1',
      toolCallId: 'preview-1',
      fileName: 'draft.md',
      baseContent: 'existing content',
    })

    expect(session.baseContent).toBe('existing content')
  })

  it('sorts preview sessions by updatedAt across tool call ids', () => {
    const sessions = sortFilePreviewSessions([
      createFilePreviewSession({
        streamId: 'stream-1',
        toolCallId: 'preview-2',
        fileName: 'b.md',
        previewVersion: 10,
        updatedAt: '2026-04-10T00:00:02.000Z',
      }),
      createFilePreviewSession({
        streamId: 'stream-1',
        toolCallId: 'preview-1',
        fileName: 'a.md',
        previewVersion: 1,
        updatedAt: '2026-04-10T00:00:01.000Z',
      }),
    ])

    expect(sessions.map((session) => session.id)).toEqual(['preview-1', 'preview-2'])
  })
})
