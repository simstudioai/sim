import { useCallback, useEffect, useRef, useState } from 'react'
import type { NavigationPosition, NavigationSection } from '../search-modal'

export function useSearchNavigation(sections: NavigationSection[], open: boolean) {
  const [position, setPosition] = useState<NavigationPosition>({ sectionIndex: 0, itemIndex: 0 })
  const scrollRefs = useRef<Map<string, HTMLElement>>(new Map())
  const lastItemIndex = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    if (open) {
      setPosition({ sectionIndex: 0, itemIndex: 0 })
    }
  }, [open, sections])

  const getCurrentItem = useCallback(() => {
    const section = sections[position.sectionIndex]
    if (!section || position.itemIndex >= section.items.length) return null

    return {
      section,
      item: section.items[position.itemIndex],
      position,
    }
  }, [sections, position])

  const navigate = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      setPosition((prev) => {
        const section = sections[prev.sectionIndex]
        if (!section) return prev

        switch (direction) {
          case 'down':
            if (section.type === 'grid' && section.gridCols) {
              const totalRows = section.id === 'templates' ? 1 : 2
              const currentCol = Math.floor(prev.itemIndex / totalRows)
              const currentRow = prev.itemIndex % totalRows

              if (currentRow < totalRows - 1) {
                const nextIndex = currentCol * totalRows + (currentRow + 1)
                if (nextIndex < section.items.length) {
                  return { ...prev, itemIndex: nextIndex }
                }
              }
            } else if (section.type === 'list') {
              if (prev.itemIndex < section.items.length - 1) {
                return { ...prev, itemIndex: prev.itemIndex + 1 }
              }
            }
            if (prev.sectionIndex < sections.length - 1) {
              const nextSection = sections[prev.sectionIndex + 1]

              lastItemIndex.current.set(section.id, prev.itemIndex)

              const rememberedIndex = lastItemIndex.current.get(nextSection.id)
              const targetIndex =
                rememberedIndex !== undefined
                  ? Math.min(rememberedIndex, nextSection.items.length - 1)
                  : 0

              return { sectionIndex: prev.sectionIndex + 1, itemIndex: targetIndex }
            }
            return prev

          case 'up':
            if (section.type === 'grid' && section.gridCols) {
              const totalRows = section.id === 'templates' ? 1 : 2
              const currentCol = Math.floor(prev.itemIndex / totalRows)
              const currentRow = prev.itemIndex % totalRows

              if (currentRow > 0) {
                const prevIndex = currentCol * totalRows + (currentRow - 1)
                return { ...prev, itemIndex: prevIndex }
              }
            } else if (section.type === 'list') {
              if (prev.itemIndex > 0) {
                return { ...prev, itemIndex: prev.itemIndex - 1 }
              }
            }
            if (prev.sectionIndex > 0) {
              const prevSection = sections[prev.sectionIndex - 1]

              lastItemIndex.current.set(section.id, prev.itemIndex)

              const rememberedIndex = lastItemIndex.current.get(prevSection.id)
              const targetIndex =
                rememberedIndex !== undefined
                  ? Math.min(rememberedIndex, prevSection.items.length - 1)
                  : prevSection.items.length - 1

              return { sectionIndex: prev.sectionIndex - 1, itemIndex: targetIndex }
            }
            return prev

          case 'right':
            if (section.type === 'grid' && section.gridCols) {
              const totalRows = section.id === 'templates' ? 1 : 2
              const currentCol = Math.floor(prev.itemIndex / totalRows)
              const currentRow = prev.itemIndex % totalRows
              const totalCols = Math.ceil(section.items.length / totalRows)

              if (currentCol < totalCols - 1) {
                const nextIndex = (currentCol + 1) * totalRows + currentRow
                if (nextIndex < section.items.length) {
                  return { ...prev, itemIndex: nextIndex }
                }
              }
            } else if (section.type === 'list') {
              if (prev.itemIndex < section.items.length - 1) {
                return { ...prev, itemIndex: prev.itemIndex + 1 }
              }
            }
            return prev

          case 'left':
            if (section.type === 'grid' && section.gridCols) {
              const totalRows = section.id === 'templates' ? 1 : 2
              const currentCol = Math.floor(prev.itemIndex / totalRows)
              const currentRow = prev.itemIndex % totalRows

              if (currentCol > 0) {
                const prevIndex = (currentCol - 1) * totalRows + currentRow
                return { ...prev, itemIndex: prevIndex }
              }
            } else if (section.type === 'list') {
              if (prev.itemIndex > 0) {
                return { ...prev, itemIndex: prev.itemIndex - 1 }
              }
            }
            return prev

          default:
            return prev
        }
      })
    },
    [sections]
  )

  const scrollIntoView = useCallback(() => {
    const current = getCurrentItem()
    if (!current) return

    const container = scrollRefs.current.get(current.section.id)
    if (!container) return

    const itemSelector = `[data-nav-item="${current.section.id}-${current.position.itemIndex}"]`
    const element = container.querySelector(itemSelector) as HTMLElement
    if (!element) return

    element.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    })
  }, [getCurrentItem])

  useEffect(() => {
    if (open) {
      const timer = setTimeout(scrollIntoView, 10)
      return () => clearTimeout(timer)
    }
  }, [position, open, scrollIntoView])

  return {
    position,
    navigate,
    getCurrentItem,
    scrollRefs,
  }
}
