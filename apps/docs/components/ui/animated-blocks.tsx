'use client'

import { memo, useEffect, useState } from 'react'

/** Shared corner radius from Figma export for all decorative rects. */
const RX = '2.59574'

const ENTER_STAGGER = 0.06
const ENTER_DURATION = 0.3
const EXIT_STAGGER = 0.12
const EXIT_DURATION = 0.5
const INITIAL_HOLD = 3000
const HOLD_BETWEEN = 3000
const TRANSITION_PAUSE = 400

interface BlockRect {
  opacity: number
  width: string
  height: string
  fill: string
  x?: string
  y?: string
  transform?: string
}

type AnimState = 'visible' | 'exiting' | 'hidden'

const RECTS = {
  topRight: [
    { opacity: 1, x: '0', y: '0', width: '16.8626', height: '33.7252', fill: '#2ABBF8' },
    { opacity: 0.6, x: '0', y: '0', width: '85.3433', height: '16.8626', fill: '#2ABBF8' },
    { opacity: 1, x: '0', y: '0', width: '16.8626', height: '16.8626', fill: '#2ABBF8' },
    { opacity: 0.6, x: '34.2403', y: '0', width: '34.2403', height: '33.7252', fill: '#2ABBF8' },
    { opacity: 1, x: '34.2403', y: '0', width: '16.8626', height: '16.8626', fill: '#2ABBF8' },
    {
      opacity: 1,
      x: '51.6188',
      y: '16.8626',
      width: '16.8626',
      height: '16.8626',
      fill: '#2ABBF8',
    },
    { opacity: 1, x: '68.4812', y: '0', width: '54.6502', height: '16.8626', fill: '#00F701' },
    { opacity: 0.6, x: '106.268', y: '0', width: '34.2403', height: '33.7252', fill: '#00F701' },
    { opacity: 0.6, x: '106.268', y: '0', width: '51.103', height: '16.8626', fill: '#00F701' },
    {
      opacity: 1,
      x: '123.6484',
      y: '16.8626',
      width: '16.8626',
      height: '16.8626',
      fill: '#00F701',
    },
    { opacity: 0.6, x: '157.371', y: '0', width: '34.2403', height: '16.8626', fill: '#FFCC02' },
    { opacity: 1, x: '157.371', y: '0', width: '16.8626', height: '16.8626', fill: '#FFCC02' },
    { opacity: 0.6, x: '208.993', y: '0', width: '68.4805', height: '16.8626', fill: '#FA4EDF' },
    { opacity: 0.6, x: '209.137', y: '0', width: '16.8626', height: '33.7252', fill: '#FA4EDF' },
    { opacity: 0.6, x: '243.233', y: '0', width: '34.2403', height: '33.7252', fill: '#FA4EDF' },
    { opacity: 1, x: '243.233', y: '0', width: '16.8626', height: '16.8626', fill: '#FA4EDF' },
    { opacity: 0.6, x: '260.096', y: '0', width: '34.04', height: '16.8626', fill: '#FA4EDF' },
    {
      opacity: 1,
      x: '260.611',
      y: '16.8626',
      width: '16.8626',
      height: '16.8626',
      fill: '#FA4EDF',
    },
  ],
  left: [
    {
      opacity: 0.6,
      width: '34.240',
      height: '33.725',
      fill: '#FA4EDF',
      transform: 'matrix(0 1 1 0 0 0)',
    },
    {
      opacity: 0.6,
      width: '16.8626',
      height: '68.480',
      fill: '#FA4EDF',
      transform: 'matrix(-1 0 0 1 33.727 0)',
    },
    {
      opacity: 1,
      width: '16.8626',
      height: '16.8626',
      fill: '#FA4EDF',
      transform: 'matrix(-1 0 0 1 33.727 17.378)',
    },
    {
      opacity: 0.6,
      width: '16.8626',
      height: '33.986',
      fill: '#FA4EDF',
      transform: 'matrix(0 1 1 0 0 51.616)',
    },
    {
      opacity: 0.6,
      width: '16.8626',
      height: '140.507',
      fill: '#00F701',
      transform: 'matrix(-1 0 0 1 33.986 85.335)',
    },
    {
      opacity: 0.4,
      x: '17.119',
      y: '136.962',
      width: '34.240',
      height: '16.8626',
      fill: '#FFCC02',
      transform: 'rotate(-90 17.119 136.962)',
    },
    {
      opacity: 1,
      x: '17.119',
      y: '136.962',
      width: '16.8626',
      height: '16.8626',
      fill: '#FFCC02',
      transform: 'rotate(-90 17.119 136.962)',
    },
    {
      opacity: 0.5,
      width: '34.240',
      height: '33.725',
      fill: '#00F701',
      transform: 'matrix(0 1 1 0 0.257 153.825)',
    },
    {
      opacity: 1,
      width: '16.8626',
      height: '16.8626',
      fill: '#00F701',
      transform: 'matrix(0 1 1 0 0.257 153.825)',
    },
  ],
  right: [
    {
      opacity: 0.6,
      width: '16.8626',
      height: '33.726',
      fill: '#FA4EDF',
      transform: 'matrix(0 1 1 0 0 0)',
    },
    {
      opacity: 0.6,
      width: '34.241',
      height: '16.8626',
      fill: '#FA4EDF',
      transform: 'matrix(0 1 1 0 16.891 0)',
    },
    {
      opacity: 0.6,
      width: '16.8626',
      height: '68.482',
      fill: '#FA4EDF',
      transform: 'matrix(-1 0 0 1 33.739 16.888)',
    },
    {
      opacity: 0.6,
      width: '16.8626',
      height: '33.726',
      fill: '#FA4EDF',
      transform: 'matrix(0 1 1 0 0 33.776)',
    },
    {
      opacity: 1,
      width: '16.8626',
      height: '16.8626',
      fill: '#FA4EDF',
      transform: 'matrix(-1 0 0 1 33.739 34.272)',
    },
    {
      opacity: 0.6,
      width: '16.8626',
      height: '33.726',
      fill: '#FA4EDF',
      transform: 'matrix(0 1 1 0 0.012 68.510)',
    },
    {
      opacity: 0.6,
      width: '16.8626',
      height: '102.384',
      fill: '#2ABBF8',
      transform: 'matrix(-1 0 0 1 33.787 102.384)',
    },
    {
      opacity: 0.4,
      x: '17.131',
      y: '153.859',
      width: '34.241',
      height: '16.8626',
      fill: '#00F701',
      transform: 'rotate(-90 17.131 153.859)',
    },
    {
      opacity: 1,
      x: '17.131',
      y: '153.859',
      width: '16.8626',
      height: '16.8626',
      fill: '#00F701',
      transform: 'rotate(-90 17.131 153.859)',
    },
  ],
} as const satisfies Record<string, readonly BlockRect[]>

type Position = keyof typeof RECTS

function enterTime(pos: Position): number {
  return (RECTS[pos].length - 1) * ENTER_STAGGER + ENTER_DURATION
}

function exitTime(pos: Position): number {
  return (RECTS[pos].length - 1) * EXIT_STAGGER + EXIT_DURATION
}

interface BlockGroupProps {
  width: number
  height: number
  viewBox: string
  rects: readonly BlockRect[]
  animState: AnimState
  globalOpacity: number
}

const BlockGroup = memo(function BlockGroup({
  width,
  height,
  viewBox,
  rects,
  animState,
  globalOpacity,
}: BlockGroupProps) {
  const isVisible = animState === 'visible'
  const isExiting = animState === 'exiting'

  return (
    <svg
      width={width}
      height={height}
      viewBox={viewBox}
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className='h-auto w-full'
      style={{ opacity: globalOpacity }}
    >
      {rects.map((r, i) => (
        <rect
          key={i}
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          rx={RX}
          fill={r.fill}
          transform={r.transform}
          style={{
            opacity: isVisible ? r.opacity : 0,
            transition: `opacity ${isExiting ? EXIT_DURATION : ENTER_DURATION}s ease ${
              isVisible ? i * ENTER_STAGGER : isExiting ? i * EXIT_STAGGER : 0
            }s`,
          }}
        />
      ))}
    </svg>
  )
})

function useGroupState(): [AnimState, (s: AnimState) => void] {
  return useState<AnimState>('visible')
}

function useBlockCycle() {
  const [topRight, setTopRight] = useGroupState()
  const [left, setLeft] = useGroupState()
  const [right, setRight] = useGroupState()

  useEffect(() => {
    if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 1024px)').matches) return

    const cancelled = { current: false }
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

    async function exit(setter: (s: AnimState) => void, pos: Position, pauseAfter: number) {
      if (cancelled.current) return
      setter('exiting')
      await wait(exitTime(pos) * 1000)
      if (cancelled.current) return
      setter('hidden')
      await wait(pauseAfter)
    }

    async function enter(setter: (s: AnimState) => void, pos: Position, pauseAfter: number) {
      if (cancelled.current) return
      setter('visible')
      await wait(enterTime(pos) * 1000 + pauseAfter)
    }

    const run = async () => {
      await wait(INITIAL_HOLD)

      while (!cancelled.current) {
        await exit(setTopRight, 'topRight', TRANSITION_PAUSE)
        await exit(setLeft, 'left', HOLD_BETWEEN)
        await enter(setLeft, 'left', TRANSITION_PAUSE)
        await enter(setTopRight, 'topRight', TRANSITION_PAUSE)
        await exit(setRight, 'right', HOLD_BETWEEN)
        await enter(setRight, 'right', HOLD_BETWEEN)
      }
    }

    run()
    return () => {
      cancelled.current = true
    }
  }, [])

  return { topRight, left, right } as const
}

/**
 * Ambient animated block decorations for the docs layout.
 * Adapts the landing page's colorful block patterns with slightly reduced
 * opacity and the same staggered enter/exit animation cycle.
 */
export function AnimatedBlocks() {
  const states = useBlockCycle()

  return (
    <div
      className='pointer-events-none fixed inset-0 z-0 hidden overflow-hidden lg:block'
      aria-hidden='true'
    >
      <div className='absolute top-[93px] right-0 w-[calc(140px+10.76vw)] max-w-[295px]'>
        <BlockGroup
          width={295}
          height={34}
          viewBox='0 0 295 34'
          rects={RECTS.topRight}
          animState={states.topRight}
          globalOpacity={0.75}
        />
      </div>

      <div className='-translate-y-1/2 absolute top-[50%] left-0 w-[calc(16px+1.25vw)] max-w-[34px] scale-x-[-1]'>
        <BlockGroup
          width={34}
          height={226}
          viewBox='0 0 34 226.021'
          rects={RECTS.left}
          animState={states.left}
          globalOpacity={0.75}
        />
      </div>

      <div className='-translate-y-1/2 absolute top-[50%] right-0 w-[calc(16px+1.25vw)] max-w-[34px]'>
        <BlockGroup
          width={34}
          height={205}
          viewBox='0 0 34 204.769'
          rects={RECTS.right}
          animState={states.right}
          globalOpacity={0.75}
        />
      </div>
    </div>
  )
}
