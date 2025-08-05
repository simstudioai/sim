import { useCallback, useEffect, useRef, useState } from 'react'

export interface NavigationSection {
  id: string
  name: string
  type: 'grid' | 'list'
  items: any[]
  gridCols?: number // How many columns per row for grid sections
}

export interface NavigationPosition {
  sectionIndex: number
  itemIndex: number
}

export function useSearchNavigation(sections: NavigationSection[], isOpen: boolean) {
  const [position, setPosition] = useState<NavigationPosition>({ sectionIndex: 0, itemIndex: 0 })
  const scrollRefs = useRef<Map<string, HTMLElement>>(new Map())
  const lastPositionInSection = useRef<Map<string, number>>(new Map())

  // Reset position when sections change or modal opens
  useEffect(() => {
    if (sections.length > 0) {
      setPosition({ sectionIndex: 0, itemIndex: 0 })
    }
  }, [sections, isOpen])

  const getCurrentItem = useCallback(() => {
    if (sections.length === 0 || position.sectionIndex >= sections.length) return null

    const section = sections[position.sectionIndex]
    if (position.itemIndex >= section.items.length) return null

    return {
      section,
      item: section.items[position.itemIndex],
      position,
    }
  }, [sections, position])

  const navigate = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      if (sections.length === 0) return

      const currentSection = sections[position.sectionIndex]
      if (!currentSection) return

      const isGridSection = currentSection.type === 'grid'
      const gridCols = currentSection.gridCols || 1

      setPosition((prevPosition) => {
        let newSectionIndex = prevPosition.sectionIndex
        let newItemIndex = prevPosition.itemIndex

        if (direction === 'up') {
          if (isGridSection) {
            // In grid: up moves to previous row in same section, or previous section
            if (newItemIndex >= gridCols) {
              newItemIndex -= gridCols
            } else if (newSectionIndex > 0) {
              // Save current position before moving to previous section
              lastPositionInSection.current.set(currentSection.id, newItemIndex)

              // Move to previous section
              newSectionIndex -= 1
              const prevSection = sections[newSectionIndex]

              // Restore last position in that section, or go to end
              const lastPos = lastPositionInSection.current.get(prevSection.id)
              if (lastPos !== undefined && lastPos < prevSection.items.length) {
                newItemIndex = lastPos
              } else {
                newItemIndex = Math.max(0, prevSection.items.length - 1)
              }
            }
          } else {
            // In list: up moves to previous item, or previous section
            if (newItemIndex > 0) {
              newItemIndex -= 1
            } else if (newSectionIndex > 0) {
              // Save current position before moving to previous section
              lastPositionInSection.current.set(currentSection.id, newItemIndex)

              newSectionIndex -= 1
              const prevSection = sections[newSectionIndex]

              // Restore last position in that section, or go to end
              const lastPos = lastPositionInSection.current.get(prevSection.id)
              if (lastPos !== undefined && lastPos < prevSection.items.length) {
                newItemIndex = lastPos
              } else {
                newItemIndex = Math.max(0, prevSection.items.length - 1)
              }
            }
          }
        } else if (direction === 'down') {
          if (isGridSection) {
            // In grid: down moves to next row in same section, or next section
            const maxIndexInCurrentRow = Math.min(
              newItemIndex + gridCols,
              currentSection.items.length - 1
            )

            if (newItemIndex + gridCols < currentSection.items.length) {
              newItemIndex += gridCols
            } else if (newSectionIndex < sections.length - 1) {
              // Save current position before moving to next section
              lastPositionInSection.current.set(currentSection.id, newItemIndex)

              // Move to next section
              newSectionIndex += 1
              const nextSection = sections[newSectionIndex]

              // Restore last position in next section, or start at beginning
              const lastPos = lastPositionInSection.current.get(nextSection.id)
              if (lastPos !== undefined && lastPos < nextSection.items.length) {
                newItemIndex = lastPos
              } else {
                newItemIndex = 0
              }
            }
          } else {
            // In list: down moves to next item, or next section
            if (newItemIndex < currentSection.items.length - 1) {
              newItemIndex += 1
            } else if (newSectionIndex < sections.length - 1) {
              // Save current position before moving to next section
              lastPositionInSection.current.set(currentSection.id, newItemIndex)

              newSectionIndex += 1
              const nextSection = sections[newSectionIndex]

              // Restore last position in next section, or start at beginning
              const lastPos = lastPositionInSection.current.get(nextSection.id)
              if (lastPos !== undefined && lastPos < nextSection.items.length) {
                newItemIndex = lastPos
              } else {
                newItemIndex = 0
              }
            }
          }
        } else if (direction === 'left' && isGridSection) {
          // In grid: left moves to previous item in same row
          if (newItemIndex > 0) {
            const currentRow = Math.floor(newItemIndex / gridCols)
            const newIndex = newItemIndex - 1
            const newRow = Math.floor(newIndex / gridCols)

            // Only move if we stay in the same row
            if (currentRow === newRow) {
              newItemIndex = newIndex
            }
          }
        } else if (direction === 'right' && isGridSection) {
          // In grid: right moves to next item in same row
          if (newItemIndex < currentSection.items.length - 1) {
            const currentRow = Math.floor(newItemIndex / gridCols)
            const newIndex = newItemIndex + 1
            const newRow = Math.floor(newIndex / gridCols)

            // Only move if we stay in the same row
            if (currentRow === newRow) {
              newItemIndex = newIndex
            }
          }
        }

        return { sectionIndex: newSectionIndex, itemIndex: newItemIndex }
      })
    },
    [sections, position]
  )

  // Scroll selected item into view
  useEffect(() => {
    const current = getCurrentItem()
    if (!current) return

    const { section, position: currentPos } = current
    const scrollContainer = scrollRefs.current.get(section.id)

    if (scrollContainer) {
      const itemElement = scrollContainer.querySelector(
        `[data-nav-item="${section.id}-${currentPos.itemIndex}"]`
      ) as HTMLElement

      if (itemElement) {
        // For horizontal scrolling sections (blocks/tools)
        if (section.type === 'grid') {
          const containerRect = scrollContainer.getBoundingClientRect()
          const itemRect = itemElement.getBoundingClientRect()

          // Check if item is outside the visible area horizontally
          if (itemRect.left < containerRect.left) {
            scrollContainer.scrollTo({
              left: scrollContainer.scrollLeft - (containerRect.left - itemRect.left + 20),
              behavior: 'smooth',
            })
          } else if (itemRect.right > containerRect.right) {
            scrollContainer.scrollTo({
              left: scrollContainer.scrollLeft + (itemRect.right - containerRect.right + 20),
              behavior: 'smooth',
            })
          }
        }

        // Always ensure vertical visibility
        itemElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }
  }, [getCurrentItem, position])

  return {
    navigate,
    getCurrentItem,
    scrollRefs,
    position,
  }
}
