import { useEffect, useMemo } from 'react'
import { usePopoverContext } from '@/components/emcn'
import type { BlockTagGroup, NestedBlockTagGroup } from '../types'

/**
 * Keyboard navigation handler component that uses popover context
 * to enable folder navigation with arrow keys
 */
interface KeyboardNavigationHandlerProps {
  visible: boolean
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  flatTagList: Array<{ tag: string; group?: BlockTagGroup }>
  nestedBlockTagGroups: NestedBlockTagGroup[]
  handleTagSelect: (tag: string, group?: BlockTagGroup) => void
}

export const KeyboardNavigationHandler: React.FC<KeyboardNavigationHandlerProps> = ({
  visible,
  selectedIndex,
  setSelectedIndex,
  flatTagList,
  nestedBlockTagGroups,
  handleTagSelect,
}) => {
  const { openFolder, closeFolder, isInFolder, currentFolder } = usePopoverContext()

  const visibleIndices = useMemo(() => {
    const indices: number[] = []

    if (isInFolder && currentFolder) {
      for (const group of nestedBlockTagGroups) {
        for (const nestedTag of group.nestedTags) {
          const folderId = `${group.blockId}-${nestedTag.key}`
          if (folderId === currentFolder && nestedTag.children) {
            // First, add the parent tag itself (so it's navigable as the first item)
            if (nestedTag.parentTag) {
              const parentIdx = flatTagList.findIndex((item) => item.tag === nestedTag.parentTag)
              if (parentIdx >= 0) {
                indices.push(parentIdx)
              }
            }
            // Then add all children
            for (const child of nestedTag.children) {
              const idx = flatTagList.findIndex((item) => item.tag === child.fullTag)
              if (idx >= 0) {
                indices.push(idx)
              }
            }
            break
          }
        }
      }
    } else {
      // We're at root level, show all non-child items
      // (variables and parent tags, but not their children)
      for (let i = 0; i < flatTagList.length; i++) {
        const tag = flatTagList[i].tag

        // Check if this is a child of a parent folder
        let isChild = false
        for (const group of nestedBlockTagGroups) {
          for (const nestedTag of group.nestedTags) {
            if (nestedTag.children) {
              for (const child of nestedTag.children) {
                if (child.fullTag === tag) {
                  isChild = true
                  break
                }
              }
            }
            if (isChild) break
          }
          if (isChild) break
        }

        if (!isChild) {
          indices.push(i)
        }
      }
    }

    return indices
  }, [isInFolder, currentFolder, flatTagList, nestedBlockTagGroups])

  // Auto-select first visible item when entering/exiting folders
  useEffect(() => {
    if (!visible || visibleIndices.length === 0) return

    if (!visibleIndices.includes(selectedIndex)) {
      setSelectedIndex(visibleIndices[0])
    }
  }, [visible, isInFolder, currentFolder, visibleIndices, selectedIndex, setSelectedIndex])

  useEffect(() => {
    if (!visible || !flatTagList.length) return

    const openFolderWithSelection = (
      folderId: string,
      folderTitle: string,
      parentTag: string,
      group: BlockTagGroup
    ) => {
      const parentIdx = flatTagList.findIndex((item) => item.tag === parentTag)
      const selectionCallback = () => handleTagSelect(parentTag, group)
      openFolder(folderId, folderTitle, undefined, selectionCallback)
      if (parentIdx >= 0) {
        setSelectedIndex(parentIdx)
      }
    }

    const handleKeyboardEvent = (e: KeyboardEvent) => {
      const selected = flatTagList[selectedIndex]
      if (!selected && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return

      let currentFolderInfo: {
        id: string
        title: string
        parentTag: string
        group: BlockTagGroup
      } | null = null

      if (selected) {
        for (const group of nestedBlockTagGroups) {
          for (const nestedTag of group.nestedTags) {
            if (
              nestedTag.parentTag === selected.tag &&
              nestedTag.children &&
              nestedTag.children.length > 0
            ) {
              currentFolderInfo = {
                id: `${selected.group?.blockId}-${nestedTag.key}`,
                title: nestedTag.display,
                parentTag: nestedTag.parentTag,
                group,
              }
              break
            }
          }
          if (currentFolderInfo) break
        }
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          e.stopPropagation()
          if (visibleIndices.length > 0) {
            const currentVisibleIndex = visibleIndices.indexOf(selectedIndex)
            if (currentVisibleIndex === -1) {
              setSelectedIndex(visibleIndices[0])
            } else if (currentVisibleIndex < visibleIndices.length - 1) {
              setSelectedIndex(visibleIndices[currentVisibleIndex + 1])
            }
          }
          break
        case 'ArrowUp':
          e.preventDefault()
          e.stopPropagation()
          if (visibleIndices.length > 0) {
            const currentVisibleIndex = visibleIndices.indexOf(selectedIndex)
            if (currentVisibleIndex === -1) {
              setSelectedIndex(visibleIndices[0])
            } else if (currentVisibleIndex > 0) {
              setSelectedIndex(visibleIndices[currentVisibleIndex - 1])
            }
          }
          break
        case 'Enter':
          e.preventDefault()
          e.stopPropagation()
          if (selected && selectedIndex >= 0 && selectedIndex < flatTagList.length) {
            if (currentFolderInfo && !isInFolder) {
              // It's a folder, open it
              openFolderWithSelection(
                currentFolderInfo.id,
                currentFolderInfo.title,
                currentFolderInfo.parentTag,
                currentFolderInfo.group
              )
            } else {
              // Not a folder, select it
              handleTagSelect(selected.tag, selected.group)
            }
          }
          break
        case 'ArrowRight':
          if (currentFolderInfo && !isInFolder) {
            e.preventDefault()
            e.stopPropagation()
            openFolderWithSelection(
              currentFolderInfo.id,
              currentFolderInfo.title,
              currentFolderInfo.parentTag,
              currentFolderInfo.group
            )
          }
          break
        case 'ArrowLeft':
          if (isInFolder) {
            e.preventDefault()
            e.stopPropagation()
            closeFolder()
            let firstRootIndex = 0
            for (let i = 0; i < flatTagList.length; i++) {
              const tag = flatTagList[i].tag
              const isVariable = !tag.includes('.')
              let isParent = false
              for (const group of nestedBlockTagGroups) {
                for (const nestedTag of group.nestedTags) {
                  if (nestedTag.parentTag === tag) {
                    isParent = true
                    break
                  }
                }
                if (isParent) break
              }
              if (isVariable || isParent) {
                firstRootIndex = i
                break
              }
            }
            setSelectedIndex(firstRootIndex)
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyboardEvent, true)
    return () => window.removeEventListener('keydown', handleKeyboardEvent, true)
  }, [
    visible,
    selectedIndex,
    visibleIndices,
    flatTagList,
    nestedBlockTagGroups,
    openFolder,
    closeFolder,
    isInFolder,
    setSelectedIndex,
    handleTagSelect,
  ])

  return null
}
