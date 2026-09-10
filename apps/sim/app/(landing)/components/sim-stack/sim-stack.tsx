'use client'

import { useState } from 'react'
import { cn } from '@sim/emcn'
import { LANDING_CONTENT_WIDTH } from '@/app/(landing)/components/landing-layout'
import { EdgeFade } from '@/app/(landing)/components/shared/edge-fade'
import { StackArtwork } from '@/app/(landing)/components/sim-stack/stack-artwork'
import { StackDescription } from '@/app/(landing)/components/sim-stack/stack-description'
import { StackIntro } from '@/app/(landing)/components/sim-stack/stack-intro'
import { StackPlayer } from '@/app/(landing)/components/sim-stack/stack-player'
import type { StackInspection } from '@/app/(landing)/components/sim-stack/stack-scene'
import { STACK_PLAYBACK_END } from '@/app/(landing)/components/sim-stack/stack-timeline'
import { useStackScroll } from '@/app/(landing)/components/sim-stack/use-stack-scroll'

/** A scroll-built view of Sim, from the governance foundation to the shared workspace. */
export function SimStack() {
  const { trackRef, stageRef, progress, active, isPlaying, selectLayer, togglePlayback } =
    useStackScroll()
  const [inspection, setInspection] = useState<StackInspection | null>(null)
  const complete = progress >= STACK_PLAYBACK_END - 0.01
  const currentInspection = complete ? inspection : null
  return (
    <section id='sim-stack' aria-labelledby='sim-stack-heading'>
      <div
        ref={trackRef}
        data-stack-track
        className='relative h-[460svh] motion-reduce:h-auto [@media(max-height:760px)]:h-auto'
      >
        <div
          ref={stageRef}
          data-stack-stage
          className='sticky top-[62px] h-[calc(100svh-62px)] min-h-[560px] overflow-hidden bg-[var(--bg)] motion-reduce:relative motion-reduce:top-0 max-sm:min-h-[620px] [@media(max-height:760px)]:relative [@media(max-height:760px)]:top-0 [@media(max-height:760px)]:h-[800px] [@media(max-height:760px)_and_(max-width:639px)]:h-[calc(100svh-62px)] [@media(max-height:760px)_and_(max-width:639px)]:min-h-[500px]'
        >
          <div className={cn('relative h-full', LANDING_CONTENT_WIDTH)}>
            <div
              id='sim-stack-artwork'
              className='-translate-x-1/2 pointer-events-none absolute inset-y-0 left-1/2 isolate w-[55%] [contain:paint] max-xl:bottom-[100px] max-xl:w-full [@media(max-height:760px)_and_(max-width:639px)]:bottom-[72px]'
            >
              <StackArtwork progress={progress} active={active} onInspect={setInspection} />
              <div className='pointer-events-none absolute inset-0 max-sm:[&>div]:h-[440px] max-xl:[&>div]:h-[320px] [@media(max-height:760px)_and_(max-width:639px)]:[&>div]:h-[300px]'>
                <div className='absolute inset-x-0 top-0 hidden bg-[linear-gradient(to_bottom,var(--bg)_35%,transparent_100%)] max-sm:block' />
                <EdgeFade ground='canvas' edges={['top']} depth='heading' />
              </div>
            </div>
            <StackIntro progress={progress} />
            <div className='absolute top-[192px] left-10 z-10 w-[300px] max-sm:top-[144px] max-xl:top-[168px] max-xl:right-7 max-xl:left-7 max-xl:w-auto max-xl:text-center'>
              <StackDescription
                active={currentInspection?.index ?? active}
                progress={currentInspection?.progress ?? progress}
                instant={complete}
              />
            </div>
            <div className='-translate-x-1/2 absolute bottom-7 left-1/2 z-10 max-xl:bottom-5'>
              <StackPlayer
                progress={progress}
                isPlaying={isPlaying}
                onToggle={togglePlayback}
                onSelect={selectLayer}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
