import type { BrowserTabState } from '@sim/browser-protocol'
import type { TerminalTabState } from '@sim/terminal-protocol'
import {
  BROWSER_SESSION_RESOURCE_ID,
  TERMINAL_SESSION_RESOURCE_ID,
} from '@/lib/copilot/resources/types'
import type { AvailableItem } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/resource-folder-tree'
import { browserTabTitle } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-tab-label'
import type { MothershipResourceType } from '@/app/workspace/[workspaceId]/home/types'

export interface ResourceMentionGroup {
  type: MothershipResourceType
  items: AvailableItem[]
}

/** Adds table and knowledge-base folders as stable folder-ID chat mentions. */
export function withFolderMentions(
  groups: readonly ResourceMentionGroup[],
  folders: { table: AvailableItem[]; knowledgebase: AvailableItem[] }
): ResourceMentionGroup[] {
  return groups.map((group) =>
    group.type === 'folder'
      ? {
          ...group,
          items: [
            ...group.items,
            ...folders.table.map((item) => ({ ...item, mentionFamily: 'Table folders' })),
            ...folders.knowledgebase.map((item) => ({
              ...item,
              mentionFamily: 'Knowledge base folders',
            })),
          ],
        }
      : group
  )
}

export type ResourceMentionLevel = 'resource' | 'tab'

/** A family query such as "browser" keeps that resource's live tabs visible. */
export function resourceMentionMatches(item: AvailableItem, query: string): boolean {
  const normalized = query.toLowerCase().trim()
  if (!normalized) return true
  return (
    item.name.toLowerCase().includes(normalized) ||
    (typeof item.mentionFamily === 'string' &&
      item.mentionFamily.toLowerCase().includes(normalized))
  )
}

function uniqueTabNames<T>(tabs: readonly T[], nameOf: (tab: T) => string): string[] {
  const names = tabs.map(nameOf)
  const counts = new Map<string, number>()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  const occurrences = new Map<string, number>()
  return names.map((name) => {
    if (counts.get(name) === 1) return name
    const occurrence = (occurrences.get(name) ?? 0) + 1
    occurrences.set(name, occurrence)
    return `${name} ${occurrence}`
  })
}

function resourceItem(id: string, name: string, existing?: AvailableItem): AvailableItem {
  return {
    ...existing,
    id,
    name,
    mentionFamily: name,
    mentionLevel: 'resource' satisfies ResourceMentionLevel,
  }
}

/** Adds live inner tabs after each always-present desktop resource mention. */
export function withDesktopTabMentions(
  groups: readonly ResourceMentionGroup[],
  browserTabs: readonly BrowserTabState[],
  terminalTabs: readonly TerminalTabState[]
): ResourceMentionGroup[] {
  const browserNames = uniqueTabNames(browserTabs, browserTabTitle)
  const terminalNames = uniqueTabNames(terminalTabs, (tab) => tab.title.trim() || 'Terminal')

  return groups.map((group) => {
    if (group.type === 'browser') {
      const existing = group.items.find((item) => item.id === BROWSER_SESSION_RESOURCE_ID)
      return {
        ...group,
        items: [
          resourceItem(BROWSER_SESSION_RESOURCE_ID, 'Browser', existing),
          ...browserTabs.map((tab, index) => ({
            id: tab.tabId,
            name: browserNames[index],
            mentionFamily: 'Browser',
            mentionLevel: 'tab' satisfies ResourceMentionLevel,
          })),
        ],
      }
    }
    if (group.type === 'terminal') {
      const existing = group.items.find((item) => item.id === TERMINAL_SESSION_RESOURCE_ID)
      return {
        ...group,
        items: [
          resourceItem(TERMINAL_SESSION_RESOURCE_ID, 'Terminal', existing),
          ...terminalTabs.map((tab, index) => ({
            id: tab.terminalId,
            name: terminalNames[index],
            mentionFamily: 'Terminal',
            mentionLevel: 'tab' satisfies ResourceMentionLevel,
          })),
        ],
      }
    }
    return group
  })
}

/** One row of the `@` list: an item plus the family it came from. */
export interface ResourceMentionCandidate {
  type: MothershipResourceType
  item: AvailableItem
}

/**
 * The rows an `@` list shows for an EMPTY query — a preview of what is mentionable,
 * capped per family so no one family can bury the rest.
 *
 * `integration` carries 300+ near-identical rows and sorts FIRST, so while the cap
 * defaulted to "uncapped" the preview was its entire catalog and no other family was
 * reachable without scrolling past all of it. Capping is therefore the default and a
 * family opts out by raising its own limit, not by omitting one.
 *
 * Only the empty-query preview is capped; {@link resourceMentionMatches} searches
 * every family in full once the user types.
 */
export function buildMentionPreview(
  groups: readonly ResourceMentionGroup[],
  limitFor: (type: MothershipResourceType) => number
): ResourceMentionCandidate[] {
  return groups.flatMap(({ type, items }) =>
    items.slice(0, limitFor(type)).map((item) => ({ type, item }))
  )
}
