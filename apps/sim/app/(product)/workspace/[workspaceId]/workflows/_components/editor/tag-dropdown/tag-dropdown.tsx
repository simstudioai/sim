'use client'

import { type ReactNode, type RefObject, useEffect, useEffectEvent, useMemo, useState } from 'react'
import { Icon } from '@sim/emcn/icon'
import {
  FieldPopover,
  FieldPopoverHeading,
  FieldPopoverRow,
  useActiveRowIntoView,
} from '@/app/(product)/workspace/[workspaceId]/_components/field-popover/field-popover'
import { BlockTile } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/block-tile/block-tile'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/tag-dropdown/tag-dropdown.module.css'
import {
  type BlockTagGroup,
  type NestedBlockTagGroup,
  type NestedTag,
  rootTagOf,
  TAG_PREFIXES,
  useReferenceTags,
} from '@/platform/lib/data/workflow-editor'

interface TagDropdownProps {
  visible: boolean
  /** Receives the field's whole new text with the reference in place, and the caret after it. */
  onSelect: (newValue: string, newCursorPosition: number) => void
  /** The block that owns the field. */
  blockId: string
  /** Narrows the list to one block's outputs, after a connection is dropped on the field. */
  activeSourceBlockId: string | null
  inputValue: string
  cursorPosition: number
  onClose?: () => void
  inputRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>
}

/** The workflow-variables group's tile fill, as the legacy picker paints it. */
const VARIABLES_TILE_COLOR = '#2F8BFF'

interface TagRow {
  tag: string
  group?: BlockTagGroup | NestedBlockTagGroup
  label: string
  /** The output's type, shown at the row's end; `any` shows nothing. */
  type?: string
  /** The folder the row opens, in place of inserting its tag. */
  folderTag?: NestedTag
  leading?: ReactNode
}

/** The nested output object the picker has opened, with the path walked inside it. */
interface OpenFolder {
  group: NestedBlockTagGroup
  path: NestedTag[]
}

const isFolder = (tag: NestedTag) => Boolean(tag.children?.length || tag.nestedChildren?.length)

/** The folder whose row is `tag`, looked up through every level of a group. */
function findFolderForTag(tags: readonly NestedTag[], tag: string): NestedTag | null {
  for (const nested of tags) {
    if (nested.parentTag === tag && isFolder(nested)) return nested
    if (nested.nestedChildren) {
      const found = findFolderForTag(nested.nestedChildren, tag)
      if (found) return found
    }
  }
  return null
}

/**
 * The `<block.output>` picker under a field's caret. Variables and each reachable block's outputs
 * list at the root; a nested output object opens in place with a Back row. Arrow keys move through
 * the rows, Right opens an object and Left steps back, Enter or Tab inserts, and Escape closes,
 * while focus stays in the field.
 */
export function TagDropdown({
  visible,
  onSelect,
  blockId,
  activeSourceBlockId,
  inputValue,
  cursorPosition,
  onClose,
  inputRef,
}: TagDropdownProps) {
  const {
    tags,
    variableTags,
    variableInfoMap,
    nestedBlockTagGroups,
    flatTagList,
    flatTagIndexMap,
    handleTagSelect,
    getTagType,
  } = useReferenceTags({
    blockId,
    activeSourceBlockId,
    inputValue,
    cursorPosition,
    onSelect,
    onClose,
  })
  const [folder, setFolder] = useState<OpenFolder | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const currentFolder = folder ? folder.path[folder.path.length - 1] : null

  const visibleIndices = useMemo(() => {
    const indexOf = (tag: string | undefined) => (tag ? (flatTagIndexMap.get(tag) ?? -1) : -1)
    const rows: number[] = []
    if (currentFolder) {
      rows.push(indexOf(currentFolder.parentTag))
      for (const child of currentFolder.children ?? []) rows.push(indexOf(child.fullTag))
      for (const nested of currentFolder.nestedChildren ?? []) rows.push(indexOf(nested.parentTag))
    } else {
      for (const tag of variableTags) rows.push(indexOf(tag))
      for (const group of nestedBlockTagGroups) {
        const rootTag = rootTagOf(group)
        rows.push(indexOf(rootTag))
        for (const nested of group.nestedTags) {
          if (nested.fullTag === rootTag) continue
          rows.push(indexOf(isFolder(nested) ? nested.parentTag : nested.fullTag))
        }
      }
    }
    return rows.filter((index) => index >= 0)
  }, [currentFolder, variableTags, nestedBlockTagGroups, flatTagIndexMap])

  const firstVisible = visibleIndices[0] ?? 0
  const [settledFirst, setSettledFirst] = useState(firstVisible)
  if (settledFirst !== firstVisible) {
    setSettledFirst(firstVisible)
    setSelectedIndex(firstVisible)
  }

  const [wasVisible, setWasVisible] = useState(visible)
  if (wasVisible !== visible) {
    setWasVisible(visible)
    if (!visible) setFolder(null)
  }

  useActiveRowIntoView(visible, selectedIndex)

  const openFolder = (tag: NestedTag, group: NestedBlockTagGroup) => {
    setFolder((current) =>
      current && current.group.blockId === group.blockId
        ? { group, path: [...current.path, tag] }
        : { group, path: [tag] }
    )
  }

  const stepBack = () => {
    setFolder((current) => {
      if (!current || current.path.length <= 1) return null
      return { group: current.group, path: current.path.slice(0, -1) }
    })
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose?.()
      return
    }
    if (!flatTagList.length) return
    const position = visibleIndices.indexOf(selectedIndex)
    const selected = flatTagList[selectedIndex]
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault()
        event.stopPropagation()
        if (!visibleIndices.length) return
        const down = event.key === 'ArrowDown'
        const next =
          position === -1
            ? visibleIndices[down ? 0 : visibleIndices.length - 1]
            : visibleIndices[
                Math.min(Math.max(position + (down ? 1 : -1), 0), visibleIndices.length - 1)
              ]
        setSelectedIndex(next)
        return
      }
      case 'Enter':
      case 'Tab':
        if (event.key === 'Tab' && event.shiftKey) return
        if (selected) {
          event.preventDefault()
          event.stopPropagation()
          handleTagSelect(selected.tag, selected.group)
        }
        return
      case 'ArrowRight': {
        if (!selected?.group) return
        const group = nestedBlockTagGroups.find((item) => item.blockId === selected.group?.blockId)
        const target = group ? findFolderForTag(group.nestedTags, selected.tag) : null
        if (!group || !target || target === currentFolder) return
        event.preventDefault()
        event.stopPropagation()
        openFolder(target, group)
        return
      }
      case 'ArrowLeft':
        if (!folder) return
        event.preventDefault()
        event.stopPropagation()
        stepBack()
    }
  })

  useEffect(() => {
    if (!visible) return
    const listener = (event: KeyboardEvent) => onKeyDown(event)
    window.addEventListener('keydown', listener, true)
    return () => window.removeEventListener('keydown', listener, true)
  }, [visible])

  const open = visible && tags.length > 0 && flatTagList.length > 0

  const row = ({ tag, group, label, type, folderTag, leading }: TagRow) => {
    const index = flatTagIndexMap.get(tag) ?? -1
    return (
      <FieldPopoverRow
        key={`${group?.blockId ?? 'variables'}:${tag}:${folderTag ? 'folder' : 'leaf'}`}
        index={index}
        active={index >= 0 && index === selectedIndex}
        nested={Boolean(folderTag)}
        leading={leading}
        trailing={
          folderTag ? (
            <span className={styles.chevron}>
              <Icon name='I032' />
            </span>
          ) : type && type !== 'any' ? (
            <span className={styles.type} data-type='T050'>
              {type}
            </span>
          ) : undefined
        }
        onHover={() => {
          if (index >= 0) setSelectedIndex(index)
        }}
        onSelect={() => {
          if (folderTag && group) openFolder(folderTag, group as NestedBlockTagGroup)
          else handleTagSelect(tag, group)
        }}
      >
        {label}
      </FieldPopoverRow>
    )
  }

  return (
    <FieldPopover
      label='References'
      open={open}
      anchor={inputRef}
      caretIndex={cursorPosition}
      onDismiss={() => onClose?.()}
    >
      {folder && currentFolder ? (
        <>
          <FieldPopoverRow
            leading={<Icon name='I140' />}
            onHover={() => setSelectedIndex(-1)}
            onSelect={stepBack}
          >
            Back
          </FieldPopoverRow>
          {currentFolder.parentTag &&
            row({
              tag: currentFolder.parentTag,
              group: folder.group,
              label: currentFolder.display,
            })}
          {currentFolder.children?.map((child) =>
            row({
              tag: child.fullTag,
              group: folder.group,
              label: child.display,
              type: getTagType(child.fullTag, folder.group),
            })
          )}
          {currentFolder.nestedChildren?.map((nested) =>
            nested.parentTag
              ? row({
                  tag: nested.parentTag,
                  group: folder.group,
                  label: nested.display,
                  folderTag: nested,
                })
              : null
          )}
        </>
      ) : (
        <>
          {variableTags.length > 0 && (
            <div role='group' aria-label='Variables' className={styles.section}>
              <FieldPopoverHeading>
                <span className={styles.headingLabel}>
                  <BlockTile bgColor={VARIABLES_TILE_COLOR} fallbackLabel='V' size='sm' />
                  Variables
                </span>
              </FieldPopoverHeading>
              {variableTags.map((tag) =>
                row({
                  tag,
                  label: tag.startsWith(TAG_PREFIXES.VARIABLE)
                    ? tag.slice(TAG_PREFIXES.VARIABLE.length)
                    : tag,
                  type: variableInfoMap[tag]?.type,
                })
              )}
            </div>
          )}
          {nestedBlockTagGroups.map((group) => {
            const rootTag = rootTagOf(group)
            return (
              <div
                key={group.blockId}
                role='group'
                aria-label={group.blockName}
                className={styles.section}
              >
                {row({
                  tag: rootTag,
                  group,
                  label: group.blockName,
                  leading: (
                    <BlockTile
                      size='sm'
                      blockType={group.blockType}
                      fallbackLabel={group.blockName.charAt(0).toUpperCase()}
                    />
                  ),
                })}
                {group.nestedTags.map((nested) => {
                  if (nested.fullTag === rootTag) return null
                  if (isFolder(nested))
                    return nested.parentTag
                      ? row({
                          tag: nested.parentTag,
                          group,
                          label: nested.display,
                          folderTag: nested,
                        })
                      : null
                  return nested.fullTag
                    ? row({
                        tag: nested.fullTag,
                        group,
                        label: nested.display,
                        type: getTagType(nested.fullTag, group, nested.key),
                      })
                    : null
                })}
              </div>
            )
          })}
        </>
      )}
    </FieldPopover>
  )
}
