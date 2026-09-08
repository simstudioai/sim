'use client'

import { cn } from '@sim/emcn'
import { TerminalWindow } from '@sim/emcn/icons'
import { ThinkingLoader } from '@/components/ui/thinking-loader'
import { StageBlockCard } from '@/app/(landing)/components/hero/components/hero-platform-loop/stage-block-card'
import { STAGE_BLOCKS } from '@/app/(landing)/components/hero/components/hero-platform-loop/stage-data'
import {
  horizontalHandleAnchors,
  smoothStep,
} from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'
import styles from '@/app/(landing)/components/shared/cli-graphic/cli-graphic.module.css'
import { EdgeFade } from '@/app/(landing)/components/shared/edge-fade'
import { FeatureGraphicShell } from '@/app/(landing)/enterprise/components/feature-graphics/feature-graphic-shell'

const WORKFLOW_BLOCKS = [
  {
    ...STAGE_BLOCKS[0],
    id: 'cli-start',
    name: 'Start',
    x: 30,
    y: 145,
    position: 'left-[30px] top-[145px]',
  },
  {
    ...STAGE_BLOCKS[1],
    id: 'cli-agent',
    name: 'Support agent',
    x: 325,
    y: 65,
    position: 'left-[325px] top-[65px]',
    sentence: {
      segments: ['Prompt', { subBlockId: 'model', noun: 'model' }],
      values: { model: 'Claude Sonnet' },
    },
  },
  {
    ...STAGE_BLOCKS[2],
    id: 'cli-output',
    name: 'Format reply',
    x: 620,
    y: 135,
    position: 'left-[620px] top-[135px]',
  },
]

/** A CLI run streams a sample reply while its support-agent node is thinking. */
export function CliGraphic() {
  return (
    <FeatureGraphicShell variant='portrait'>
      <div aria-hidden='true' className={styles.scene}>
        <div className={styles.canvas}>
          <div className={styles.graph}>
            <svg
              className='absolute inset-0 size-full overflow-visible'
              viewBox='0 0 900 280'
              fill='none'
            >
              {WORKFLOW_BLOCKS.slice(1).map((block, index) => {
                const source = horizontalHandleAnchors(WORKFLOW_BLOCKS[index]).out
                const target = horizontalHandleAnchors(block).in
                return (
                  <path
                    key={block.id}
                    d={smoothStep(source.x, source.y, target.x, target.y)}
                    stroke='var(--text-secondary)'
                    strokeWidth={1.5}
                  />
                )
              })}
            </svg>
            {WORKFLOW_BLOCKS.map((block, index) => (
              <div key={block.id} className={cn('absolute', block.position)}>
                <StageBlockCard
                  block={block}
                  orientation='horizontal'
                  selected={index === 1}
                  decorative
                  decorativeRunIcon={
                    index === 1 ? (
                      <span className={styles.runIcon}>
                        <ThinkingLoader variant='thinking' size={22} tone='inherit' />
                      </span>
                    ) : undefined
                  }
                />
              </div>
            ))}
          </div>
          <EdgeFade ground='surface' edges={['top', 'left', 'right', 'bottom']} depth='preview' />
        </div>

        <div className={styles.terminal}>
          <div className={styles.titlebar}>
            <span className={styles.windowDots}>
              <i />
              <i />
              <i />
            </span>
            <span className='flex items-center gap-2 text-[var(--text-secondary)] text-caption'>
              <TerminalWindow className='size-[14px]' />
              Terminal
            </span>
            <span aria-hidden='true' />
          </div>
          <div className={styles.transcript}>
            <div className='mb-3 flex gap-2 text-[var(--text-primary)]'>
              <span className='text-[var(--text-muted)]'>❯</span>
              <span>Draft a reply to this ticket.</span>
            </div>
            <div className='flex gap-2 text-[var(--text-primary)]'>
              <span className='text-[var(--text-muted)]'>$</span>
              <code className={styles.command}>sim workflows run \</code>
            </div>
            <div className='pl-4 text-[var(--text-secondary)]'>
              <code className={styles.arguments}>&quot;$WORKFLOW_ID&quot; --follow \</code>
            </div>
            <div className={styles.inputFlag}>
              <code>--input @ticket.json</code>
            </div>
            <div className={styles.response}>
              <span className={styles.started}>Hi Alex, happy to help.</span>
              <span className={styles.running}>Open Settings → Security,</span>
              <span className={styles.completed}>then select Reset password.</span>
            </div>
          </div>
        </div>
      </div>
    </FeatureGraphicShell>
  )
}
