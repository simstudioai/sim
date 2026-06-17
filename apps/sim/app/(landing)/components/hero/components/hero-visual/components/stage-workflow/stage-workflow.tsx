import type { CSSProperties } from 'react'
import { cn } from '@/lib/core/utils/cn'
import { WorkflowBlock } from '@/app/(landing)/components/hero/components/hero-visual/components/stage-workflow/components/workflow-block'
import styles from '@/app/(landing)/components/hero/components/hero-visual/hero-visual.module.css'
import {
  BLOCK_WIDTH,
  BLOCKS,
  CANVAS,
  EDGES,
} from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

/** Display scale of the design-space canvas within the hero panel. */
const SCALE = 0.68

/**
 * The workflow stage of the hero visual — a design-space canvas holding the SVG
 * edge overlay behind the absolutely-positioned block cards. Purely decorative:
 * the parent marks the region `aria-hidden`, and the SVG reasserts it locally.
 * All geometry comes from {@link CANVAS}, {@link BLOCKS}, and {@link EDGES} so
 * the overlay and the cards share one coordinate space.
 *
 * The canvas is scaled from its top-left, wrapped in an outer box sized to the
 * SCALED footprint — so its layout size matches what's painted and the flex
 * parent centers it exactly (a raw `scale()` keeps the full design-size layout
 * box, which overflows the panel and breaks centering).
 */
export function StageWorkflow() {
  return (
    <div className='flex h-full w-full items-center justify-center'>
      <div style={{ width: CANVAS.width * SCALE, height: CANVAS.height * SCALE }}>
        <div
          className='relative'
          style={
            {
              width: CANVAS.width,
              height: CANVAS.height,
              transform: `scale(${SCALE})`,
              transformOrigin: 'top left',
            } as CSSProperties
          }
        >
          <svg
            className='absolute inset-0'
            width={CANVAS.width}
            height={CANVAS.height}
            viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`}
            fill='none'
            aria-hidden='true'
          >
            {EDGES.map((edge, i) => (
              <path
                key={edge.id}
                d={edge.d}
                pathLength={1}
                className={styles.edgePath}
                stroke='var(--workflow-edge)'
                strokeWidth={2}
                strokeLinecap='round'
                style={{ '--draw-delay': `${400 + i * 300}ms` } as CSSProperties}
              />
            ))}
          </svg>
          {BLOCKS.map((block, i) => (
            <div
              key={block.id}
              className={cn(styles.block, 'absolute')}
              style={
                {
                  left: block.x,
                  top: block.y,
                  width: BLOCK_WIDTH,
                  '--rise-delay': `${i * 140}ms`,
                } as CSSProperties
              }
            >
              <WorkflowBlock block={block} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
