'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  type MotionValue,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useSpring,
} from 'framer-motion'

interface Heading {
  text: string
  id: string
  level: number
}

interface TableOfContentsProps {
  headings: Heading[]
}

interface TocSubItem {
  id: string
  label: string
}

interface TocItem {
  id: string
  label: string
  showTopBorder: boolean
  showBottomBorder: boolean
  subItems?: TocSubItem[]
}

interface TocModel {
  items: TocItem[]
  parentByHeadingId: Map<string, string>
}

interface SectionMetric {
  id: string
  top: number
  lineY: number
}

const CONTENTS_ID = '__contents__'
const SCROLL_OFFSET = 108
const INTERSECTION_ROOT_MARGIN = '-16% 0px -66% 0px'

/* Adapted from the root `line-minimap/source.tsx` core. */
const SCROLL_SMOOTHING = 0.5
const DEFAULT_INTENSITY = 0.52
const SUBITEM_INTENSITY = 0.72
const DISTANCE_LIMIT = 48
const POINTER_OUTSIDE = -10_000

const LINE_WIDTH_MAIN = 32
const LINE_WIDTH_MAIN_ACTIVE = 48
const LINE_WIDTH_SUB = 16
const LINE_WIDTH_SUB_ACTIVE = 36
const LINE_SLOT_WIDTH_MAIN = 84
const LINE_SLOT_WIDTH_SUB = 72
const LINE_RAIL_HOVER_WIDTH = LINE_SLOT_WIDTH_MAIN + 16

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function lerp(start: number, end: number, factor: number) {
  return start + (end - start) * factor
}

function transformScale(
  distance: number,
  initialValue: number,
  baseValue: number,
  intensity: number
) {
  if (Math.abs(distance) > DISTANCE_LIMIT) {
    return initialValue
  }

  const normalizedDistance = initialValue - Math.abs(distance) / DISTANCE_LIMIT
  const scaleFactor = normalizedDistance * normalizedDistance
  return baseValue + intensity * scaleFactor
}

function getElementCenterY(element: HTMLElement) {
  const nav = element.closest('nav')
  if (!nav) return null

  const navRect = nav.getBoundingClientRect()
  const rect = element.getBoundingClientRect()
  return rect.top - navRect.top + rect.height / 2
}

function buildTocModel(headings: Heading[]): TocModel {
  const items: TocItem[] = []
  const parentByHeadingId = new Map<string, string>()
  let currentParentId: string | null = null

  headings.forEach((heading) => {
    if (heading.level === 2) {
      items.push({
        id: heading.id,
        label: heading.text,
        showTopBorder: true,
        showBottomBorder: true,
        subItems: [],
      })
      parentByHeadingId.set(heading.id, heading.id)
      currentParentId = heading.id
      return
    }

    if (heading.level === 3 && currentParentId) {
      const currentParent = items.find((item) => item.id === currentParentId)
      if (!currentParent) return

      currentParent.subItems?.push({
        id: heading.id,
        label: heading.text,
      })
      parentByHeadingId.set(heading.id, currentParent.id)
      return
    }

    items.push({
      id: heading.id,
      label: heading.text,
      showTopBorder: true,
      showBottomBorder: true,
      subItems: [],
    })
    parentByHeadingId.set(heading.id, heading.id)
    currentParentId = null
  })

  return {
    items: items.map((item, index) => ({
      ...item,
      showBottomBorder: index < items.length - 1,
    })),
    parentByHeadingId,
  }
}

function getSelectedState(
  activeId: string,
  items: TocItem[],
  parentByHeadingId: Map<string, string>
) {
  if (!activeId) {
    return { selectedItemId: CONTENTS_ID, selectedSubItemId: '' }
  }

  const selectedItemId = parentByHeadingId.get(activeId) ?? activeId
  const selectedItem = items.find((item) => item.id === selectedItemId)

  if (!selectedItem) {
    return { selectedItemId: CONTENTS_ID, selectedSubItemId: '' }
  }

  if (selectedItem.id === activeId) {
    return {
      selectedItemId,
      selectedSubItemId: selectedItem.subItems?.[0]?.id ?? '',
    }
  }

  return {
    selectedItemId,
    selectedSubItemId: activeId,
  }
}

function getScrollTarget(id: string) {
  if (id === CONTENTS_ID) {
    const article = document.querySelector('article')
    if (!article) return null

    return Math.max(window.scrollY + article.getBoundingClientRect().top - SCROLL_OFFSET, 0)
  }

  const element = document.getElementById(id)
  if (!element) return null

  return Math.max(window.scrollY + element.getBoundingClientRect().top - SCROLL_OFFSET, 0)
}

function getInterpolatedCursorY(sections: SectionMetric[], probeY: number, contentsY: number) {
  if (sections.length === 0) return contentsY

  if (probeY <= sections[0].top) {
    return contentsY
  }

  for (let index = 0; index < sections.length - 1; index++) {
    const current = sections[index]
    const next = sections[index + 1]

    if (probeY <= next.top) {
      const progress = clamp((probeY - current.top) / Math.max(next.top - current.top, 1), 0, 1)
      return lerp(current.lineY, next.lineY, progress)
    }
  }

  return sections[sections.length - 1].lineY
}

export function TableOfContents({ headings }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState('')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [isLineRailHovering, setIsLineRailHovering] = useState(false)
  const { items, parentByHeadingId } = buildTocModel(headings)
  const { selectedItemId, selectedSubItemId } = getSelectedState(activeId, items, parentByHeadingId)

  const navRef = useRef<HTMLElement | null>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const lineRefs = useRef(new Map<string, HTMLDivElement | null>())
  const lineCentersRef = useRef(new Map<string, number>())
  const sectionMetricsRef = useRef<SectionMetric[]>([])
  const frameRef = useRef<number | null>(null)
  const isClickScrolling = useRef(false)
  const targetCursorYRef = useRef(0)

  const shouldReduceMotion = useReducedMotion()
  const mouseY = useMotionValue(POINTER_OUTSIDE)
  const scrollCursorY = useSpring(0, {
    stiffness: 500,
    damping: 40,
    mass: 0.8,
  })

  const registerLine = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) {
      lineRefs.current.set(id, node)
      return
    }

    lineRefs.current.delete(id)
  }, [])

  const updateCursorTarget = useCallback(
    (scrollTop: number) => {
      const contentsY = lineCentersRef.current.get(CONTENTS_ID) ?? 10
      const nextY = getInterpolatedCursorY(
        sectionMetricsRef.current,
        scrollTop + SCROLL_OFFSET,
        contentsY
      )

      targetCursorYRef.current = nextY

      if (shouldReduceMotion) {
        scrollCursorY.set(nextY)
      }
    },
    [scrollCursorY, shouldReduceMotion]
  )

  const measureLayout = useCallback(() => {
    const nav = navRef.current
    if (!nav) return

    const centers = new Map<string, number>()

    lineRefs.current.forEach((node, id) => {
      if (!node) return

      const centerY = getElementCenterY(node)
      if (centerY === null) return

      centers.set(id, centerY)
    })

    lineCentersRef.current = centers
    sectionMetricsRef.current = headings.flatMap((heading) => {
      const lineY = centers.get(heading.id)
      const element = document.getElementById(heading.id)

      if (lineY === undefined || !element) return []

      return [
        {
          id: heading.id,
          top: window.scrollY + element.getBoundingClientRect().top,
          lineY,
        },
      ]
    })

    updateCursorTarget(window.scrollY)
  }, [headings, updateCursorTarget])

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current !== null) return

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      measureLayout()
    })
  }, [measureLayout])

  const scrollToId = useCallback((id: string) => {
    const targetTop = getScrollTarget(id)
    if (targetTop === null) return

    isClickScrolling.current = true

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({
      top: targetTop,
      behavior: reduced ? 'auto' : 'smooth',
    })

    if (id !== CONTENTS_ID) {
      window.history.replaceState(null, '', `#${id}`)
      setActiveId(id)
    } else {
      window.history.replaceState(null, '', window.location.pathname)
      setActiveId('')
    }

    window.setTimeout(
      () => {
        isClickScrolling.current = false
      },
      reduced ? 50 : 700
    )
  }, [])

  useEffect(() => {
    if (headings.length === 0) return

    scheduleMeasure()
  }, [headings, scheduleMeasure, selectedItemId])

  useEffect(() => {
    if (headings.length === 0) return

    scheduleMeasure()

    const resizeObserver = new ResizeObserver(scheduleMeasure)
    const nav = navRef.current
    if (nav) resizeObserver.observe(nav)

    headings.forEach((heading) => {
      const element = document.getElementById(heading.id)
      if (element) resizeObserver.observe(element)
    })

    window.addEventListener('resize', scheduleMeasure)

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }

      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleMeasure)
    }
  }, [headings, scheduleMeasure])

  useEffect(() => {
    if (headings.length === 0) return

    const firstHeading = headings[0]
    const onScroll = () => {
      if (!isClickScrolling.current) {
        const element = document.getElementById(firstHeading.id)
        if (element) {
          const firstHeadingTop = window.scrollY + element.getBoundingClientRect().top
          if (window.scrollY + SCROLL_OFFSET < firstHeadingTop) {
            setActiveId('')
          }
        }
      }

      updateCursorTarget(window.scrollY)
    }

    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => window.removeEventListener('scroll', onScroll)
  }, [headings, updateCursorTarget])

  useRequestAnimationFrame(() => {
    if (shouldReduceMotion) return

    const currentY = scrollCursorY.get()
    const smoothY = lerp(currentY, targetCursorYRef.current, SCROLL_SMOOTHING)

    if (Math.abs(smoothY - currentY) > 0.01) {
      scrollCursorY.set(smoothY)
    }
  })

  useEffect(() => {
    observerRef.current?.disconnect()

    if (headings.length === 0) return

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (isClickScrolling.current) return

        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)

        if (visible.length > 0) {
          setActiveId(visible[0].target.id)
        }
      },
      {
        rootMargin: INTERSECTION_ROOT_MARGIN,
        threshold: 0,
      }
    )

    headings.forEach((heading) => {
      const element = document.getElementById(heading.id)
      if (element) observerRef.current?.observe(element)
    })

    return () => observerRef.current?.disconnect()
  }, [headings])

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const nav = navRef.current
      if (!nav) return

      const rect = nav.getBoundingClientRect()
      mouseY.set(event.clientY - rect.top)
      setIsLineRailHovering(event.clientX - rect.left <= LINE_RAIL_HOVER_WIDTH)
    },
    [mouseY]
  )

  const onPointerLeave = useCallback(() => {
    mouseY.set(POINTER_OUTSIDE)
    setIsLineRailHovering(false)
    setHoveredId(null)
  }, [mouseY])

  if (headings.length === 0) return null

  return (
    <nav
      ref={navRef}
      className='flex w-[250px] flex-col'
      aria-label='Table of contents'
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <TocOverline onSelect={scrollToId} registerLine={registerLine} />

      {items.map((item) => (
        <NavItem
          key={item.id}
          item={item}
          hoveredId={hoveredId}
          isSelected={selectedItemId === item.id}
          isLineRailHovering={isLineRailHovering}
          mouseY={mouseY}
          onHoverChange={setHoveredId}
          onSelect={scrollToId}
          registerLine={registerLine}
          scrollCursorY={scrollCursorY}
          selectedSubItemId={selectedSubItemId}
        />
      ))}
    </nav>
  )
}

function TocOverline({
  onSelect,
  registerLine,
}: {
  onSelect: (id: string) => void
  registerLine: (id: string, node: HTMLDivElement | null) => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    registerLine(CONTENTS_ID, ref.current)
    return () => registerLine(CONTENTS_ID, null)
  }, [registerLine])

  return (
    <button
      type='button'
      className='group mb-4 flex items-center bg-transparent p-0 text-left'
      onClick={() => onSelect(CONTENTS_ID)}
    >
      <div className='relative flex w-[84px] shrink-0 items-center justify-start'>
        <div
          ref={ref}
          className='h-px w-8 rounded-full bg-[#484848] transition-colors duration-150 ease-out group-hover:bg-[#5D5D5D]'
        />
      </div>
      <span className='font-medium font-season text-[#FFFFFF] text-[10px] uppercase leading-none tracking-[0.28em] transition-colors duration-150 ease-out group-hover:text-[#A1A1A1]'>
        Table of Contents
      </span>
    </button>
  )
}

function NavItem({
  item,
  hoveredId,
  isSelected,
  isLineRailHovering,
  mouseY,
  onHoverChange,
  onSelect,
  registerLine,
  scrollCursorY,
  selectedSubItemId,
}: {
  item: TocItem
  hoveredId: string | null
  isSelected: boolean
  isLineRailHovering: boolean
  mouseY: MotionValue<number>
  onHoverChange: (id: string | null) => void
  onSelect: (id: string) => void
  registerLine: (id: string, node: HTMLDivElement | null) => void
  scrollCursorY: MotionValue<number>
  selectedSubItemId: string
}) {
  if (item.subItems && item.subItems.length > 0) {
    return (
      <div
        className='relative w-full cursor-pointer py-2 transition-all duration-250 ease-out'
        onClick={() => onSelect(item.id)}
        onPointerEnter={() => onHoverChange(item.id)}
      >
        <div className='group/item relative z-10 flex h-[22px] flex-row items-center transition-all duration-250 ease-out'>
          <NavLine
            isActive={isSelected}
            isHovered={hoveredId === item.id}
            lineId={item.id}
            mouseY={mouseY}
            registerLine={registerLine}
            scrollCursorY={scrollCursorY}
          />
          <NavLabel
            isActive={isSelected}
            isHovered={hoveredId === item.id}
            isLineRailHovering={isLineRailHovering}
            label={item.label}
          />
          {item.showTopBorder ? <NavBorder position='top' /> : null}
          {item.showBottomBorder ? (
            <NavBorder position='bottom' isExpandedBottom={isSelected} />
          ) : null}
        </div>

        <div
          className={clsx(
            'grid transition-[grid-template-rows] duration-250 ease-out',
            isSelected ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          )}
        >
          <div
            className={clsx(
              'overflow-hidden transition-all duration-250 ease-out',
              isSelected ? 'opacity-100 blur-none' : 'opacity-0 blur-sm'
            )}
          >
            <div className='ml-2 flex flex-col'>
              {item.subItems.map((subItem) => (
                <SubNavItem
                  key={subItem.id}
                  item={subItem}
                  isActive={selectedSubItemId === subItem.id}
                  isHovered={hoveredId === subItem.id}
                  isLineRailHovering={isLineRailHovering}
                  mouseY={mouseY}
                  onHoverChange={onHoverChange}
                  onSelect={onSelect}
                  registerLine={registerLine}
                  scrollCursorY={scrollCursorY}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className='group/item z-10 w-max cursor-pointer py-[4px]'
      onClick={() => onSelect(item.id)}
      onPointerEnter={() => onHoverChange(item.id)}
    >
      <div className='relative flex h-[22px] flex-row items-center'>
        <NavLine
          isActive={isSelected}
          isHovered={hoveredId === item.id}
          lineId={item.id}
          mouseY={mouseY}
          registerLine={registerLine}
          scrollCursorY={scrollCursorY}
        />
        <NavLabel
          isActive={isSelected}
          isHovered={hoveredId === item.id}
          isLineRailHovering={isLineRailHovering}
          label={item.label}
        />
        {item.showTopBorder ? <NavBorder position='top' /> : null}
        {item.showBottomBorder ? <NavBorder position='bottom' /> : null}
      </div>
    </div>
  )
}

function SubNavItem({
  item,
  isActive,
  isHovered,
  isLineRailHovering,
  mouseY,
  onHoverChange,
  onSelect,
  registerLine,
  scrollCursorY,
}: {
  item: TocSubItem
  isActive: boolean
  isHovered: boolean
  isLineRailHovering: boolean
  mouseY: MotionValue<number>
  onHoverChange: (id: string | null) => void
  onSelect: (id: string) => void
  registerLine: (id: string, node: HTMLDivElement | null) => void
  scrollCursorY: MotionValue<number>
}) {
  return (
    <div
      className='group/item relative z-10 flex h-[24px] cursor-pointer flex-row items-center transition-all duration-250 ease-out'
      onClick={(event) => {
        event.stopPropagation()
        onSelect(item.id)
      }}
      onPointerEnter={() => onHoverChange(item.id)}
    >
      <NavLine
        isActive={isActive}
        isHovered={isHovered}
        isSubItem
        lineId={item.id}
        mouseY={mouseY}
        registerLine={registerLine}
        scrollCursorY={scrollCursorY}
      />
      <NavLabel
        isActive={isActive}
        isHovered={isHovered}
        isLineRailHovering={isLineRailHovering}
        label={item.label}
      />
      <NavBorder position='bottom' isSubItem />
    </div>
  )
}

function NavLine({
  isActive,
  isHovered,
  isSubItem = false,
  lineId,
  mouseY,
  registerLine,
  scrollCursorY,
}: {
  isActive: boolean
  isHovered: boolean
  isSubItem?: boolean
  lineId: string
  mouseY: MotionValue<number>
  registerLine: (id: string, node: HTMLDivElement | null) => void
  scrollCursorY: MotionValue<number>
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const scaleX = useSpring(1, { damping: 45, stiffness: 600 })

  useEffect(() => {
    registerLine(lineId, ref.current)
    return () => registerLine(lineId, null)
  }, [lineId, registerLine])

  useProximityY(scaleX, {
    intensity: isSubItem ? SUBITEM_INTENSITY : DEFAULT_INTENSITY,
    mouseY,
    ref,
    scrollCursorY,
  })

  const width = isSubItem
    ? isActive || isHovered
      ? LINE_WIDTH_SUB_ACTIVE
      : LINE_WIDTH_SUB
    : isActive || isHovered
      ? LINE_WIDTH_MAIN_ACTIVE
      : LINE_WIDTH_MAIN

  const backgroundColor = isActive || isHovered ? '#ECECEC' : '#3A3A3A'
  const slotWidth = isSubItem ? LINE_SLOT_WIDTH_SUB : LINE_SLOT_WIDTH_MAIN

  return (
    <div
      className={clsx(
        'relative flex shrink-0 items-center justify-start',
        isSubItem ? 'ml-3 w-[72px]' : 'w-[84px]'
      )}
      style={{ width: slotWidth }}
    >
      <motion.div
        ref={ref}
        className='h-px rounded-full'
        animate={{ width, backgroundColor }}
        style={{
          scaleX,
          transformOrigin: 'left center',
        }}
        transition={{
          backgroundColor: { duration: 0.15, ease: 'easeOut' },
          width: { type: 'spring', stiffness: 200, damping: 20 },
        }}
      />
    </div>
  )
}

function NavLabel({
  isActive,
  isHovered,
  isLineRailHovering,
  label,
}: {
  isActive: boolean
  isHovered: boolean
  isLineRailHovering: boolean
  label: string
}) {
  const isSoftened = isLineRailHovering && !isActive && !isHovered

  return (
    <p
      className={clsx(
        'max-w-[184px] truncate font-medium font-season text-[13px] transition-[color,filter,opacity] duration-150 ease-out',
        isActive ? 'text-[#ECECEC]' : 'text-[#777] group-hover/item:text-[#ECECEC]',
        isSoftened ? 'opacity-45 blur-[1.5px]' : 'opacity-100 blur-0'
      )}
    >
      {label}
    </p>
  )
}

function NavBorder({
  position,
  isExpandedBottom = false,
  isSubItem = false,
}: {
  position: 'top' | 'bottom'
  isExpandedBottom?: boolean
  isSubItem?: boolean
}) {
  return (
    <div
      className={clsx(
        'absolute left-0 h-px bg-[#3A3A3A] transition-all duration-250 ease-out',
        position === 'top' ? 'top-0' : 'bottom-0',
        isExpandedBottom ? 'ml-3 w-4' : 'w-8',
        isSubItem && 'ml-3 w-4'
      )}
    />
  )
}

function useProximityY(
  value: MotionValue<number>,
  {
    intensity,
    mouseY,
    ref,
    scrollCursorY,
  }: {
    intensity: number
    mouseY: MotionValue<number>
    ref: React.RefObject<HTMLElement | null>
    scrollCursorY: MotionValue<number>
  }
) {
  const initialValueRef = useRef<number | null>(null)

  useEffect(() => {
    if (initialValueRef.current === null) {
      initialValueRef.current = value.get()
    }
  }, [value])

  useMotionValueEvent(mouseY, 'change', (latest) => {
    const element = ref.current
    const initialValue = initialValueRef.current
    if (!element || initialValue === null) return

    if (latest <= POINTER_OUTSIDE / 2) {
      value.set(initialValue)
      return
    }

    const centerY = getElementCenterY(element)
    if (centerY === null) return

    const distance = latest - centerY
    value.set(transformScale(distance, initialValue, 1, intensity))
  })

  useMotionValueEvent(scrollCursorY, 'change', (latest) => {
    const element = ref.current
    const initialValue = initialValueRef.current
    if (!element || initialValue === null) return

    const centerY = getElementCenterY(element)
    if (centerY === null) return

    const distance = latest - centerY
    const targetScale = transformScale(distance, initialValue, 1, intensity)
    const velocityFactor = Math.min(1, Math.abs(scrollCursorY.getVelocity()) / 300)
    value.set(lerp(initialValue, targetScale, velocityFactor))
  })
}

function useRequestAnimationFrame(callback: () => void) {
  const callbackRef = useRef(callback)
  const requestRef = useRef<number | null>(null)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    const animate = () => {
      callbackRef.current()
      requestRef.current = window.requestAnimationFrame(animate)
    }

    requestRef.current = window.requestAnimationFrame(animate)

    return () => {
      if (requestRef.current !== null) {
        window.cancelAnimationFrame(requestRef.current)
      }
    }
  }, [])
}
