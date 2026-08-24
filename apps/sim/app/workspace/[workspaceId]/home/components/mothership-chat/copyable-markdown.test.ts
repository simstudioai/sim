import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  prepareCopyableMarkdown,
  toCopyableMarkdown,
} from '@/app/workspace/[workspaceId]/home/components/mothership-chat/copyable-markdown'
import { parseChipLinks } from '@/app/workspace/[workspaceId]/home/components/user-input/components/chip-clipboard-codec'

const WORKSPACE_FILES: WorkspaceFileRecord[] = [
  {
    id: 'file_bell',
    workspaceId: 'workspace-1',
    name: 'The Bell at Low Tide.md',
    key: 'workspace/workspace-1/file_bell',
    path: '/api/files/view/file_bell',
    size: 0,
    type: 'text/markdown',
    uploadedBy: 'user-1',
    uploadedAt: new Date(0),
    updatedAt: new Date(0),
  },
]

describe('toCopyableMarkdown', () => {
  it('preserves message Markdown, including fenced code and its language', () => {
    const message = [
      '# Elevator diagnosis',
      '',
      'The bug is in `dispatch_legacy.py`:',
      '',
      '```python',
      'def next_stop(requests, current):',
      '    ranked = sorted(requests)',
      '    return ranked[1:]',
      '```',
      '',
      '**Result:** the closest request *was not* always selected.',
    ].join('\n')

    expect(toCopyableMarkdown(message)).toBe(message)
  })

  it('removes internal structured tags without flattening surrounding Markdown', () => {
    const message = [
      'Before **formatted text**.',
      '<credential>{"type":"service_account","provider":"gmail"}</credential>',
      'After [a link](https://example.com).',
    ].join('\n')

    expect(toCopyableMarkdown(message)).toBe(
      ['Before **formatted text**.', '', 'After [a link](https://example.com).'].join('\n')
    )
  })

  it('preserves tag-shaped text that the chat renders literally', () => {
    const message = [
      'Document `<credential>example</credential>`.',
      '',
      '```html',
      '<file>example</file>',
      '<question>example</question>',
      '```',
    ].join('\n')

    expect(toCopyableMarkdown(message)).toBe(message)
  })

  it('copies workspace resources as portable Markdown links with real ids', () => {
    const message = [
      'Read',
      '<workspace_resource>{"type":"file","path":"files/The%20Bell%20at%20Low%20Tide.md","title":"The Bell at Low Tide.md"}</workspace_resource>',
      'and',
      `<workspace_resource>${JSON.stringify({
        type: 'table',
        id: 'tbl_f26af6dae98d4222b014b250494d00fb',
        title: 'Checked_[rare]\\portal',
      })}</workspace_resource>.`,
    ].join('')

    const markdown = toCopyableMarkdown(message, WORKSPACE_FILES)

    expect(markdown).toBe(
      'Read [The Bell at Low Tide.md](sim:file/file_bell) and [Checked_\\[rare\\]\\\\portal](sim:table/tbl_f26af6dae98d4222b014b250494d00fb).'
    )
    expect(parseChipLinks(markdown)).toEqual([
      {
        kind: 'file',
        id: 'file_bell',
        label: 'The Bell at Low Tide.md',
        start: 5,
        end: 50,
      },
      {
        kind: 'table',
        id: 'tbl_f26af6dae98d4222b014b250494d00fb',
        label: 'Checked_[rare]\\portal',
        start: 55,
        end: 129,
      },
    ])
  })

  it('uses resolved file metadata for a resource without a title', () => {
    const message =
      'Read <workspace_resource>{"type":"file","path":"files/The%20Bell%20at%20Low%20Tide.md"}</workspace_resource>.'

    expect(toCopyableMarkdown(message, WORKSPACE_FILES)).toBe(
      'Read [The Bell at Low Tide.md](sim:file/file_bell).'
    )
  })

  it('refreshes missing file metadata before producing copyable Markdown', async () => {
    const message =
      'Read <workspace_resource>{"type":"file","path":"files/The%20Bell%20at%20Low%20Tide.md","title":"The Bell at Low Tide.md"}</workspace_resource>.'
    const refreshWorkspaceFiles = vi.fn().mockResolvedValue(WORKSPACE_FILES)

    const content = prepareCopyableMarkdown(message, [], refreshWorkspaceFiles)
    expect(content).not.toBeTypeOf('string')
    if (typeof content === 'string') throw new Error('Expected deferred clipboard content')
    expect(content.fallback).toBe('Read The Bell at Low Tide.md.')
    expect(parseChipLinks(content.fallback)).toEqual([])
    await expect(content.prepare()).resolves.toBe(
      'Read [The Bell at Low Tide.md](sim:file/file_bell).'
    )
    expect(refreshWorkspaceFiles).toHaveBeenCalledOnce()
  })

  it('copies unresolved file references as plain text', () => {
    const message =
      'Read <workspace_resource>{"type":"file","path":"files/Q1 plan).md","title":"Q1 plan).md"}</workspace_resource>.'

    const markdown = toCopyableMarkdown(message)

    expect(markdown).toBe('Read Q1 plan).md.')
    expect(parseChipLinks(markdown)).toEqual([])
  })

  it('keeps the plain-text fallback when refreshing file metadata fails', async () => {
    const message =
      'Read <workspace_resource>{"type":"file","path":"files/notes.md","title":"notes.md"}</workspace_resource>.'
    const refreshWorkspaceFiles = vi.fn().mockRejectedValue(new Error('Refresh failed'))

    const content = prepareCopyableMarkdown(message, [], refreshWorkspaceFiles)

    expect(content).not.toBeTypeOf('string')
    if (typeof content === 'string') throw new Error('Expected deferred clipboard content')
    expect(content.fallback).toBe('Read notes.md.')
    await expect(content.prepare()).resolves.toBe('Read notes.md.')
    expect(refreshWorkspaceFiles).toHaveBeenCalledOnce()
  })

  it('does not refresh metadata when all workspace resources already resolve', () => {
    const message =
      'Read <workspace_resource>{"type":"file","path":"files/The%20Bell%20at%20Low%20Tide.md","title":"The Bell at Low Tide.md"}</workspace_resource>.'
    const refreshWorkspaceFiles = vi.fn()

    expect(prepareCopyableMarkdown(message, WORKSPACE_FILES, refreshWorkspaceFiles)).toBe(
      'Read [The Bell at Low Tide.md](sim:file/file_bell).'
    )
    expect(refreshWorkspaceFiles).not.toHaveBeenCalled()
  })
})
