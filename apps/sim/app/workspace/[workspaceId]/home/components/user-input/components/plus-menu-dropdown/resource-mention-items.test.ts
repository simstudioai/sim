import { describe, expect, it } from 'vitest'
import {
  BROWSER_SESSION_RESOURCE_ID,
  TERMINAL_SESSION_RESOURCE_ID,
} from '@/lib/copilot/resources/types'
import {
  buildFolderMentionLocationMap,
  resourceMentionMatches,
  withDesktopTabMentions,
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

describe('buildFolderMentionLocationMap', () => {
  it('distinguishes same-named top-level workflow and file folders by family', () => {
    const locations = buildFolderMentionLocationMap([
      {
        type: 'folder',
        items: [{ id: 'enterprise', name: 'Enterprise', parentId: null }],
      },
      {
        type: 'filefolder',
        items: [{ id: 'enterprise', name: 'Enterprise', parentId: null }],
      },
    ])

    expect(locations.get('folder:enterprise')).toEqual({
      familyType: 'workflow',
      parentNames: [],
    })
    expect(locations.get('filefolder:enterprise')).toEqual({
      familyType: 'file',
      parentNames: [],
    })
  })

  it('returns root-first parents without repeating the current folder name', () => {
    const locations = buildFolderMentionLocationMap([
      {
        type: 'folder',
        items: [
          { id: 'engineering', name: 'Engineering', parentId: null },
          { id: 'accounts', name: 'Accounts', parentId: 'engineering' },
          { id: 'enterprise', name: 'Enterprise', parentId: 'accounts' },
        ],
      },
    ])

    expect(locations.get('folder:enterprise')).toEqual({
      familyType: 'workflow',
      parentNames: ['Engineering', 'Accounts'],
    })
  })

  it('falls back to the family when a parent is missing', () => {
    const locations = buildFolderMentionLocationMap([
      {
        type: 'filefolder',
        items: [{ id: 'enterprise', name: 'Enterprise', parentId: 'missing' }],
      },
    ])

    expect(locations.get('filefolder:enterprise')).toEqual({
      familyType: 'file',
      parentNames: [],
    })
  })

  it('terminates cyclic ancestry without repeating the current folder', () => {
    const locations = buildFolderMentionLocationMap([
      {
        type: 'folder',
        items: [
          { id: 'enterprise', name: 'Enterprise', parentId: 'accounts' },
          { id: 'accounts', name: 'Accounts', parentId: 'enterprise' },
        ],
      },
    ])

    expect(locations.get('folder:enterprise')).toEqual({
      familyType: 'workflow',
      parentNames: ['Accounts'],
    })
  })

  it('does not add locations for non-folder resources', () => {
    const locations = buildFolderMentionLocationMap([
      { type: 'workflow', items: [{ id: 'workflow-1', name: 'Enterprise' }] },
      { type: 'file', items: [{ id: 'file-1', name: 'Enterprise' }] },
    ])

    expect(locations.size).toBe(0)
  })
})

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
