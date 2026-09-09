'use client'

import { useState } from 'react'
import { cn } from '@sim/emcn'
import { motion, useReducedMotion } from 'framer-motion'
import { ResponsiveDesignStage } from '@/app/(landing)/components/shared/responsive-design-stage'
import styles from '@/app/(landing)/files/components/feature-graphics/file-library-graphic.module.css'

/**
 * Adapted from Rare UI's Folder component by Swami Malode.
 * https://github.com/swamimalode07/rare-ui/blob/main/components/ui/folder-component.tsx
 *
 * MIT License — Copyright (c) 2026 Swami Malode
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const FLAP_PATH =
  'M0 25C0 11.1929 11.1929 0 25 0H136.084C143.044 0 149.689 2.90139 154.42 8.00608L178.08 33.5343C182.811 38.639 189.456 41.5404 196.416 41.5404H296C309.807 41.5404 321 52.7333 321 66.5404V216C321 229.807 309.807 241 296 241H25C11.1929 241 0 229.807 0 216V25Z'
const CARDS = [
  {
    x: 40,
    openX: 65,
    y: -10,
    hoverY: -30,
    openY: -130,
    rotate: 10,
    hoverRotate: 14,
    openRotate: 18,
  },
  { x: 3, openX: 0, y: -20, hoverY: -35, openY: -150, rotate: 2, hoverRotate: -1, openRotate: -3 },
  {
    x: -40,
    openX: -60,
    y: -22,
    hoverY: -44,
    openY: -140,
    rotate: -5,
    hoverRotate: -9,
    openRotate: -14,
  },
] as const

interface InteractiveLibraryFolderProps {
  name: string
  count: string
  className?: string
}

export function InteractiveLibraryFolder({
  name,
  count,
  className,
}: InteractiveLibraryFolderProps) {
  const reducedMotion = useReducedMotion()
  const [hovered, setHovered] = useState(false)
  const [open, setOpen] = useState(false)
  const transition = reducedMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 120, damping: 14 }

  return (
    <div className={cn('relative min-h-0 min-w-0', className)}>
      <ResponsiveDesignStage
        width={350}
        height={340}
        maxScale={Number.POSITIVE_INFINITY}
        className='-translate-y-3 absolute inset-0 items-end overflow-visible [contain:none]'
        contentClassName='origin-bottom'
      >
        <button
          type='button'
          className={styles.folderButton}
          aria-label={`${name}, ${count}`}
          aria-pressed={open}
          onPointerEnter={(event) => {
            if (event.pointerType !== 'touch') setHovered(true)
          }}
          onPointerLeave={() => setHovered(false)}
          onFocus={() => setHovered(true)}
          onBlur={() => setHovered(false)}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false)
          }}
        >
          <span aria-hidden='true' className={styles.folderScene}>
            <span className={styles.folderBack} />
            {CARDS.map((card, index) => (
              <motion.span
                key={card.x}
                className={styles.folderPaper}
                animate={{
                  x: open ? card.openX : card.x,
                  y: open ? card.openY : hovered ? card.hoverY : card.y,
                  rotate: open ? card.openRotate : hovered ? card.hoverRotate : card.rotate,
                }}
                transition={{ ...transition, delay: reducedMotion ? 0 : (2 - index) * 0.05 }}
              >
                <span className={styles.paperTitle} />
                <span className={styles.paperLines} />
              </motion.span>
            ))}
            <motion.span
              className={styles.folderFlap}
              animate={{ rotateX: open ? -55 : hovered ? -45 : -15 }}
              transition={transition}
            >
              <svg className='absolute inset-0 size-full' viewBox='0 0 321 241' fill='none'>
                <path
                  d={FLAP_PATH}
                  fill='var(--surface-3)'
                  stroke='var(--border)'
                  strokeWidth='2'
                />
              </svg>
              <span className={styles.folderLabel}>
                <span>{name}</span>
                <span>{count}</span>
              </span>
            </motion.span>
          </span>
        </button>
      </ResponsiveDesignStage>
    </div>
  )
}
