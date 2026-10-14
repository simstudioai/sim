import { createParser, parseAsArrayOf, parseAsString, parseAsStringLiteral } from 'nuqs/server'

export const SYNC_STEPS = ['mappings', 'copy', 'review'] as const
export type SyncStep = (typeof SYNC_STEPS)[number]

const SYNC_DIRECTIONS = ['push', 'pull'] as const

/**
 * A pane tab that exists only in the URL. It is never a chat resource, so it is never
 * mentioned, persisted with the chat, or sent to the agent.
 */
export type PaneTab =
  | { kind: 'browse'; id: string; workspaceId: string; resourceKind: string }
  | {
      kind: 'sync'
      id: string
      /** The fork; its parent is the other side of the sync. */
      childId: string
      direction: (typeof SYNC_DIRECTIONS)[number]
      step: SyncStep
    }

function serializePaneTab(tab: PaneTab): string {
  return tab.kind === 'browse'
    ? `browse:${tab.id}:${tab.workspaceId}:${tab.resourceKind}`
    : `sync:${tab.id}:${tab.childId}:${tab.direction}:${tab.step}`
}

const paneTabParser = createParser<PaneTab>({
  parse: (value) => {
    const [kind, id, first = '', second = '', third = ''] = value.split(':')
    if (!id) return null
    if (kind === 'browse') return { kind, id, workspaceId: first, resourceKind: second }
    if (kind !== 'sync' || !first) return null
    const direction = SYNC_DIRECTIONS.find((candidate) => candidate === second)
    const step = SYNC_STEPS.find((candidate) => candidate === third)
    return direction && step ? { kind, id, childId: first, direction, step } : null
  },
  serialize: serializePaneTab,
  eq: (a, b) => serializePaneTab(a) === serializePaneTab(b),
})

/** Project names are presentation; workspace ids address the selected environment. */
export const projectPaneParsers = {
  project: parseAsString.withDefault(''),
  section: parseAsStringLiteral([
    'dashboard',
    'changelog',
    'issues',
    'environments',
    'settings',
    'resources',
  ] as const).withDefault('dashboard'),
  resourceKind: parseAsString.withDefault(''),
  resourceDetail: parseAsString.withDefault(''),
  pane: parseAsString.withDefault(''),
  tabs: parseAsArrayOf(paneTabParser).withDefault([]),
}

export const projectPaneOptions = { history: 'push', clearOnDefault: true } as const
