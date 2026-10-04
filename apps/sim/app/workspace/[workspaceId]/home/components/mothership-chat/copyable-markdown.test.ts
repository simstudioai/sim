import { describe, expect, it } from 'vitest'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  prepareCopyableMarkdown,
  toCopyableMarkdown,
} from '@/app/workspace/[workspaceId]/home/components/mothership-chat/copyable-markdown'
import {
  chipLinkToContext,
  parseChipLinks,
  serializeSelectionForClipboard,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components/chip-clipboard-codec'

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

describe('Project file references through clipboard Markdown', () => {
  it('preserves the explicit Project when copying a prompt chip and pasting it back', () => {
    const original = {
      kind: 'file' as const,
      fileId: 'project-file',
      label: 'Architecture_[draft]',
      owner: { entityType: 'project' as const, entityId: 'project/with spaces' },
    }
    const markdown = serializeSelectionForClipboard('@Architecture_[draft]', [original])
    const links = parseChipLinks(markdown)
    expect(links).toHaveLength(1)
    expect(chipLinkToContext(links[0])).toEqual(original)
    expect(markdown).toContain('?project=project%2Fwith%20spaces')
  })

  it('copies the assistant Project reference without resolving a same-name workspace file', () => {
    const reference = {
      type: 'file',
      id: 'project-file',
      title: 'The Bell at Low Tide.md',
      owner: { entityType: 'project', entityId: 'project-1' },
    }
    const message = `See <workspace_resource>${JSON.stringify(reference)}</workspace_resource>.`
    const markdown = prepareCopyableMarkdown(message, WORKSPACE_FILES, async () => {
      throw new Error('Project references must not load workspace files')
    })
    expect(typeof markdown).toBe('string')
    if (typeof markdown !== 'string') throw new Error('Project reference was unresolved')
    const [link] = parseChipLinks(markdown)
    expect(chipLinkToContext(link)).toEqual({
      kind: 'file',
      fileId: 'project-file',
      label: 'The Bell at Low Tide.md',
      owner: { entityType: 'project', entityId: 'project-1' },
    })
  })

  it.each([
    { type: 'file', id: 'file_bell', workspaceId: 'workspace-1' },
    { type: 'table', id: 'table-1' },
    { type: 'file', path: 'files/The%20Bell%20at%20Low%20Tide.md' },
  ])('does not turn an invalid Project reference into a workspace chip: %j', (target) => {
    const message = `<workspace_resource>${JSON.stringify({
      ...target,
      title: 'The Bell at Low Tide.md',
      owner: { entityType: 'project', entityId: 'project-1' },
    })}</workspace_resource>`
    expect(parseChipLinks(toCopyableMarkdown(message, WORKSPACE_FILES))).toEqual([])
  })

  it.each([
    'sim:file/file-1?project=p&workspace=w',
    'sim:file/file-1?workspace=w&project=p',
    'sim:file/file-1?project=p&project=q',
    'sim:table/table-1?project=p',
    'sim:file/file-1?organization=o',
  ])('keeps ambiguous or unsupported portable ownership as plain text: %s', (address) => {
    expect(parseChipLinks(`[Resource](${address})`)).toEqual([])
  })
})
