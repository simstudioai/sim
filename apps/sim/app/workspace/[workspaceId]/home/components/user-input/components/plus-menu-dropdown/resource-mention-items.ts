import type { BrowserTabState } from '@sim/browser-protocol'
import type { TerminalTabState } from '@sim/terminal-protocol'
import { browserTabTitle } from '@/lib/browser-agent/tab-label'
import { TERMINAL_SESSION_RESOURCE_ID } from '@/lib/copilot/resources/types'
import type { AvailableItem } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/resource-folder-tree'
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

/**
 * Replaces the Browser launcher row with the live pages, which are the only
 * browser things that can be attached or mentioned. With no page open the
 * family disappears from the menu.
 */
export function withBrowserTabMentions(
  groups: readonly ResourceMentionGroup[],
  browserTabs: readonly BrowserTabState[]
): ResourceMentionGroup[] {
  const browserNames = uniqueTabNames(browserTabs, browserTabTitle)
  return groups.map((group) =>
    group.type === 'browser'
      ? {
          ...group,
          items: browserTabs.map((tab, index) => ({
            id: tab.tabId,
            name: browserNames[index],
            mentionFamily: 'Browser',
          })),
        }
      : group
  )
}

/** Adds live shells after the always-present Terminal mention. */
export function withTerminalTabMentions(
  groups: readonly ResourceMentionGroup[],
  terminalTabs: readonly TerminalTabState[]
): ResourceMentionGroup[] {
  const terminalNames = uniqueTabNames(terminalTabs, (tab) => tab.title.trim() || 'Terminal')

  return groups.map((group) => {
    if (group.type === 'terminal') {
      const existing = group.items.find((item) => item.id === TERMINAL_SESSION_RESOURCE_ID)
      return {
        ...group,
        items: [
          {
            ...existing,
            id: TERMINAL_SESSION_RESOURCE_ID,
            name: 'Terminal',
            mentionFamily: 'Terminal',
          },
          ...terminalTabs.map((tab, index) => ({
            id: tab.terminalId,
            name: terminalNames[index],
            mentionFamily: 'Terminal',
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
