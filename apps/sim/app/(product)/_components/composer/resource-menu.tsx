'use client'

import { useState } from 'react'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import {
  type ComposerOption,
  GROUP_ICONS,
  referenceKey,
} from '@/app/(product)/_components/composer/reference-options'

interface ComposerResourceMenuProps {
  items: readonly ComposerOption[]
  onSelect: (item: ComposerOption) => void
  onOpenChange: (open: boolean) => void
  onUploadFiles: () => void
  onUploadFolder: () => void
}

type SelectResource = ComposerResourceMenuProps['onSelect']

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

function familyRows(items: readonly ComposerOption[], select: SelectResource): MenuAction[] {
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
    const [first, ...rest] = (byParent.get(undefined) ?? []).map(row)
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

function browseRows(items: readonly ComposerOption[], select: SelectResource): MenuAction[] {
  const workspaces = items.filter((item) => item.group === 'Workspaces')
  const workspaceIds = new Set(workspaces.map((item) => item.id))
  const byWorkspace = groupItems(
    items.filter((item) => item.group !== 'Workspaces'),
    (item) =>
      item.workspaceId && workspaceIds.has(item.workspaceId) ? item.workspaceId : undefined
  )
  const workspaceRows = workspaces.map(
    (workspace): MenuAction => ({
      id: workspace.id,
      label: workspace.name,
      icon: workspace.icon,
      children: [
        selection(workspace, select),
        ...familyRows(byWorkspace.get(workspace.id) ?? [], select),
      ],
    })
  )
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

export function ComposerResourceMenu({
  items,
  onSelect,
  onOpenChange,
  onUploadFiles,
  onUploadFolder,
}: ComposerResourceMenuProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  let actions: MenuAction[] = []
  if (open) {
    actions = query
      ? searchRows(items, query, onSelect)
      : [
          { id: 'upload', label: 'Upload files', icon: 'I117', onSelect: onUploadFiles },
          { id: 'upload-folder', label: 'Upload folder', icon: 'I100', onSelect: onUploadFolder },
          ...browseRows(items, onSelect).map((action, index) => ({
            ...action,
            separatorBefore: index === 0,
          })),
        ]
  }
  return (
    <ActionMenu
      label='Add attachment'
      icon='I074'
      actions={actions}
      search={{ label: 'Search resources', value: search, onValueChange: setSearch }}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        onOpenChange(next)
      }}
    />
  )
}
