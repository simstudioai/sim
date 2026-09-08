import { describe, expect, it } from 'vitest'
import {
  BROWSER_SESSION_RESOURCE_ID,
  TERMINAL_SESSION_RESOURCE_ID,
} from '@/lib/copilot/resources/types'
import type { AvailableItem } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/resource-folder-tree'
import { byResourceMenuOrder } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry'
import {
  buildMentionPreview,
  resourceMentionMatches,
  withDesktopTabMentions,
  withFolderMentions,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components/plus-menu-dropdown/resource-mention-items'

const groups = [
  { type: 'workflow' as const, items: [{ id: 'wf-1', name: 'Deploy' }] },
  {
    type: 'browser' as const,
    items: [{ id: BROWSER_SESSION_RESOURCE_ID, name: 'Browser' }],
  },
  {
    type: 'terminal' as const,
    items: [{ id: TERMINAL_SESSION_RESOURCE_ID, name: 'Terminal' }],
  },
]

describe('withDesktopTabMentions', () => {
  it('keeps Browser and Terminal as flat resource mentions with no live tabs', () => {
    const result = withDesktopTabMentions(groups, [], [])

    expect(result.find((group) => group.type === 'browser')?.items).toEqual([
      expect.objectContaining({
        id: BROWSER_SESSION_RESOURCE_ID,
        name: 'Browser',
        mentionLevel: 'resource',
      }),
    ])
    expect(result.find((group) => group.type === 'terminal')?.items).toEqual([
      expect.objectContaining({
        id: TERMINAL_SESSION_RESOURCE_ID,
        name: 'Terminal',
        mentionLevel: 'resource',
      }),
    ])
  })

  it('offers the whole resources first and every live tab after them', () => {
    const result = withDesktopTabMentions(
      groups,
      [
        {
          tabId: 'browser-1',
          title: 'Sim Docs',
          url: 'https://docs.sim.ai',
          loading: false,
          active: true,
          pinned: false,
        },
        {
          tabId: 'browser-2',
          title: '',
          url: 'https://github.com/simstudioai/sim',
          loading: false,
          active: false,
          pinned: false,
        },
      ],
      [
        {
          terminalId: 'terminal-1',
          title: 'sim',
          cwd: '/code/sim',
          running: null,
          interactive: false,
          active: true,
        },
        {
          terminalId: 'terminal-2',
          title: 'sim',
          cwd: '/tmp/sim',
          running: null,
          interactive: false,
          active: false,
        },
      ]
    )

    expect(result.find((group) => group.type === 'browser')?.items).toMatchObject([
      { id: BROWSER_SESSION_RESOURCE_ID, name: 'Browser', mentionLevel: 'resource' },
      { id: 'browser-1', name: 'Sim Docs', mentionLevel: 'tab' },
      { id: 'browser-2', name: 'github.com', mentionLevel: 'tab' },
    ])
    expect(result.find((group) => group.type === 'terminal')?.items).toMatchObject([
      { id: TERMINAL_SESSION_RESOURCE_ID, name: 'Terminal', mentionLevel: 'resource' },
      { id: 'terminal-1', name: 'sim 1', mentionLevel: 'tab' },
      { id: 'terminal-2', name: 'sim 2', mentionLevel: 'tab' },
    ])
  })

  it('keeps specific tabs discoverable by either their title or resource family', () => {
    const tab = {
      id: 'browser-1',
      name: 'Sim Docs',
      mentionFamily: 'Browser',
      mentionLevel: 'tab',
    }

    expect(resourceMentionMatches(tab, 'docs')).toBe(true)
    expect(resourceMentionMatches(tab, 'browser')).toBe(true)
    expect(resourceMentionMatches(tab, 'terminal')).toBe(false)
  })
})

describe('buildMentionPreview', () => {
  const item = (id: string): AvailableItem => ({ id, name: id })
  const many = (n: number) => Array.from({ length: n }, (_, i) => item(`i${i}`))

  it('caps each family so a large one cannot bury the families after it', () => {
    const preview = buildMentionPreview(
      [
        { type: 'integration', items: many(300) },
        { type: 'workflow', items: [item('thermal-field')] },
      ],
      () => 5
    )

    expect(preview.filter((c) => c.type === 'integration')).toHaveLength(5)
    expect(preview.map((c) => c.item.id)).toContain('thermal-field')
  })

  it('lets a family raise its own cap', () => {
    const preview = buildMentionPreview(
      [
        { type: 'integration', items: many(10) },
        { type: 'workflow', items: many(10) },
      ],
      (type) => (type === 'workflow' ? 2 : 5)
    )

    expect(preview.filter((c) => c.type === 'integration')).toHaveLength(5)
    expect(preview.filter((c) => c.type === 'workflow')).toHaveLength(2)
  })

  it('keeps families in the order they were given, so headings stay contiguous', () => {
    const preview = buildMentionPreview(
      [
        { type: 'integration', items: many(3) },
        { type: 'workflow', items: many(3) },
      ],
      () => 5
    )

    const boundaries = preview.filter((c, i) => i > 0 && preview[i - 1].type !== c.type)
    expect(boundaries).toHaveLength(1)
    expect(preview.at(-1)?.type).toBe('workflow')
  })

  it('keeps a family shorter than the cap intact', () => {
    const preview = buildMentionPreview([{ type: 'workflow', items: many(2) }], () => 5)
    expect(preview).toHaveLength(2)
  })
})

describe('byResourceMenuOrder', () => {
  it('places workflows before logs without changing the surrounding order', () => {
    const ordered = [
      { type: 'task', items: [{ id: 'chat-1', name: 'Glean migration' }] },
      { type: 'log', items: [{ id: 'log-1', name: 'Glean' }] },
      { type: 'workflow', items: [{ id: 'workflow-1', name: 'Glean' }] },
      { type: 'browser', items: [{ id: 'browser', name: 'Browser' }] },
    ].sort(byResourceMenuOrder)

    expect(ordered.map((group) => group.type)).toEqual(['task', 'workflow', 'log', 'browser'])
  })
})

describe('folder mentions', () => {
  it('includes nested and empty table and knowledge folders without changing the browse groups', () => {
    const source = [
      { type: 'folder' as const, items: [{ id: 'workflow-folder', name: 'Planning' }] },
    ]
    const result = withFolderMentions(source, {
      table: [{ id: 'table-folder', name: 'Planning', parentId: 'parent' }],
      knowledgebase: [{ id: 'kb-folder', name: 'Planning', parentId: null }],
    })
    expect(source[0].items).toHaveLength(1)
    expect(result[0].items.map((item) => item.id)).toEqual([
      'workflow-folder',
      'table-folder',
      'kb-folder',
    ])
    expect(
      result[0].items
        .filter((item) => resourceMentionMatches(item, 'table folders'))
        .map((item) => item.id)
    ).toEqual(['table-folder'])
    expect(
      result[0].items
        .filter((item) => resourceMentionMatches(item, 'knowledge base folders'))
        .map((item) => item.id)
    ).toEqual(['kb-folder'])
  })
})
