'use client'

import { useState } from 'react'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import {
  type ComposerOption,
  GROUP_ICONS,
  referenceKey,
} from '@/app/(product)/_components/composer/reference-options'

interface ResourceMenuProps {
  /** The trigger's accessible name and tooltip. */
  label: string
  items: readonly ComposerOption[]
  onSelect: (item: ComposerOption) => void
  onOpenChange: (open: boolean) => void
  /** A workspace opened in the menu, whose families the host reads on demand. */
  onWorkspaceOpen?: (workspaceId: string) => void
  /** The menu's search as typed, which the host answers. */
  onSearchChange?: (query: string) => void
  /** Loads the next page of a workspace's family, when it has one. */
  moreFor?: (workspaceId: string, group: string) => (() => void) | undefined
  /** Upload rows head the menu when given, as the composer's attachment menu has. */
  onUploadFiles?: () => void
  onUploadFolder?: () => void
  /** Whether a workspace itself is a pick, first in its submenu; the chat panel opens none. */
  selectWorkspaces?: boolean
  /** Whether an opened workspace's families have arrived, so an empty submenu says it has none. */
  workspaceLoaded?: (workspaceId: string) => boolean
}

type SelectResource = ResourceMenuProps['onSelect']

function groupItems<Key>(
  items: readonly ComposerOption[],
  getKey: (item: ComposerOption) => Key
): Map<Key, ComposerOption[]> {
  const groups = new Map<Key, ComposerOption[]>()
  for (const item of items) {
    const key = getKey(item)
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }
  return groups
}

function selection(item: ComposerOption, select: SelectResource): MenuAction {
  return {
    id: referenceKey(item),
    label: item.name,
    icon: item.icon,
    onSelect: () => select(item),
  }
}

function familyRows(
  items: readonly ComposerOption[],
  select: SelectResource,
  more?: (group: string) => (() => void) | undefined
): MenuAction[] {
  const families = groupItems(items, (item) => item.folderFor ?? item.group)
  return Array.from(families).flatMap(([family, members]): MenuAction[] => {
    const folders = new Set(members.filter((item) => item.folderFor).map((item) => item.id))
    const byParent = groupItems(members, (item) =>
      item.parentId && folders.has(item.parentId) ? item.parentId : undefined
    )
    function row(item: ComposerOption): MenuAction {
      const choose = selection(item, select)
      if (!item.folderFor) return choose
      return {
        id: choose.id,
        label: item.name,
        icon: item.icon,
        children: [choose, ...(byParent.get(item.id) ?? []).map(row)],
      }
    }
    const loadMore = more?.(family)
    const moreRow: MenuAction[] = loadMore
      ? [{ id: `${family}:more`, label: 'Show more', keepOpen: true, onSelect: loadMore }]
      : []
    const [first, ...rest] = [...(byParent.get(undefined) ?? []).map(row), ...moreRow]
    if (!first) return []
    return [
      {
        id: family,
        label: family,
        icon: GROUP_ICONS[family] ?? first.icon,
        children: [first, ...rest],
      },
    ]
  })
}

function browseRows(
  items: readonly ComposerOption[],
  select: SelectResource,
  openWorkspace: ResourceMenuProps['onWorkspaceOpen'],
  moreFor: ResourceMenuProps['moreFor'],
  selectWorkspaces: boolean,
  workspaceLoaded: ResourceMenuProps['workspaceLoaded']
): MenuAction[] {
  const workspaces = items.filter((item) => item.group === 'Workspaces')
  const workspaceIds = new Set(workspaces.map((item) => item.id))
  const byWorkspace = groupItems(
    items.filter((item) => item.group !== 'Workspaces'),
    (item) =>
      item.workspaceId && workspaceIds.has(item.workspaceId) ? item.workspaceId : undefined
  )
  const workspaceRows = workspaces.map((workspace): MenuAction => {
    const families = familyRows(
      byWorkspace.get(workspace.id) ?? [],
      select,
      moreFor && ((group) => moreFor(workspace.id, group))
    )
    const placeholder: MenuAction = {
      id: `${workspace.id}:empty`,
      label: workspaceLoaded?.(workspace.id) ? 'No resources' : 'Loading…',
      disabled: true,
    }
    const [first, ...rest] = [
      ...(selectWorkspaces ? [selection(workspace, select)] : []),
      ...families,
    ]
    return {
      id: workspace.id,
      label: workspace.name,
      icon: workspace.icon,
      onOpen: openWorkspace && (() => openWorkspace(workspace.id)),
      children: first ? [first, ...rest] : [placeholder],
    }
  })
  return [...workspaceRows, ...familyRows(byWorkspace.get(undefined) ?? [], select)]
}

function searchRows(
  items: readonly ComposerOption[],
  query: string,
  select: SelectResource
): MenuAction[] {
  const matches = items.filter((item) =>
    [item.name, item.workspaceName, item.group, item.folderFor].some((label) =>
      label?.toLowerCase().includes(query)
    )
  )
  return matches.map((item, index) => ({
    ...selection(item, select),
    headingBefore: matches[index - 1]?.group !== item.group ? item.group : undefined,
    detail: item.workspaceName,
  }))
}

export function ResourceMenu({
  label,
  items,
  onSelect,
  onOpenChange,
  onWorkspaceOpen,
  onSearchChange,
  moreFor,
  onUploadFiles,
  onUploadFolder,
  selectWorkspaces = true,
  workspaceLoaded,
}: ResourceMenuProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  let actions: MenuAction[] = []
  if (open) {
    actions = query
      ? searchRows(items, query, onSelect)
      : [
          ...(onUploadFiles
            ? [
                {
                  id: 'upload',
                  label: 'Upload files',
                  icon: 'I117' as const,
                  onSelect: onUploadFiles,
                },
              ]
            : []),
          ...(onUploadFolder
            ? [
                {
                  id: 'upload-folder',
                  label: 'Upload folder',
                  icon: 'I100' as const,
                  onSelect: onUploadFolder,
                },
              ]
            : []),
          ...browseRows(
            items,
            onSelect,
            onWorkspaceOpen,
            moreFor,
            selectWorkspaces,
            workspaceLoaded
          ).map((action, index) => ({
            ...action,
            separatorBefore: index === 0 && Boolean(onUploadFiles || onUploadFolder),
          })),
        ]
  }
  return (
    <ActionMenu
      label={label}
      icon='I074'
      actions={actions}
      search={{
        label: 'Search resources',
        value: search,
        onValueChange: (value) => {
          setSearch(value)
          onSearchChange?.(value)
        },
      }}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        onOpenChange(next)
      }}
    />
  )
}
