'use client'

import { AgentIcon, DocumentIcon } from '@/components/icons'
import { StageBlockCard } from '@/app/(landing)/components/hero/components/hero-platform-loop/stage-block-card'
import {
  type BlockDef,
  horizontalHandleAnchors,
  smoothStep,
} from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'
import { EdgeFade } from '@/app/(landing)/components/shared/edge-fade'

const SUMMARIZE: BlockDef = {
  id: 'files-summarize',
  name: 'Summarize document',
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
  id: 'files-save-summary',
  name: 'Save summary',
  type: 'file_v5',
  typeLabel: 'File',
  icon: DocumentIcon,
  bgColor: '#40916C',
  sentence: {
    segments: ['Create', { subBlockId: 'fileName', noun: 'a file' }],
    values: { fileName: 'Summary.md' },
  },
  rows: [],
  x: 340,
  y: 180,
}

const SOURCE = horizontalHandleAnchors(SUMMARIZE)
const TARGET = horizontalHandleAnchors(SAVE)

/** Production Agent and File cards, using the File block's Write sentence. */
export function FilesWorkflowPreview() {
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
          <StageBlockCard block={SUMMARIZE} orientation='horizontal' decorative />
        </div>
        <div className='absolute top-[180px] left-[340px]'>
          <StageBlockCard block={SAVE} orientation='horizontal' selected decorative />
        </div>
      </div>
      <EdgeFade ground='canvas' edges={['left', 'right']} depth='preview' />
    </div>
  )
}
