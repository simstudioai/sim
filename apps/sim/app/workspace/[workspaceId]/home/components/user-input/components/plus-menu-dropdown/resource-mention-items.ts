import type { BrowserTabState } from '@sim/browser-protocol'
import type { TerminalTabState } from '@sim/terminal-protocol'
import {
  BROWSER_SESSION_RESOURCE_ID,
  TERMINAL_SESSION_RESOURCE_ID,
} from '@/lib/copilot/resources/types'
import { folderAncestorChain } from '@/lib/folders/tree'
import type { AvailableItem } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/resource-folder-tree'
import { browserTabTitle } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-tab-label'
import type { MothershipResourceType } from '@/app/workspace/[workspaceId]/home/types'

export interface ResourceMentionGroup {
  type: MothershipResourceType
  items: AvailableItem[]
}

export type ResourceMentionLevel = 'resource' | 'tab'

export interface FolderMentionLocation {
  familyType: 'workflow' | 'file'
  parentNames: string[]
}

interface FolderMentionNode {
  id: string
  name: string
  parentId: string | null
}

function folderFamilyType(
  type: MothershipResourceType
): FolderMentionLocation['familyType'] | null {
  if (type === 'folder') return 'workflow'
  if (type === 'filefolder') return 'file'
  return null
}

/** Builds display-only locations for the folder rows in the flat resource picker. */
export function buildFolderMentionLocationMap(
  groups: readonly ResourceMentionGroup[]
): Map<string, FolderMentionLocation> {
  const locations = new Map<string, FolderMentionLocation>()

  for (const group of groups) {
    const familyType = folderFamilyType(group.type)
    if (!familyType) continue

    const nodes = new Map<string, FolderMentionNode>(
      group.items.map((item) => [
        item.id,
        {
          id: item.id,
          name: item.name,
          parentId: typeof item.parentId === 'string' ? item.parentId : null,
        },
      ])
    )

    for (const node of nodes.values()) {
      const parentNames = folderAncestorChain(node.parentId, (id) => nodes.get(id))
        .filter((parent) => parent.id !== node.id)
        .map((parent) => parent.name)
      locations.set(`${group.type}:${node.id}`, { familyType, parentNames })
    }
  }

  return locations
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
