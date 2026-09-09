'use client'

import { type TouchEvent, useEffect, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import {
  FeaturedCustomerCard,
  type FeaturedCustomerStory,
} from '@/app/(landing)/components/featured-customer/featured-customer-card'
import { FeaturedCustomerNavigationButton } from '@/app/(landing)/components/featured-customer/featured-customer-navigation-button'
import {
  LANDING_CONTENT_WIDTH,
  LANDING_GUTTER,
  LANDING_STAGE_RADIUS,
} from '@/app/(landing)/components/landing-layout'

const WHEEL_GESTURE_GAP_MS = 200
const WHEEL_THRESHOLD_PX = 50

const CUSTOMER_STORIES: FeaturedCustomerStory[] = [
  {
    id: 'rivian',
    company: 'Rivian',
    caption: 'Connect systems and build, deploy, and manage AI agents with Sim.',
    media: {
      kind: 'video',
      poster: '/landing/customer-stories/rivian-r2-poster.jpg',
      src: '/landing/customer-stories/rivian-r2-loop.mp4',
      alt: 'Rivian R2 driving along a forest road',
    },
    logo: {
      src: '/landing/logos/rivian-vw.svg',
      alt: 'Rivian | Volkswagen Group Technologies',
      aspect: 10.72,
      height: 20,
    },
  },
  {
    id: 'exp-realty',
    company: 'eXp Realty',
    caption: 'Bring teams, shared knowledge, and AI agents into one workspace with Sim.',
    media: {
      kind: 'video',
      poster: '/landing/customer-stories/exp-house-color-poster.jpg',
      src: '/landing/customer-stories/exp-house-color-loop.mp4',
      alt: 'An eXp Realty sign and the exterior of a modern home',
    },
    logo: { src: '/landing/logos/exp-realty.svg', alt: 'eXp Realty', aspect: 1.84, height: 32 },
  },
]

/**
 * Customer-story carousel with one full-emphasis card and a reduced-scale
 * adjacent preview. Only the active film card plays video; an inactive film
 * holds its current frame, and a brand card uses its own wordmark. A previous/next pair on the page
 * ground above the film, fixed flush with the first card's right edge, moves
 * between stories, with the arrow that has nowhere to go disabled.
 */
export function FeaturedCustomer() {
  const railRef = useRef<HTMLDivElement>(null)
  const touchStartRef = useRef<{ id: number; x: number; y: number } | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [previewedIndex, setPreviewedIndex] = useState<number | null>(null)
  const activeStory = CUSTOMER_STORIES[activeIndex]
  const previousStory = activeIndex > 0 ? CUSTOMER_STORIES[activeIndex - 1] : null
  const nextStory =
    activeIndex < CUSTOMER_STORIES.length - 1 ? CUSTOMER_STORIES[activeIndex + 1] : null

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return

    let distance = 0
    let lastEventAt = 0
    let advanced = false

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return

      const now = performance.now()
      if (now - lastEventAt > WHEEL_GESTURE_GAP_MS) {
        distance = 0
        advanced = false
      }
      lastEventAt = now

      const deltaX = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX
      const deltaY = event.shiftKey ? 0 : event.deltaY
      if (deltaX === 0 || Math.abs(deltaX) <= Math.abs(deltaY)) {
        distance = 0
        return
      }

      event.preventDefault()
      if (advanced) return

      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rail.clientWidth : 1
      distance += deltaX * unit
      if (Math.abs(distance) < WHEEL_THRESHOLD_PX) return

      advanced = true
      const direction = distance > 0 ? 1 : -1
      setPreviewedIndex(null)
      setActiveIndex((index) =>
        Math.max(0, Math.min(CUSTOMER_STORIES.length - 1, index + direction))
      )
    }

    rail.addEventListener('wheel', handleWheel, { passive: false })
    return () => rail.removeEventListener('wheel', handleWheel)
  }, [])

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0]
    touchStartRef.current =
      event.touches.length === 1
        ? { id: touch.identifier, x: touch.clientX, y: touch.clientY }
        : null
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = touchStartRef.current
    touchStartRef.current = null
    if (!start || event.touches.length > 0) return

    const touch = Array.from(event.changedTouches).find((touch) => touch.identifier === start.id)
    if (!touch) return

    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) < 50 || Math.abs(deltaX) <= Math.abs(deltaY)) return

    event.preventDefault()
    setPreviewedIndex(null)
    setActiveIndex((index) =>
      Math.max(0, Math.min(CUSTOMER_STORIES.length - 1, index + (deltaX < 0 ? 1 : -1)))
    )
  }

  return (
    <section
      id='featured-customer'
      aria-label='Featured customer stories'
      aria-roledescription='carousel'
      className='w-full overflow-hidden'
    >
      <div className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER)}>
        <div className='mb-4 flex items-center justify-end gap-2 xl:pr-24'>
          <FeaturedCustomerNavigationButton
            direction='previous'
            label={
              previousStory
                ? `View ${previousStory.company} customer story`
                : 'Previous customer story'
            }
            disabled={!previousStory}
            onSelect={() => setActiveIndex(activeIndex - 1)}
          />
          <FeaturedCustomerNavigationButton
            direction='next'
            label={nextStory ? `View ${nextStory.company} customer story` : 'Next customer story'}
            disabled={!nextStory}
            onSelect={() => setActiveIndex(activeIndex + 1)}
          />
        </div>

        <div
          ref={railRef}
          data-customer-carousel-rail='true'
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={() => {
            touchStartRef.current = null
          }}
          className={cn(
            'touch-pan-y touch-pinch-zoom transition-[translate] duration-600 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none xl:pr-24',
            activeIndex > 0 && 'xl:translate-x-24'
          )}
        >
          <div className='relative isolate aspect-[2/1] w-full max-sm:aspect-[4/5]'>
            {CUSTOMER_STORIES.map((story, index) => {
              const isActive = index === activeIndex
              const isNext = index > activeIndex
              const isPreviewed = previewedIndex === index

              return (
                <div
                  key={story.id}
                  role='group'
                  aria-roledescription='slide'
                  aria-label={`${index + 1} of ${CUSTOMER_STORIES.length}: ${story.company}`}
                  aria-current={isActive ? 'true' : undefined}
                  onMouseEnter={() => !isActive && setPreviewedIndex(index)}
                  onMouseLeave={() => setPreviewedIndex(null)}
                  onFocus={() => !isActive && setPreviewedIndex(index)}
                  onBlur={() => setPreviewedIndex(null)}
                  className={cn(
                    'absolute inset-0 transition-[translate,scale,opacity] duration-600 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                    index === 0 ? 'origin-right' : 'origin-left',
                    isActive && 'z-10 translate-x-0 scale-100 opacity-100',
                    !isActive &&
                      isNext &&
                      'z-20 translate-x-[calc(100%_+_1.5rem)] scale-[0.92] max-sm:translate-x-[calc(100%_+_0.75rem)] max-sm:scale-[0.96]',
                    !isActive &&
                      !isNext &&
                      '-translate-x-[calc(100%_+_1.5rem)] max-sm:-translate-x-[calc(100%_+_0.75rem)] z-20 scale-[0.92] max-sm:scale-[0.96]',
                    !isActive && (isPreviewed ? 'opacity-100' : 'opacity-75')
                  )}
                >
                  <FeaturedCustomerCard
                    story={story}
                    active={isActive}
                    emphasized={isActive || isPreviewed}
                  />
                  {!isActive && (
                    <button
                      type='button'
                      aria-label={`Open ${story.company} customer story`}
                      onClick={() => {
                        setPreviewedIndex(null)
                        setActiveIndex(index)
                      }}
                      className={cn(
                        'focus-visible:-outline-offset-4 absolute inset-0 z-30 cursor-pointer bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/80',
                        LANDING_STAGE_RADIUS
                      )}
                    />
                  )}
                </div>
              )
            })}

            <span className='sr-only' aria-live='polite'>
              {activeStory.company} customer story selected
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
