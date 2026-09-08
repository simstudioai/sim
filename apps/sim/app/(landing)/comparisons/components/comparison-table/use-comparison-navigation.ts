'use client'

import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { COMPARISON_SECTIONS } from '@/app/(landing)/comparisons/comparison-sections'

/** Remeasures section bounds when content or layout changes; native sticky positioning owns motion. */
export function useComparisonNavigation(content: ReactNode) {
  const layoutRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const restoredHashRef = useRef(false)
  const [activeId, setActiveId] = useState(COMPARISON_SECTIONS[0]?.id)

  useLayoutEffect(() => {
    const layout = layoutRef.current
    const table = tableRef.current
    const columnHeader = headerRef.current
    const navbar = document.querySelector('[data-landing-header]')

    if (!layout || !table || !columnHeader) return

    const sectionHeader = table.querySelector('[data-comparison-section-header]')
    const getTargets = () =>
      COMPARISON_SECTIONS.map((section) =>
        table.querySelector<HTMLElement>(`#${section.id}`)
      ).filter((target): target is HTMLElement => target !== null)
    let scrollContainer = layout.parentElement
    while (
      scrollContainer &&
      !['auto', 'scroll'].includes(getComputedStyle(scrollContainer).overflowY)
    ) {
      scrollContainer = scrollContainer.parentElement
    }
    const scrollSource = scrollContainer ?? window

    /** Track each section's introduction or first fact below the sticky headers. */
    const updateActiveSection = () => {
      const targets = getTargets().map((target) => ({
        id: target.id,
        top: target.getBoundingClientRect().top,
      }))
      const headerBottom = columnHeader.getBoundingClientRect().bottom
      const top = headerBottom + (sectionHeader?.getBoundingClientRect().height ?? 0)
      let currentId = targets[0]?.id
      for (const target of targets) {
        if (target.top > top + 1) break
        currentId = target.id
      }

      setActiveId(currentId)
    }

    const updateOffsets = () => {
      layout.style.setProperty(
        '--comparison-header-height',
        `${columnHeader.getBoundingClientRect().height}px`
      )
      if (navbar) {
        layout.style.setProperty(
          '--comparison-navbar-height',
          `${navbar.getBoundingClientRect().height}px`
        )
      }
      if (sectionHeader) {
        layout.style.setProperty(
          '--comparison-section-height',
          `${sectionHeader.getBoundingClientRect().height}px`
        )
      }
      /** Section spans change with layout, while the browser owns every scrolling position. */
      const cells = Array.from(
        table.querySelectorAll<HTMLElement>('[data-comparison-category-cell]')
      ).map((cell) => ({ cell, rect: cell.getBoundingClientRect() }))
      const tableBottom =
        table.getBoundingClientRect().bottom -
        (Number.parseFloat(getComputedStyle(table).borderBottomWidth) || 0)

      cells.forEach(({ cell, rect }, index) => {
        if (!rect.height) return
        const bottom = cells[index + 1]?.rect.top ?? tableBottom
        cell.style.setProperty('--comparison-category-span', `${bottom - rect.top}px`)
      })
      updateActiveSection()
    }

    updateOffsets()
    if (!restoredHashRef.current) {
      restoredHashRef.current = true
      const initialTarget = getTargets().find((target) => `#${target.id}` === window.location.hash)
      if (initialTarget) {
        initialTarget.scrollIntoView({ behavior: 'instant', block: 'start' })
        updateActiveSection()
      }
    }

    const observer = new ResizeObserver(updateOffsets)
    observer.observe(table)
    observer.observe(columnHeader)
    if (navbar) observer.observe(navbar)
    if (sectionHeader) observer.observe(sectionHeader)
    scrollSource.addEventListener('scroll', updateActiveSection, { passive: true })

    return () => {
      observer.disconnect()
      scrollSource.removeEventListener('scroll', updateActiveSection)
    }
  }, [content])

  return { layoutRef, tableRef, headerRef, activeId }
}
