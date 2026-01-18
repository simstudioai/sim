import { useEffect, useMemo } from 'react'
import { usePopoverContext } from '@/components/emcn'
import { useNestedNavigation } from '../tag-dropdown'
import type { BlockTagGroup, NestedBlockTagGroup, NestedTag } from '../types'

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

/**
 * Recursively finds a folder in nested tags by its ID
 */
const findFolderInNested = (
  nestedTags: NestedTag[],
  blockId: string,
  targetFolderId: string
): NestedTag | null => {
  for (const nestedTag of nestedTags) {
    const folderId = `${blockId}-${nestedTag.key}`
    if (folderId === targetFolderId) {
      return nestedTag
    }
    // Recursively search in nested children
    if (nestedTag.nestedChildren) {
      const found = findFolderInNested(nestedTag.nestedChildren, blockId, targetFolderId)
      if (found) return found
    }
  }
  return null
}

/**
 * Recursively finds folder info for a tag that can be expanded.
 * Returns both the folder metadata and the NestedTag object for navigation.
 */
const findFolderInfoForTag = (
  nestedTags: NestedTag[],
  targetTag: string,
  group: NestedBlockTagGroup
): {
  id: string
  title: string
  parentTag: string
  group: NestedBlockTagGroup
  nestedTag: NestedTag
} | null => {
  for (const nestedTag of nestedTags) {
    // Check if this tag is a folder (has children or nestedChildren)
    if (
      nestedTag.parentTag === targetTag &&
      (nestedTag.children?.length || nestedTag.nestedChildren?.length)
    ) {
      return {
        id: `${group.blockId}-${nestedTag.key}`,
        title: nestedTag.display,
        parentTag: nestedTag.parentTag,
        group,
        nestedTag,
      }
    }
    // Recursively search in nested children
    if (nestedTag.nestedChildren) {
      const found = findFolderInfoForTag(nestedTag.nestedChildren, targetTag, group)
      if (found) return found
    }
  }
  return null
}

/**
 * Recursively checks if a tag is a child of any folder.
 * This includes both leaf children and nested folder parent tags.
 */
const isChildOfAnyFolder = (nestedTags: NestedTag[], tag: string): boolean => {
  for (const nestedTag of nestedTags) {
    // Check in leaf children
    if (nestedTag.children) {
      for (const child of nestedTag.children) {
        if (child.fullTag === tag) {
          return true
        }
      }
    }
    // Check if this is a nested folder's parent tag (should be hidden at root)
    if (nestedTag.nestedChildren) {
      for (const nestedChild of nestedTag.nestedChildren) {
        if (nestedChild.parentTag === tag) {
          return true
        }
      }
      // Recursively check deeper nested children
      if (isChildOfAnyFolder(nestedTag.nestedChildren, tag)) {
        return true
      }
    }
  }
  return false
}

export const KeyboardNavigationHandler: React.FC<KeyboardNavigationHandlerProps> = ({
  visible,
  selectedIndex,
  setSelectedIndex,
  flatTagList,
  nestedBlockTagGroups,
  handleTagSelect,
}) => {
  const { openFolder, closeFolder, isInFolder, currentFolder, setKeyboardNav } = usePopoverContext()
  const nestedNav = useNestedNavigation()

  const visibleIndices = useMemo(() => {
    const indices: number[] = []
    const nestedPath = nestedNav?.nestedPath ?? []

    if (isInFolder && currentFolder) {
      // Determine the current folder to show based on nested navigation
      let currentNestedTag: NestedTag | null = null

      if (nestedPath.length > 0) {
        // We're in nested navigation - use the deepest nested tag
        currentNestedTag = nestedPath[nestedPath.length - 1]
      } else {
        // At base folder level - find the folder from currentFolder ID
        for (const group of nestedBlockTagGroups) {
          const folder = findFolderInNested(group.nestedTags, group.blockId, currentFolder)
          if (folder) {
            currentNestedTag = folder
            break
          }
        }
      }

      if (currentNestedTag) {
        // First, add the parent tag itself (so it's navigable as the first item)
        if (currentNestedTag.parentTag) {
          const parentIdx = flatTagList.findIndex(
            (item) => item.tag === currentNestedTag!.parentTag
          )
          if (parentIdx >= 0) {
            indices.push(parentIdx)
          }
        }
        // Add all leaf children
        if (currentNestedTag.children) {
          for (const child of currentNestedTag.children) {
            const idx = flatTagList.findIndex((item) => item.tag === child.fullTag)
            if (idx >= 0) {
              indices.push(idx)
            }
          }
        }
        // Add nested children parent tags (for subfolder navigation)
        if (currentNestedTag.nestedChildren) {
          for (const nestedChild of currentNestedTag.nestedChildren) {
            if (nestedChild.parentTag) {
              const idx = flatTagList.findIndex((item) => item.tag === nestedChild.parentTag)
              if (idx >= 0) {
                indices.push(idx)
              }
            }
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
          if (isChildOfAnyFolder(group.nestedTags, tag)) {
            isChild = true
            break
          }
        }

        if (!isChild) {
          indices.push(i)
        }
      }
    }

    return indices
  }, [isInFolder, currentFolder, flatTagList, nestedBlockTagGroups, nestedNav])

  // Track nested path length for dependency
  const nestedPathLength = nestedNav?.nestedPath.length ?? 0

  // Auto-select first visible item when entering/exiting folders or navigating nested
  // This effect only runs when folder navigation state changes, not on every render
  useEffect(() => {
    if (!visible || visibleIndices.length === 0) return

    // Select first visible item when entering a folder or navigating nested
    setSelectedIndex(visibleIndices[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, isInFolder, currentFolder, nestedPathLength])

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
        group: NestedBlockTagGroup
        nestedTag: NestedTag
      } | null = null

      if (selected) {
        // Find if selected tag can be expanded (is a folder)
        for (const group of nestedBlockTagGroups) {
          const folderInfo = findFolderInfoForTag(group.nestedTags, selected.tag, group)
          if (folderInfo) {
            currentFolderInfo = folderInfo
            break
          }
        }
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          e.stopPropagation()
          setKeyboardNav(true)
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
          setKeyboardNav(true)
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
            // Always select the tag, even for folders
            // Use Arrow Right to navigate into folders
            handleTagSelect(selected.tag, selected.group)
          }
          break
        case 'ArrowRight':
          if (currentFolderInfo) {
            e.preventDefault()
            e.stopPropagation()
            if (isInFolder && nestedNav) {
              // Already in a folder - use nested navigation to go deeper
              nestedNav.navigateIn(currentFolderInfo.nestedTag, currentFolderInfo.group)
            } else {
              // At root level - open the folder normally
              openFolderWithSelection(
                currentFolderInfo.id,
                currentFolderInfo.title,
                currentFolderInfo.parentTag,
                currentFolderInfo.group
              )
            }
          }
          break
        case 'ArrowLeft':
          if (isInFolder) {
            e.preventDefault()
            e.stopPropagation()
            // Try to navigate back in nested path first
            if (nestedNav?.navigateBack()) {
              // Successfully navigated back one level in nested navigation
              // Selection will be handled by the auto-select effect
              return
            }
            // At root folder level, close the folder entirely
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
    nestedNav,
    setKeyboardNav,
  ])

  return null
}
