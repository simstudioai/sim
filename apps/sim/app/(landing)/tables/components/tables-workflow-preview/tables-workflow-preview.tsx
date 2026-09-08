'use client'

import { Table as TableIcon } from '@sim/emcn/icons'
import { AgentIcon } from '@/components/icons'
import { StageBlockCard } from '@/app/(landing)/components/hero/components/hero-platform-loop/stage-block-card'
import {
  type BlockDef,
  horizontalHandleAnchors,
  smoothStep,
} from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'
import { EdgeFade } from '@/app/(landing)/components/shared/edge-fade'

const SCORE: BlockDef = {
  id: 'tables-score-lead',
  name: 'Score lead',
  type: 'agent',
  typeLabel: 'Agent',
  icon: AgentIcon,
  bgColor: 'var(--text-primary)',
  sentence: {
    segments: ['Prompt', { subBlockId: 'model', noun: 'a model' }],
    values: { model: 'GPT-6 Astra' },
  },
  rows: [],
  x: 24,
  y: 72,
}

const SAVE: BlockDef = {
  id: 'tables-save-lead',
  name: 'Save qualified lead',
  type: 'table_v2',
  typeLabel: 'Table',
  icon: TableIcon,
  bgColor: '#10B981',
  sentence: {
    segments: ['Insert a row into', { subBlockId: 'tableSelector', noun: 'a table' }],
    values: { tableSelector: 'Qualified leads' },
  },
  rows: [],
  x: 340,
  y: 180,
}

const SOURCE = horizontalHandleAnchors(SCORE)
const TARGET = horizontalHandleAnchors(SAVE)

/** Production Agent and Table cards, using the Table block's Insert Row sentence. */
export function TablesWorkflowPreview() {
  return (
    <div className='absolute inset-0 isolate overflow-hidden bg-[var(--bg)]'>
      <div className='-translate-x-1/2 max-sm:-translate-x-[70%] absolute top-8 left-1/2 h-[360px] w-[640px]'>
        <svg
          aria-hidden='true'
          className='absolute inset-0 size-full'
          viewBox='0 0 640 360'
          fill='none'
        >
          <path d={`M0 ${SOURCE.in.y} H${SOURCE.in.x}`} stroke='var(--border)' strokeWidth='1.5' />
          <path
            d={smoothStep(SOURCE.out.x, SOURCE.out.y, TARGET.in.x, TARGET.in.y)}
            stroke='var(--text-icon)'
            strokeWidth='1.5'
          />
          <path
            d={`M${TARGET.out.x} ${TARGET.out.y} H640`}
            stroke='var(--border)'
            strokeWidth='1.5'
          />
        </svg>
        <div className='absolute top-[72px] left-6'>
          <StageBlockCard block={SCORE} orientation='horizontal' decorative />
        </div>
        <div className='absolute top-[180px] left-[340px]'>
          <StageBlockCard block={SAVE} orientation='horizontal' selected decorative />
        </div>
      </div>
      <EdgeFade ground='canvas' edges={['left', 'right']} depth='preview' />
    </div>
  )
}
