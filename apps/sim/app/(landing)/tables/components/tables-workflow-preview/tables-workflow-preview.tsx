'use client'

import { Table as TableIcon } from '@sim/emcn/icons'
import { AgentIcon } from '@/components/icons'
import type { BlockDef } from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'
import { TwoBlockWorkflowPreview } from '@/app/(landing)/components/shared/two-block-workflow-preview/two-block-workflow-preview'

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

/** Production Agent and Table cards, using the Table block's Insert Row sentence. */
export function TablesWorkflowPreview() {
  return <TwoBlockWorkflowPreview source={SCORE} target={SAVE} />
}
