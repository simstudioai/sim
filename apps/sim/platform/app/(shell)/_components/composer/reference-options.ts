import type { IconName } from '@sim/emcn/catalog/icon-geometry'
import type {
  ChatAttachment,
  ComposerController,
  ComposerReference,
} from '@/platform/app/(shell)/_components/composer/model'
import type { ChatContext } from '@/platform/lib/data/chat-types'

export const GROUP_ICONS: Record<string, IconName> = {
  Workspaces: 'I025',
  Integrations: 'I070',
  Chats: 'I073',
  Dashboards: 'I025',
  Tables: 'I033',
  Files: 'I015',
  'File Folders': 'I100',
  'Knowledge Bases': 'I082',
  Workflows: 'I118',
  Logs: 'I075',
  Folders: 'I100',
  Browser: 'I041',
  Terminal: 'I107',
  Skills: 'I044',
  'MCP servers': 'I126',
}

export interface ComposerOption extends ComposerReference {
  group: string
  icon: IconName
}

export function referenceOptions(
  composer: Pick<ComposerController, 'references' | 'tools' | 'skills'>
): ComposerOption[] {
  const groups = new Map(composer.references.map((group) => [group.group, group.items]))
  return [
    ...Object.entries(GROUP_ICONS).flatMap(([group, icon]) =>
      (groups.get(group) ?? []).map((item) => ({ ...item, group, icon: item.icon ?? icon }))
    ),
    ...(composer.tools ?? []).map((tool) => {
      const group = tool.id === 'browser' ? 'Browser' : 'Terminal'
      return { ...tool, name: tool.label, group, icon: GROUP_ICONS[group] }
    }),
    ...(composer.skills ?? []).map((skill) => {
      const group = skill.skillKind === 'mcp' ? 'MCP servers' : 'Skills'
      return { ...skill, group, icon: skill.icon ?? GROUP_ICONS[group] }
    }),
  ]
}

export function prefixFor(group: string) {
  return group === 'Skills' || group === 'MCP servers' ? '/' : '@'
}

export function referenceKey(item: ComposerOption) {
  return [item.group, item.workspaceId, item.id].join(':')
}

const CONTEXT_GROUPS: Partial<Record<ChatContext['kind'], string>> = {
  workspace: 'Workspaces',
  integration: 'Integrations',
  past_chat: 'Chats',
  dashboard: 'Dashboards',
  table: 'Tables',
  file: 'Files',
  filefolder: 'File Folders',
  file_selection: 'Files',
  table_selection: 'Tables',
  knowledge: 'Knowledge Bases',
  workflow: 'Workflows',
  logs: 'Logs',
  folder: 'Folders',
  skill: 'Skills',
  mcp: 'MCP servers',
  browser_tab: 'Browser',
  browser_page: 'Browser',
  terminal_tab: 'Terminal',
}

/** A restored draft can paint its selected references before the live picker inventory arrives. */
export function selectedOptions(
  attachments: readonly ChatAttachment[],
  options: readonly ComposerOption[]
) {
  return attachments.flatMap((file) => {
    if (file.kind !== 'reference') return []
    const group = file.context ? CONTEXT_GROUPS[file.context.kind] : file.metadata
    if (!group || !GROUP_ICONS[group]) return []
    const context = file.context
    const providerId =
      context?.kind === 'integration'
        ? context.blockType
        : context?.kind === 'mcp'
          ? context.managedConnectorId
          : undefined
    const owner = context && 'workspaceId' in context ? context.workspaceId : undefined
    const option = options.find(
      (item) =>
        item.group === group &&
        (file.referenceId
          ? item.id === file.referenceId
          : item.name === file.name && (!owner || item.workspaceId === owner))
    )
    const item: ComposerOption = {
      id: file.referenceId ?? file.id,
      group,
      icon: GROUP_ICONS[group],
      workspaceId: owner,
      providerId,
      ...option,
      name: file.name,
      context: file.context ?? option?.context,
    }
    return [{ item, attachmentId: file.id }]
  })
}

export function uniqueOption(item: ComposerOption, selected: ReturnType<typeof selectedOptions>) {
  const existing = selected.find((row) => referenceKey(row.item) === referenceKey(item))
  if (existing) return existing.item
  const names = new Set(selected.map((row) => row.item.name.toLowerCase()))
  let name = item.name
  for (let suffix = 2; names.has(name.toLowerCase()); suffix++) name = `${item.name} (${suffix})`
  return name === item.name
    ? item
    : { ...item, name, context: item.context && { ...item.context, label: name } }
}

export function filterOptions(options: readonly ComposerOption[], prefix: string, query: string) {
  const result: { item: ComposerOption; rank: number }[] = []
  const counts = new Map<string, number>()
  const search = query.toLowerCase().trim()
  for (const item of options) {
    if (prefixFor(item.group) !== prefix) continue
    let rank = 0
    if (search) {
      const name = item.name.toLowerCase()
      rank = name === search ? 0 : name.startsWith(search) ? 1 : name.includes(search) ? 2 : 3
      if (
        rank === 3 &&
        ![item.workspaceName, ...(prefix === '/' ? [item.detail] : [])].some((field) =>
          field?.toLowerCase().includes(search)
        )
      )
        continue
    } else if (prefix === '@') {
      const count = counts.get(item.group) ?? 0
      if (count >= 5) continue
      counts.set(item.group, count + 1)
    }
    result.push({ item, rank })
  }
  return result.sort((left, right) => left.rank - right.rank).map(({ item }) => item)
}
