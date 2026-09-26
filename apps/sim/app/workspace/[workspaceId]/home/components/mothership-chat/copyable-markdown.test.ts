import { describe, expect, it } from 'vitest'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { toCopyableMarkdown } from '@/app/workspace/[workspaceId]/home/components/mothership-chat/copyable-markdown'
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

  it('keeps an organization resource owner so the pasted chip still resolves', () => {
    const message = `See <workspace_resource>${JSON.stringify({
      workspaceId: 'sales',
      type: 'table',
      id: 'table-1',
      title: 'Accounts',
    })}</workspace_resource>.`

    const [link] = parseChipLinks(toCopyableMarkdown(message))

    expect(link).toMatchObject({ kind: 'table', id: 'table-1', workspaceId: 'sales' })
  })

  it('copies unresolved file references as plain text', () => {
    const message =
      'Read <workspace_resource>{"type":"file","path":"files/Q1 plan).md","title":"Q1 plan).md"}</workspace_resource>.'

    const markdown = toCopyableMarkdown(message)

    expect(markdown).toBe('Read Q1 plan).md.')
    expect(parseChipLinks(markdown)).toEqual([])
  })
})
