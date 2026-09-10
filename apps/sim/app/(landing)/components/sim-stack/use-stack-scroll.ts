'use client'

import { useEffect, useRef, useState } from 'react'
import { STACK_LAYERS } from '@/app/(landing)/components/sim-stack/stack-content'
import {
  STACK_LAYER_REST,
  STACK_PLAYBACK_END,
  STACK_SCROLL_END,
} from '@/app/(landing)/components/sim-stack/stack-timeline'

const NAV_HEIGHT = 62
const STEP_DURATION = 3000
const LAST_LAYER = STACK_LAYERS.length - 1

interface StackControls {
  seek: (index: number) => void
  toggle: () => void
}

/** Playback advances the same native scroll timeline; manual input takes control immediately. */
export function useStackScroll() {
  const trackRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<StackControls | null>(null)
  const [progress, setProgress] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const active = Math.min(LAST_LAYER, Math.floor(progress))

  useEffect(() => {
    const track = trackRef.current
    const stage = stageRef.current
    const scrollPort = track?.closest('main')?.parentElement
    if (!track || !stage || !scrollPort) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce), (max-height: 760px)')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let scrollFrame = 0
    let playbackFrame = 0
    let current = 0
    let playhead = 0
    let playing = false
    let lastTime = 0

    const commit = (next: number) => {
      current = Math.min(STACK_SCROLL_END, Math.max(0, next))
      setProgress(current)
    }
    const pause = () => {
      playing = false
      setIsPlaying(false)
      cancelAnimationFrame(playbackFrame)
      playbackFrame = 0
    }
    const readScroll = () => {
      scrollFrame = 0
      if (media.matches || playing) return
      const travel = track.offsetHeight - stage.offsetHeight
      if (travel <= 0) return
      const distance =
        scrollPort.getBoundingClientRect().top + NAV_HEIGHT - track.getBoundingClientRect().top
      commit((distance / travel) * STACK_SCROLL_END)
      playhead = current
    }
    const scheduleScroll = () => {
      if (!scrollFrame) scrollFrame = requestAnimationFrame(readScroll)
    }
    const seekProgress = (next: number, behavior: ScrollBehavior = 'instant') => {
      if (media.matches) {
        commit(next)
        return
      }
      const start =
        scrollPort.scrollTop +
        track.getBoundingClientRect().top -
        scrollPort.getBoundingClientRect().top -
        NAV_HEIGHT
      const travel = track.offsetHeight - stage.offsetHeight
      scrollPort.scrollTo({ top: start + (next / STACK_SCROLL_END) * travel, behavior })
      if (behavior === 'instant') commit(next)
    }
    const tick = (time: number) => {
      playbackFrame = 0
      const bounds = stage.getBoundingClientRect()
      if (
        !playing ||
        document.hidden ||
        bounds.bottom <= NAV_HEIGHT ||
        bounds.top >= window.innerHeight
      ) {
        pause()
        return
      }
      playhead = Math.min(
        STACK_PLAYBACK_END,
        playhead + Math.min(time - lastTime, 64) / STEP_DURATION
      )
      lastTime = time
      const next = reducedMotion.matches
        ? Math.min(STACK_PLAYBACK_END, Math.floor(playhead) + STACK_LAYER_REST)
        : playhead
      seekProgress(next)
      if (playhead >= STACK_PLAYBACK_END) pause()
      else playbackFrame = requestAnimationFrame(tick)
    }
    controlsRef.current = {
      seek(index) {
        pause()
        seekProgress(index + STACK_LAYER_REST, 'smooth')
      },
      toggle() {
        if (playing) {
          pause()
          return
        }
        if (current >= STACK_PLAYBACK_END - 0.01) {
          seekProgress(reducedMotion.matches ? STACK_LAYER_REST : 0)
          playhead = 0
        } else {
          playhead = reducedMotion.matches ? Math.floor(current) : current
        }
        playing = true
        setIsPlaying(true)
        lastTime = performance.now()
        playbackFrame = requestAnimationFrame(tick)
      },
    }
    const handleResize = () => {
      const bounds = stage.getBoundingClientRect()
      if (
        current > 0 &&
        current < STACK_SCROLL_END &&
        bounds.bottom > NAV_HEIGHT &&
        bounds.top < window.innerHeight
      ) {
        seekProgress(current)
      } else {
        scheduleScroll()
      }
    }
    const updateMotion = () => {
      pause()
      if (reducedMotion.matches) commit(STACK_SCROLL_END)
      else handleResize()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('input, textarea, select, [contenteditable]')
      )
        return
      if (event.key === ' ' && event.target instanceof Element && event.target.closest('button'))
        return
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key))
        pause()
    }
    const handlePointerInput = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('button')) return
      pause()
    }
    const handleVisibility = () => {
      if (document.hidden) pause()
    }
    if (media.matches) commit(STACK_SCROLL_END)
    scrollPort.addEventListener('scroll', scheduleScroll, { passive: true })
    scrollPort.addEventListener('wheel', pause, { passive: true })
    scrollPort.addEventListener('touchstart', handlePointerInput, { passive: true })
    scrollPort.addEventListener('pointerdown', handlePointerInput, { passive: true })
    scrollPort.addEventListener('keydown', handleKeyDown)
    document.addEventListener('visibilitychange', handleVisibility)
    media.addEventListener('change', updateMotion)
    reducedMotion.addEventListener('change', updateMotion)
    window.addEventListener('resize', handleResize)
    const observer = new ResizeObserver(scheduleScroll)
    observer.observe(track)
    observer.observe(scrollPort)
    scheduleScroll()
    return () => {
      cancelAnimationFrame(scrollFrame)
      cancelAnimationFrame(playbackFrame)
      controlsRef.current = null
      observer.disconnect()
      scrollPort.removeEventListener('scroll', scheduleScroll)
      scrollPort.removeEventListener('wheel', pause)
      scrollPort.removeEventListener('touchstart', handlePointerInput)
      scrollPort.removeEventListener('pointerdown', handlePointerInput)
      scrollPort.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('visibilitychange', handleVisibility)
      media.removeEventListener('change', updateMotion)
      reducedMotion.removeEventListener('change', updateMotion)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  return {
    trackRef,
    stageRef,
    progress,
    active,
    isPlaying,
    selectLayer: (index: number) => controlsRef.current?.seek(index),
    togglePlayback: () => controlsRef.current?.toggle(),
  }
}
