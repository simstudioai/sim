'use client'

import { AgentIcon, DocumentIcon } from '@/components/icons'
import type { BlockDef } from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'
import { TwoBlockWorkflowPreview } from '@/app/(landing)/components/shared/two-block-workflow-preview/two-block-workflow-preview'

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

/** Production Agent and File cards, using the File block's Write sentence. */
export function FilesWorkflowPreview() {
  return <TwoBlockWorkflowPreview source={SUMMARIZE} target={SAVE} />
}
