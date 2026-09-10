'use client'

import { useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useTheme } from 'next-themes'
import { StackFallback } from '@/app/(landing)/components/sim-stack/stack-fallback'
import type { StackInspection, StackScene } from '@/app/(landing)/components/sim-stack/stack-scene'

const logger = createLogger('SimStack')

interface StackArtworkProps {
  progress: number
  active: number
  onInspect: (inspection: StackInspection | null) => void
}

/** Load the material scene near the viewport; retain vector artwork without WebGL. */
export function StackArtwork({ progress, active, onInspect }: StackArtworkProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<StackScene | null>(null)
  const latestRef = useRef({ progress, active, dark: false })
  const { resolvedTheme } = useTheme()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    latestRef.current = { progress, active, dark: resolvedTheme === 'dark' }
    sceneRef.current?.update(latestRef.current)
  }, [progress, active, resolvedTheme])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let loading = false
    let visible = false
    const handleLoss = () => {
      sceneRef.current?.dispose()
      sceneRef.current = null
      onInspect(null)
      setReady(false)
    }
    const load = async () => {
      loading = true
      try {
        const { createStackScene } = await import(
          '@/app/(landing)/components/sim-stack/stack-scene'
        )
        await document.fonts.ready
        if (cancelled) return
        const scene = createStackScene(host, handleLoss, onInspect)
        sceneRef.current = scene
        scene.update(latestRef.current)
        scene.setVisible(visible)
        setReady(true)
      } catch (error) {
        logger.warn('Using vector stack artwork', { error })
      }
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting
        sceneRef.current?.setVisible(visible)
        if (visible && !loading) void load()
      },
      { rootMargin: '300px' }
    )
    observer.observe(host)
    return () => {
      cancelled = true
      observer.disconnect()
      sceneRef.current?.dispose()
      sceneRef.current = null
    }
  }, [onInspect])

  return (
    <div
      aria-hidden='true'
      className='relative size-full'
      data-stack-renderer={ready ? 'three' : 'svg'}
    >
      {!ready && (
        <div className='absolute inset-0 max-sm:pt-[240px] max-xl:pt-[280px] max-sm:[&>svg]:scale-[1.14]'>
          <StackFallback progress={progress} active={active} dark={resolvedTheme === 'dark'} />
        </div>
      )}
      <div
        ref={hostRef}
        className='absolute inset-0 [--stack-scene-inset:0px] max-sm:[--stack-scene-inset:240px] max-xl:[--stack-scene-inset:280px] [&>canvas]:block [&>canvas]:size-full'
      />
    </div>
  )
}
