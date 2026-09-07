/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildPreviewContentUpdate } from '@/lib/copilot/request/go/file-preview-adapter'
import type { FilePreviewSession } from '@/lib/copilot/request/session/file-preview-session-contract'
import { deriveFilePreviewSession } from '@/app/workspace/[workspaceId]/home/hooks/preview/apply-file-preview-phase'

const CHECKPOINT_MS = 1_000

/**
 * Producer -> consumer round trip for an `append` preview.
 *
 * `buildPreviewContentUpdate` decides snapshot vs delta; `deriveFilePreviewSession` is
 * the only thing in the app that reads `contentMode`. Emitting deltas instead of a full
 * snapshot per chunk is only safe if replaying what the producer emits reconstructs the
 * text exactly — this drives the real functions against each other and checks that,
 * rather than reasoning about it.
 */
function roundTrip(
  chunks: string[],
  base: string,
  msPerChunk: number
): { rendered: string; expected: string; snapshots: number; deltas: number } {
  let lastEmitted = ''
  let lastSnapshotAt = 0
  let now = 0
  let streamed = ''
  let session: FilePreviewSession | undefined
  let version = 0
  let snapshots = 0
  let deltas = 0

  for (const chunk of chunks) {
    streamed += chunk
    now += msPerChunk
    const nextText = base.length > 0 ? `${base}\n${streamed}` : streamed
    const update = buildPreviewContentUpdate(lastEmitted, nextText, lastSnapshotAt, now, 'append')
    lastEmitted = nextText
    lastSnapshotAt = update.lastSnapshotAt
    version += 1
    if (update.contentMode === 'snapshot') snapshots++
    else deltas++

    session = deriveFilePreviewSession(
      session,
      {
        previewPhase: 'file_preview_content',
        content: update.content,
        contentMode: update.contentMode,
        previewVersion: version,
        toolCallId: 'tc_1',
        toolName: 'prepare_file_edit',
        fileName: 'notes.md',
        operation: 'append',
      } as never,
      'stream_1',
      new Date(now).toISOString()
    )
  }

  return {
    rendered: session?.previewText ?? '',
    expected: base.length > 0 ? `${base}\n${streamed}` : streamed,
    snapshots,
    deltas,
  }
}

function chunksOf(text: string, size: number): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out
}

describe('append preview round trip', () => {
  it('reconstructs the exact text the user should see, and does it with deltas', () => {
    const base = 'Existing file body.\nSecond line.'
    const r = roundTrip(chunksOf('The appended paragraph goes here.', 4), base, 20)

    expect(r.rendered).toBe(r.expected)
    expect(r.deltas).toBeGreaterThan(0)
  })

  it('holds for realistic token-scale chunking on a large base file', () => {
    const base = 'x'.repeat(250 * 1024)
    const r = roundTrip(chunksOf('y'.repeat(4096), 10), base, 20)

    expect(r.rendered).toBe(r.expected)
    expect(r.rendered.length).toBe(250 * 1024 + 1 + 4096)
  })

  it('still emits a recoverable full snapshot on the checkpoint interval', () => {
    // One chunk per 400ms crosses the 1s checkpoint repeatedly.
    const r = roundTrip(chunksOf('abcdefghij', 1), 'base', 400)

    expect(r.rendered).toBe(r.expected)
    expect(r.snapshots).toBeGreaterThan(1)
    expect(r.snapshots * CHECKPOINT_MS).toBeGreaterThan(0)
  })

  it('recovers exactly when the base file changes underneath the stream', () => {
    // A divergent base must fall back to a snapshot, not a delta on stale text.
    const first = buildPreviewContentUpdate('Old base\nabc', 'New base\nabcd', 100, 200, 'append')
    expect(first.contentMode).toBe('snapshot')
    expect(first.content).toBe('New base\nabcd')

    const session = deriveFilePreviewSession(
      undefined,
      {
        previewPhase: 'file_preview_content',
        content: first.content,
        contentMode: first.contentMode,
        previewVersion: 1,
        toolCallId: 'tc_1',
        toolName: 'prepare_file_edit',
        fileName: 'notes.md',
        operation: 'append',
      } as never,
      'stream_1',
      new Date().toISOString()
    )
    expect(session.previewText).toBe('New base\nabcd')
  })

  it('ignores a replayed event rather than double-appending its delta', () => {
    const base = 'Base.'
    const chunks = chunksOf('hello world', 3)
    let lastEmitted = ''
    let lastSnapshotAt = 0
    let now = 0
    let streamed = ''
    let session: FilePreviewSession | undefined
    let version = 0
    const emitted: Array<{ content: string; contentMode: string; version: number }> = []

    for (const chunk of chunks) {
      streamed += chunk
      now += 20
      const u = buildPreviewContentUpdate(
        lastEmitted,
        `${base}\n${streamed}`,
        lastSnapshotAt,
        now,
        'append'
      )
      lastEmitted = `${base}\n${streamed}`
      lastSnapshotAt = u.lastSnapshotAt
      version += 1
      emitted.push({ content: u.content, contentMode: u.contentMode, version })
    }

    // Deliver every event twice, out of order for the duplicates.
    for (const e of [...emitted, ...emitted]) {
      session = deriveFilePreviewSession(
        session,
        {
          previewPhase: 'file_preview_content',
          content: e.content,
          contentMode: e.contentMode,
          previewVersion: e.version,
          toolCallId: 'tc_1',
          toolName: 'prepare_file_edit',
          fileName: 'notes.md',
          operation: 'append',
        } as never,
        'stream_1',
        new Date().toISOString()
      )
    }

    expect(session?.previewText).toBe(`${base}\n${streamed}`)
  })
})
