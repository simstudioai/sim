import { describe, expect, it } from 'vitest'
import type { FilePreviewSession } from '@/lib/mothership/request/session'
import { deriveFilePreviewSession } from './apply-file-preview-phase'

const NOW = '2026-06-08T00:00:00.000Z'

function session(overrides: Partial<FilePreviewSession>): FilePreviewSession {
  return {
    schemaVersion: 1,
    id: 'tool-1',
    streamId: 'stream-1',
    toolCallId: 'tool-1',
    status: 'streaming',
    fileName: 'deck.pptx',
    previewText: '',
    previewVersion: 1,
    updatedAt: NOW,
    ...overrides,
  }
}

describe('deriveFilePreviewSession', () => {
  it('ignores a re-delivered delta (same version) — no double-append (the duplication bug)', () => {
    const prev = session({ previewText: 'the story so far.', previewVersion: 7 })
    const replay = deriveFilePreviewSession(
      prev,
      {
        previewPhase: 'file_preview_content',
        toolCallId: 'tool-1',
        toolName: 'workspace_file',
        content: ' the story so far.',
        contentMode: 'delta',
        previewVersion: 7, // <= prev.previewVersion → a replay, must not re-append
        fileName: 'deck.pptx',
      },
      'stream-1',
      NOW
    )
    expect(replay.previewText).toBe('the story so far.')
    expect(replay.previewVersion).toBe(7)
  })

  it('ignores a replayed older snapshot — no regression of accumulated text', () => {
    const prev = session({ previewText: 'full accumulated body', previewVersion: 12 })
    const stale = deriveFilePreviewSession(
      prev,
      {
        previewPhase: 'file_preview_content',
        toolCallId: 'tool-1',
        toolName: 'workspace_file',
        content: 'earlier partial',
        contentMode: 'snapshot',
        previewVersion: 5, // stale replay
        fileName: 'deck.pptx',
      },
      'stream-1',
      NOW
    )
    expect(stale.previewText).toBe('full accumulated body')
    expect(stale.previewVersion).toBe(12)
  })

  it('re-processing the SAME delta stream N times yields the content exactly once', () => {
    // Simulates a client re-render/re-subscribe replaying the stream: the accumulated text must be stable.
    const deltas = [
      { v: 1, c: 'A' },
      { v: 2, c: 'B' },
      { v: 3, c: 'C' },
    ]
    const run = (start: FilePreviewSession | undefined) =>
      deltas.reduce<FilePreviewSession | undefined>(
        (acc, d) =>
          deriveFilePreviewSession(
            acc,
            {
              previewPhase: 'file_preview_content',
              toolCallId: 'tool-1',
              toolName: 'workspace_file',
              content: d.c,
              contentMode: 'delta',
              previewVersion: d.v,
              fileName: 'deck.pptx',
            },
            'stream-1',
            NOW
          ),
        start
      )
    const first = run(undefined)
    expect(first?.previewText).toBe('ABC')
    const second = run(first) // replay the exact same events
    expect(second?.previewText).toBe('ABC') // NOT 'ABCABC'
    const third = run(second)
    expect(third?.previewText).toBe('ABC')
  })
})
