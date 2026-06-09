/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { FilePreviewSession } from '@/lib/copilot/request/session'
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
  it('starts a pending session keyed to the tool call', () => {
    const next = deriveFilePreviewSession(
      undefined,
      { previewPhase: 'file_preview_start', toolCallId: 'tool-1', toolName: 'workspace_file' },
      'stream-1',
      NOW
    )
    expect(next.status).toBe('pending')
    expect(next.id).toBe('tool-1')
    expect(next.previewVersion).toBe(0)
    expect(next.streamId).toBe('stream-1')
  })

  it('captures target identity (fileId, name, kind, operation)', () => {
    const next = deriveFilePreviewSession(
      session({ status: 'pending' }),
      {
        previewPhase: 'file_preview_target',
        toolCallId: 'tool-1',
        toolName: 'workspace_file',
        operation: 'append',
        target: { kind: 'file_id', fileId: 'file-9', fileName: 'deck.pptx' },
      },
      'stream-1',
      NOW
    )
    expect(next.fileId).toBe('file-9')
    expect(next.targetKind).toBe('file_id')
    expect(next.operation).toBe('append')
    expect(next.status).toBe('pending')
  })

  it('appends delta content and advances the version monotonically when none supplied', () => {
    const prev = session({ previewText: 'slide one', previewVersion: 2 })
    const next = deriveFilePreviewSession(
      prev,
      {
        previewPhase: 'file_preview_content',
        toolCallId: 'tool-1',
        toolName: 'workspace_file',
        content: ' slide two',
        contentMode: 'delta',
        fileName: 'deck.pptx',
      },
      'stream-1',
      NOW
    )
    expect(next.status).toBe('streaming')
    expect(next.previewText).toBe('slide one slide two')
    expect(next.previewVersion).toBe(3)
  })

  it('appends delta content and uses the supplied version verbatim', () => {
    const prev = session({ previewText: 'slide one', previewVersion: 2 })
    const next = deriveFilePreviewSession(
      prev,
      {
        previewPhase: 'file_preview_content',
        toolCallId: 'tool-1',
        toolName: 'workspace_file',
        content: ' slide two',
        contentMode: 'delta',
        previewVersion: 9,
        fileName: 'deck.pptx',
      },
      'stream-1',
      NOW
    )
    expect(next.previewText).toBe('slide one slide two')
    expect(next.previewVersion).toBe(9)
  })

  it('replaces text on a snapshot and carries forward prior fileId', () => {
    const prev = session({ previewText: 'old', fileId: 'file-9', previewVersion: 4 })
    const next = deriveFilePreviewSession(
      prev,
      {
        previewPhase: 'file_preview_content',
        toolCallId: 'tool-1',
        toolName: 'workspace_file',
        content: 'fresh snapshot',
        contentMode: 'snapshot',
        previewVersion: 5,
        fileName: 'deck.pptx',
      },
      undefined,
      NOW
    )
    expect(next.previewText).toBe('fresh snapshot')
    expect(next.fileId).toBe('file-9')
    expect(next.streamId).toBe('stream-1')
  })

  it('marks completion with completedAt and a resolved version', () => {
    const prev = session({ previewText: 'final', previewVersion: 7, fileId: 'file-9' })
    const next = deriveFilePreviewSession(
      prev,
      {
        previewPhase: 'file_preview_complete',
        toolCallId: 'tool-1',
        toolName: 'workspace_file',
        fileId: 'file-9',
      },
      'stream-1',
      NOW
    )
    expect(next.status).toBe('complete')
    expect(next.completedAt).toBe(NOW)
    expect(next.previewVersion).toBe(7)
    expect(next.fileId).toBe('file-9')
  })
})
