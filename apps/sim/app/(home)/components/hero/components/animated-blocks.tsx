'use client'

import { useEffect, useState } from 'react'
import { motion, type Variants } from 'framer-motion'

/** Stagger between each block appearing (seconds). */
const ENTER_STAGGER = 0.06

/** Duration of each block's fade-in (seconds). */
const ENTER_DURATION = 0.3

/** Stagger between each block disappearing (seconds). */
const EXIT_STAGGER = 0.12

/** Duration of each block's fade-out (seconds). */
const EXIT_DURATION = 0.5

/** Shared corner radius for all decorative rects. */
const RX = '2.59574'

/** Hold time after the initial enter animation before cycling starts (ms). */
const INITIAL_HOLD_MS = 2500

/** Pause between an exit completing and the next enter starting (ms). */
const TRANSITION_PAUSE_MS = 400

/** Hold time between successive transitions (ms). */
const HOLD_BETWEEN_MS = 2500

/** Animation state for a block group. */
export type BlockAnimState = 'entering' | 'visible' | 'exiting' | 'hidden'

/** Positions around the hero where block groups can appear. */
export type BlockPosition = 'topRight' | 'left' | 'rightEdge' | 'rightSide' | 'topLeft'

/** Attributes for a single animated SVG rect. */
interface BlockRect {
  opacity: number
  width: string
  height: string
  fill: string
  x?: string
  y?: string
  transform?: string
}

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: ENTER_STAGGER } },
  exit: { transition: { staggerChildren: EXIT_STAGGER } },
}

const blockVariants: Variants = {
  hidden: { opacity: 0, transition: { duration: 0 } },
  visible: (targetOpacity: number) => ({
    opacity: targetOpacity,
    transition: { duration: ENTER_DURATION },
  }),
  exit: {
    opacity: 0,
    transition: { duration: EXIT_DURATION },
  },
}

/** Maps a BlockAnimState to the framer-motion animate value. */
function toAnimateValue(state: BlockAnimState): string {
  if (state === 'entering' || state === 'visible') return 'visible'
  if (state === 'exiting') return 'exit'
  return 'hidden'
}

/** Shared SVG wrapper that staggers child rects in and out. */
function AnimatedBlocksSvg({
  width,
  height,
  viewBox,
  rects,
  animState = 'entering',
}: {
  width: number
  height: number
  viewBox: string
  rects: readonly BlockRect[]
  animState?: BlockAnimState
}) {
  return (
    <motion.svg
      width={width}
      height={height}
      viewBox={viewBox}
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className='h-auto w-full'
      initial='hidden'
      animate={toAnimateValue(animState)}
      variants={containerVariants}
    >
      {rects.map((r, i) => (
        <motion.rect
          key={i}
          variants={blockVariants}
          custom={r.opacity}
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          rx={RX}
          fill={r.fill}
          transform={r.transform}
        />
      ))}
    </motion.svg>
  )
}

/**
 * Rect data for the top-right position.
 * Two-row horizontal strip, ordered left-to-right.
 */
const TOP_RIGHT_RECTS: readonly BlockRect[] = [
  { opacity: 1, x: '0', y: '0', width: '16.8626', height: '33.7252', fill: '#2ABBF8' },
  { opacity: 0.6, x: '0', y: '0', width: '85.3433', height: '16.8626', fill: '#2ABBF8' },
  { opacity: 1, x: '0', y: '0', width: '16.8626', height: '16.8626', fill: '#2ABBF8' },
  { opacity: 0.6, x: '34.2403', y: '0', width: '34.2403', height: '33.7252', fill: '#2ABBF8' },
  { opacity: 1, x: '34.2403', y: '0', width: '16.8626', height: '16.8626', fill: '#2ABBF8' },
  { opacity: 1, x: '51.6188', y: '16.8626', width: '16.8626', height: '16.8626', fill: '#2ABBF8' },
  { opacity: 1, x: '68.4812', y: '0', width: '54.6502', height: '16.8626', fill: '#00F701' },
  { opacity: 0.6, x: '106.268', y: '0', width: '34.2403', height: '33.7252', fill: '#00F701' },
  { opacity: 0.6, x: '106.268', y: '0', width: '51.103', height: '16.8626', fill: '#00F701' },
  { opacity: 1, x: '123.6484', y: '16.8626', width: '16.8626', height: '16.8626', fill: '#00F701' },
  { opacity: 0.6, x: '157.371', y: '0', width: '34.2403', height: '16.8626', fill: '#FFCC02' },
  { opacity: 1, x: '157.371', y: '0', width: '16.8626', height: '16.8626', fill: '#FFCC02' },
  { opacity: 0.6, x: '208.993', y: '0', width: '68.4805', height: '16.8626', fill: '#FA4EDF' },
  { opacity: 0.6, x: '209.137', y: '0', width: '16.8626', height: '33.7252', fill: '#FA4EDF' },
  { opacity: 0.6, x: '243.233', y: '0', width: '34.2403', height: '33.7252', fill: '#FA4EDF' },
  { opacity: 1, x: '243.233', y: '0', width: '16.8626', height: '16.8626', fill: '#FA4EDF' },
  { opacity: 0.6, x: '260.096', y: '0', width: '34.04', height: '16.8626', fill: '#FA4EDF' },
  { opacity: 1, x: '260.611', y: '16.8626', width: '16.8626', height: '16.8626', fill: '#FA4EDF' },
]

/**
 * Rect data for the top-left position.
 * Same two-row structure as top-right with rotated colour palette:
 * blue→green, green→yellow, yellow→pink, pink→blue.
 */
const TOP_LEFT_RECTS: readonly BlockRect[] = [
  { opacity: 1, x: '0', y: '0', width: '16.8626', height: '33.7252', fill: '#00F701' },
  { opacity: 0.6, x: '0', y: '0', width: '85.3433', height: '16.8626', fill: '#00F701' },
  { opacity: 1, x: '0', y: '0', width: '16.8626', height: '16.8626', fill: '#00F701' },
  { opacity: 0.6, x: '34.2403', y: '0', width: '34.2403', height: '33.7252', fill: '#00F701' },
  { opacity: 1, x: '34.2403', y: '0', width: '16.8626', height: '16.8626', fill: '#00F701' },
  { opacity: 1, x: '51.6188', y: '16.8626', width: '16.8626', height: '16.8626', fill: '#00F701' },
  { opacity: 1, x: '68.4812', y: '0', width: '54.6502', height: '16.8626', fill: '#FFCC02' },
  { opacity: 0.6, x: '106.268', y: '0', width: '34.2403', height: '33.7252', fill: '#FFCC02' },
  { opacity: 0.6, x: '106.268', y: '0', width: '51.103', height: '16.8626', fill: '#FFCC02' },
  { opacity: 1, x: '123.6484', y: '16.8626', width: '16.8626', height: '16.8626', fill: '#FFCC02' },
  { opacity: 0.6, x: '157.371', y: '0', width: '34.2403', height: '16.8626', fill: '#FA4EDF' },
  { opacity: 1, x: '157.371', y: '0', width: '16.8626', height: '16.8626', fill: '#FA4EDF' },
  { opacity: 0.6, x: '208.993', y: '0', width: '68.4805', height: '16.8626', fill: '#2ABBF8' },
  { opacity: 0.6, x: '209.137', y: '0', width: '16.8626', height: '33.7252', fill: '#2ABBF8' },
  { opacity: 0.6, x: '243.233', y: '0', width: '34.2403', height: '33.7252', fill: '#2ABBF8' },
  { opacity: 1, x: '243.233', y: '0', width: '16.8626', height: '16.8626', fill: '#2ABBF8' },
  { opacity: 0.6, x: '260.096', y: '0', width: '34.04', height: '16.8626', fill: '#2ABBF8' },
  { opacity: 1, x: '260.611', y: '16.8626', width: '16.8626', height: '16.8626', fill: '#2ABBF8' },
]

/**
 * Rect data for the left position.
 * Two-column vertical strip, ordered top-to-bottom.
 */
const LEFT_RECTS: readonly BlockRect[] = [
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
]

/**
 * Rect data for the right-side position (right edge of screenshot).
 * Same two-column structure as left with rotated colours:
 * pink→blue, green→pink, yellow→green.
 */
const RIGHT_SIDE_RECTS: readonly BlockRect[] = [
  {
    opacity: 0.6,
    width: '34.240',
    height: '33.725',
    fill: '#2ABBF8',
    transform: 'matrix(0 1 1 0 0 0)',
  },
  {
    opacity: 0.6,
    width: '16.8626',
    height: '68.480',
    fill: '#2ABBF8',
    transform: 'matrix(-1 0 0 1 33.727 0)',
  },
  {
    opacity: 1,
    width: '16.8626',
    height: '16.8626',
    fill: '#2ABBF8',
    transform: 'matrix(-1 0 0 1 33.727 17.378)',
  },
  {
    opacity: 0.6,
    width: '16.8626',
    height: '33.986',
    fill: '#2ABBF8',
    transform: 'matrix(0 1 1 0 0 51.616)',
  },
  {
    opacity: 0.6,
    width: '16.8626',
    height: '140.507',
    fill: '#FA4EDF',
    transform: 'matrix(-1 0 0 1 33.986 85.335)',
  },
  {
    opacity: 0.4,
    x: '17.119',
    y: '136.962',
    width: '34.240',
    height: '16.8626',
    fill: '#00F701',
    transform: 'rotate(-90 17.119 136.962)',
  },
  {
    opacity: 1,
    x: '17.119',
    y: '136.962',
    width: '16.8626',
    height: '16.8626',
    fill: '#00F701',
    transform: 'rotate(-90 17.119 136.962)',
  },
  {
    opacity: 0.5,
    width: '34.240',
    height: '33.725',
    fill: '#FA4EDF',
    transform: 'matrix(0 1 1 0 0.257 153.825)',
  },
  {
    opacity: 1,
    width: '16.8626',
    height: '16.8626',
    fill: '#FA4EDF',
    transform: 'matrix(0 1 1 0 0.257 153.825)',
  },
]

/**
 * Rect data for the right-edge position (far right of screen).
 * Two-column vertical strip, ordered top-to-bottom.
 */
const RIGHT_RECTS: readonly BlockRect[] = [
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
]

/** Number of rects per position, used to compute animation durations. */
const RECT_COUNTS: Record<BlockPosition, number> = {
  topRight: TOP_RIGHT_RECTS.length,
  topLeft: TOP_LEFT_RECTS.length,
  left: LEFT_RECTS.length,
  rightSide: RIGHT_SIDE_RECTS.length,
  rightEdge: RIGHT_RECTS.length,
}

/** Total enter animation time for a position (seconds). */
function enterTime(pos: BlockPosition): number {
  return (RECT_COUNTS[pos] - 1) * ENTER_STAGGER + ENTER_DURATION
}

/** Total exit animation time for a position (seconds). */
function exitTime(pos: BlockPosition): number {
  return (RECT_COUNTS[pos] - 1) * EXIT_STAGGER + EXIT_DURATION
}

/** A single step in the repeating animation cycle. */
type CycleStep =
  | { action: 'exit'; position: BlockPosition }
  | { action: 'enter'; position: BlockPosition }
  | { action: 'hold'; ms: number }

/**
 * The repeating cycle sequence. After all steps, the layout returns to its
 * initial state (topRight + left + rightEdge) so the loop is seamless.
 *
 * Order: exit top → exit right-edge → enter right-side-of-preview →
 * exit left → enter top-left → exit right-side → enter left →
 * exit top-left → enter top-right → enter right-edge → back to initial.
 */
const CYCLE_STEPS: readonly CycleStep[] = [
  { action: 'exit', position: 'topRight' },
  { action: 'exit', position: 'rightEdge' },
  { action: 'enter', position: 'rightSide' },
  { action: 'hold', ms: HOLD_BETWEEN_MS },
  { action: 'exit', position: 'left' },
  { action: 'enter', position: 'topLeft' },
  { action: 'hold', ms: HOLD_BETWEEN_MS },
  { action: 'exit', position: 'rightSide' },
  { action: 'enter', position: 'left' },
  { action: 'hold', ms: HOLD_BETWEEN_MS },
  { action: 'exit', position: 'topLeft' },
  { action: 'enter', position: 'topRight' },
  { action: 'hold', ms: HOLD_BETWEEN_MS },
  { action: 'enter', position: 'rightEdge' },
  { action: 'hold', ms: HOLD_BETWEEN_MS },
]

/**
 * Drives the block-cycling animation loop. Returns the current animation
 * state for every position so each component can be driven declaratively.
 *
 * Lifecycle:
 * 1. All three initial groups (topRight, left, rightEdge) enter together.
 * 2. After a hold period the cycle begins, processing each step in order.
 * 3. Repeats indefinitely, returning to the initial layout every cycle.
 */
export function useBlockCycle(): Record<BlockPosition, BlockAnimState> {
  const [states, setStates] = useState<Record<BlockPosition, BlockAnimState>>({
    topRight: 'entering',
    left: 'entering',
    rightEdge: 'entering',
    rightSide: 'hidden',
    topLeft: 'hidden',
  })

  useEffect(() => {
    const cancelled = { current: false }
    const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

    const run = async () => {
      const longestEnter = Math.max(
        enterTime('topRight'),
        enterTime('left'),
        enterTime('rightEdge')
      )
      await delay(longestEnter * 1000)
      if (cancelled.current) return

      setStates({
        topRight: 'visible',
        left: 'visible',
        rightEdge: 'visible',
        rightSide: 'hidden',
        topLeft: 'hidden',
      })

      await delay(INITIAL_HOLD_MS)
      if (cancelled.current) return

      while (!cancelled.current) {
        for (const step of CYCLE_STEPS) {
          if (cancelled.current) return

          if (step.action === 'exit') {
            setStates((prev) => ({ ...prev, [step.position]: 'exiting' }))
            await delay(exitTime(step.position) * 1000)
            if (cancelled.current) return
            setStates((prev) => ({ ...prev, [step.position]: 'hidden' }))
            await delay(TRANSITION_PAUSE_MS)
          } else if (step.action === 'enter') {
            setStates((prev) => ({ ...prev, [step.position]: 'entering' }))
            await delay(enterTime(step.position) * 1000)
            if (cancelled.current) return
            setStates((prev) => ({ ...prev, [step.position]: 'visible' }))
            await delay(TRANSITION_PAUSE_MS)
          } else {
            await delay(step.ms)
          }

          if (cancelled.current) return
        }
      }
    }

    run()
    return () => {
      cancelled.current = true
    }
  }, [])

  return states
}

interface AnimatedBlockProps {
  animState?: BlockAnimState
}

/** Two-row horizontal strip at the top-right of the hero. */
export function BlocksTopRightAnimated({ animState = 'entering' }: AnimatedBlockProps) {
  return (
    <AnimatedBlocksSvg
      width={295}
      height={34}
      viewBox='0 0 295 34'
      rects={TOP_RIGHT_RECTS}
      animState={animState}
    />
  )
}

/** Two-row horizontal strip at the top-left of the hero. */
export function BlocksTopLeftAnimated({ animState = 'entering' }: AnimatedBlockProps) {
  return (
    <AnimatedBlocksSvg
      width={295}
      height={34}
      viewBox='0 0 295 34'
      rects={TOP_LEFT_RECTS}
      animState={animState}
    />
  )
}

/** Two-column vertical strip on the left edge of the screenshot. */
export function BlocksLeftAnimated({ animState = 'entering' }: AnimatedBlockProps) {
  return (
    <AnimatedBlocksSvg
      width={34}
      height={226}
      viewBox='0 0 34 226.021'
      rects={LEFT_RECTS}
      animState={animState}
    />
  )
}

/** Two-column vertical strip on the right edge of the screenshot. */
export function BlocksRightSideAnimated({ animState = 'entering' }: AnimatedBlockProps) {
  return (
    <AnimatedBlocksSvg
      width={34}
      height={226}
      viewBox='0 0 34 226.021'
      rects={RIGHT_SIDE_RECTS}
      animState={animState}
    />
  )
}

/** Two-column vertical strip at the far-right edge of the screen. */
export function BlocksRightAnimated({ animState = 'entering' }: AnimatedBlockProps) {
  return (
    <AnimatedBlocksSvg
      width={34}
      height={205}
      viewBox='0 0 34 204.769'
      rects={RIGHT_RECTS}
      animState={animState}
    />
  )
}
