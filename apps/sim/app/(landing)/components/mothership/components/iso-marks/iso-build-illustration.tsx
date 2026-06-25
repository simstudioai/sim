'use client'

import { useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/core/utils/cn'
import {
  createIsoLineProps,
  ISO_FILL_HIGH,
  ISO_FILL_LOW,
  ISO_FILL_MID,
  ISO_STROKE_FROM,
  ISO_STROKE_GRADIENT_PROPS,
  ISO_STROKE_TO,
} from '@/app/(landing)/components/mothership/components/iso-marks/iso-illustration-style'

export interface IsoBuildIllustrationProps {
  size?: number
  className?: string
}

const STROKE_PAINT = 'url(#iso-build-stroke-gradient)'

const LINE_PROPS = createIsoLineProps('iso-build-line', STROKE_PAINT)

const FLOOR_PANEL_PATH = 'M0.00 -146.87 L175.00 -45.83 L0.00 55.21 L-175.00 -45.83 Z'

const TILE_WIDTH = 43.75
const TILE_HEIGHT = 25.26
const GRID_SLOPE = TILE_HEIGHT / TILE_WIDTH
const GRID_LINE_X = 260
const GRID_LINE_SPACING = TILE_HEIGHT * 2
const GRID_ORIGIN_INTERCEPT = -45.83
const GRID_LINE_OFFSETS = [-1, 0, 1] as const
const MAX_WAVE_HEIGHT = 54
const WAVE_CELL_OFFSETS = [-1.5, -0.5, 0.5, 1.5] as const

const svgNumber = (value: number) => value.toFixed(2)

const GRID_LINE_PATHS = GRID_LINE_OFFSETS.flatMap((offset) => {
  const intercept = GRID_ORIGIN_INTERCEPT + GRID_LINE_SPACING * offset
  const leftX = -GRID_LINE_X
  const rightX = GRID_LINE_X

  return [
    `M${svgNumber(leftX)} ${svgNumber(GRID_SLOPE * leftX + intercept)} L${svgNumber(rightX)} ${svgNumber(GRID_SLOPE * rightX + intercept)}`,
    `M${svgNumber(leftX)} ${svgNumber(-GRID_SLOPE * leftX + intercept)} L${svgNumber(rightX)} ${svgNumber(-GRID_SLOPE * rightX + intercept)}`,
  ]
})

const WAVE_BLOCKS = WAVE_CELL_OFFSETS.flatMap((p) =>
  WAVE_CELL_OFFSETS.map((q, qIndex) => ({
    amplitude: 0.72 + ((qIndex + WAVE_CELL_OFFSETS.indexOf(p) * 3) % 5) / 12,
    phase: ((qIndex * 5 + WAVE_CELL_OFFSETS.indexOf(p) * 3) % 16) * 0.73,
    id: `${p}:${q}`,
    cx: (q - p) * TILE_WIDTH,
    cy: (p + q) * TILE_HEIGHT + GRID_ORIGIN_INTERCEPT,
  }))
).sort((a, b) => a.cy - b.cy)

const getWaveBlockPaths = (cx: number, cy: number, height: number) => {
  const topY = cy - height
  const top = `M${svgNumber(cx)} ${svgNumber(topY - TILE_HEIGHT)} L${svgNumber(cx + TILE_WIDTH)} ${svgNumber(topY)} L${svgNumber(cx)} ${svgNumber(topY + TILE_HEIGHT)} L${svgNumber(cx - TILE_WIDTH)} ${svgNumber(topY)} Z`
  const left = `M${svgNumber(cx - TILE_WIDTH)} ${svgNumber(topY)} L${svgNumber(cx)} ${svgNumber(topY + TILE_HEIGHT)} L${svgNumber(cx)} ${svgNumber(cy + TILE_HEIGHT)} L${svgNumber(cx - TILE_WIDTH)} ${svgNumber(cy)} Z`
  const right = `M${svgNumber(cx + TILE_WIDTH)} ${svgNumber(topY)} L${svgNumber(cx)} ${svgNumber(topY + TILE_HEIGHT)} L${svgNumber(cx)} ${svgNumber(cy + TILE_HEIGHT)} L${svgNumber(cx + TILE_WIDTH)} ${svgNumber(cy)} Z`

  return { top, left, right }
}

const getWaveBlockFrontPath = (cx: number, cy: number) =>
  `M${svgNumber(cx - TILE_WIDTH)} ${svgNumber(cy)} L${svgNumber(cx)} ${svgNumber(cy + TILE_HEIGHT)} L${svgNumber(cx + TILE_WIDTH)} ${svgNumber(cy)}`

const WAVE_BLOCK_BY_ID = new Map(WAVE_BLOCKS.map((block) => [block.id, block]))

const getAutoWaveHeight = (block: (typeof WAVE_BLOCKS)[number], time: number) => {
  const primaryPulse = Math.max(0, Math.sin(time * 1.18 + block.phase))
  const secondaryPulse = Math.max(0, Math.sin(time * 0.74 + block.phase * 1.7 + 1.2))
  const pulse = primaryPulse * 0.76 + secondaryPulse * 0.24

  return MAX_WAVE_HEIGHT * block.amplitude * pulse * pulse
}

/**
 * Inline supplied illustration for the Build area.
 */
export function IsoBuildIllustration({ size = 156, className }: IsoBuildIllustrationProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const animationFrameRef = useRef<number | null>(null)
  const currentHeightsRef = useRef<Record<string, number>>({})

  const updateWaveBlock = useCallback((group: SVGGElement, height: number) => {
    const cx = Number(group.dataset.cx ?? 0)
    const cy = Number(group.dataset.cy ?? 0)
    const paths = getWaveBlockPaths(cx, cy, height)
    const top = group.querySelector<SVGPathElement>('[data-wave-face="top"]')
    const left = group.querySelector<SVGPathElement>('[data-wave-face="left"]')
    const right = group.querySelector<SVGPathElement>('[data-wave-face="right"]')

    top?.setAttribute('d', paths.top)
    left?.setAttribute('d', paths.left)
    right?.setAttribute('d', paths.right)
    group.style.visibility = height > 1 ? 'visible' : 'hidden'
  }, [])

  const runWaveAnimation = useCallback(
    (timestamp: number) => {
      const svg = svgRef.current
      if (!svg) {
        animationFrameRef.current = null
        return
      }

      const time = timestamp / 1000
      const blocks = svg.querySelectorAll<SVGGElement>('[data-wave-block]')

      blocks.forEach((blockElement) => {
        const id = blockElement.dataset.blockId
        const block = id ? WAVE_BLOCK_BY_ID.get(id) : undefined
        if (!id || !block) return

        const target = getAutoWaveHeight(block, time)
        const current = currentHeightsRef.current[id] ?? 0
        const next = current + (target - current) * 0.09
        currentHeightsRef.current[id] = Math.abs(next) < 0.15 ? 0 : next
        updateWaveBlock(blockElement, currentHeightsRef.current[id])
      })

      animationFrameRef.current = requestAnimationFrame(runWaveAnimation)
    },
    [updateWaveBlock]
  )

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (prefersReducedMotion) return undefined

    animationFrameRef.current = requestAnimationFrame(runWaveAnimation)

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [runWaveAnimation])

  return (
    <svg
      ref={svgRef}
      viewBox='-180 -155 360 390'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      width={size}
      height={size}
      aria-hidden={true}
      focusable='false'
      className={cn('iso-build-illustration block max-w-none shrink-0', className)}
    >
      <style>
        {`
          .iso-build-line {
            stroke-dasharray: 1;
            stroke-dashoffset: 0;
          }

          .iso-build-wave-block {
            visibility: hidden;
          }

          .iso-build-illustration:hover .iso-build-line {
            animation: iso-build-line-draw 900ms cubic-bezier(0.23, 1, 0.32, 1) both;
          }

          .iso-build-illustration:hover [data-build-layer='grid'] .iso-build-line {
            animation-delay: 0ms;
          }

          .iso-build-illustration:hover [data-build-layer='wave'] .iso-build-line {
            animation-delay: 105ms;
          }

          @keyframes iso-build-line-draw {
            from {
              stroke-dashoffset: 1;
            }

            to {
              stroke-dashoffset: 0;
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .iso-build-wave-block,
            .iso-build-illustration:hover .iso-build-line {
              animation: none;
              transition: none;
            }
          }
        `}
      </style>
      <defs>
        <linearGradient id='iso-build-stroke-gradient' {...ISO_STROKE_GRADIENT_PROPS}>
          <stop stopColor={ISO_STROKE_FROM} />
          <stop offset='1' stopColor={ISO_STROKE_TO} />
        </linearGradient>
        <clipPath id='iso-build-floor-clip'>
          <path d={FLOOR_PANEL_PATH} />
        </clipPath>
      </defs>
      <g transform='translate(0 78)'>
        <g data-build-layer='grid' pointerEvents='none'>
          <path d={FLOOR_PANEL_PATH} fill={ISO_FILL_HIGH} stroke='none' pointerEvents='none' />
          <g clipPath='url(#iso-build-floor-clip)'>
            {GRID_LINE_PATHS.map((path) => (
              <path key={path} d={path} {...LINE_PROPS} strokeLinecap='butt' />
            ))}
          </g>
          <path d={FLOOR_PANEL_PATH} {...LINE_PROPS} strokeLinejoin='miter' />
        </g>
        <g data-build-layer='wave' pointerEvents='none'>
          {WAVE_BLOCKS.map((block) => {
            const paths = getWaveBlockPaths(block.cx, block.cy, 0)

            return (
              <g
                key={block.id}
                className='iso-build-wave-block'
                data-wave-block={true}
                data-block-id={block.id}
                data-cx={block.cx}
                data-cy={block.cy}
                pointerEvents='none'
              >
                <path data-wave-face='left' d={paths.left} {...LINE_PROPS} fill={ISO_FILL_MID} />
                <path data-wave-face='right' d={paths.right} {...LINE_PROPS} fill={ISO_FILL_LOW} />
                <path data-wave-face='top' d={paths.top} {...LINE_PROPS} fill={ISO_FILL_HIGH} />
                <path d={getWaveBlockFrontPath(block.cx, block.cy)} {...LINE_PROPS} />
              </g>
            )
          })}
        </g>
      </g>
    </svg>
  )
}
