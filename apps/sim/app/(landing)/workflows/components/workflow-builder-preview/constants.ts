import { Table as TableIcon } from '@sim/emcn/icons'
import { AgentIcon, PackageSearchIcon, SlackIcon } from '@/components/icons'
import type { BlockDef } from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

interface PreviewBlock extends BlockDef {
  selectorLabel: string
  className: string
  focusClassName: string
}

/** A support request becomes a grounded reply and a record in Tables, using production sentences. */
export const PREVIEW_BLOCKS: PreviewBlock[] = [
  {
    id: 'request',
    name: 'New message',
    type: 'slack_v2',
    typeLabel: 'Slack',
    selectorLabel: 'Request',
    icon: SlackIcon,
    bgColor: '#611f69',
    isIntegration: true,
    isTrigger: true,
    sentence: {
      segments: [
        'Run on',
        { subBlockId: 'eventType', noun: 'an event' },
        'in',
        { subBlockId: 'channelFilter', noun: 'a channel' },
      ],
      values: { eventType: 'Message', channelFilter: '#help' },
    },
    rows: [],
    x: 0,
    y: 148,
    className: 'left-0 top-[148px]',
    focusClassName: '@max-[760px]:translate-x-[calc(-50%+480px)]',
  },
  {
    id: 'knowledge',
    name: 'Find docs',
    type: 'knowledge',
    typeLabel: 'Knowledge',
    selectorLabel: 'Knowledge',
    icon: PackageSearchIcon,
    bgColor: '#00B0B0',
    sentence: {
      segments: ['Search', { subBlockId: 'knowledgeBaseSelector', noun: 'a knowledge base' }],
      values: { knowledgeBaseSelector: 'Help center' },
    },
    rows: [],
    x: 320,
    y: 132,
    className: 'left-[320px] top-[132px]',
    focusClassName: '@max-[760px]:translate-x-[calc(-50%+160px)]',
  },
  {
    id: 'draft',
    name: 'Draft reply',
    type: 'agent',
    typeLabel: 'Agent',
    selectorLabel: 'Agent',
    icon: AgentIcon,
    bgColor: 'var(--text-primary)',
    sentence: {
      segments: ['Prompt', { subBlockId: 'model', noun: 'a model' }],
      values: { model: 'GPT-6 Astra' },
    },
    rows: [],
    x: 640,
    y: 132,
    className: 'left-[640px] top-[132px]',
    focusClassName: '@max-[760px]:translate-x-[calc(-50%-160px)]',
  },
  {
    id: 'reply',
    name: 'Send reply',
    type: 'slack_v2',
    typeLabel: 'Slack',
    selectorLabel: 'Slack',
    icon: SlackIcon,
    bgColor: '#611f69',
    isIntegration: true,
    isTerminal: true,
    sentence: {
      segments: [
        'Post',
        { subBlockId: 'text', noun: 'a message' },
        'to',
        { subBlockId: 'channel', noun: 'a channel' },
      ],
      values: { text: 'reply', channel: '#help' },
    },
    rows: [],
    x: 960,
    y: 24,
    className: 'left-[960px] top-6',
    focusClassName:
      '@max-[760px]:translate-x-[calc(-50%-480px)] @max-[760px]:translate-y-[calc(-50%+108px)]',
  },
  {
    id: 'record',
    name: 'Save ticket',
    type: 'table_v2',
    typeLabel: 'Table',
    selectorLabel: 'Table',
    icon: TableIcon,
    bgColor: '#10B981',
    isTerminal: true,
    sentence: {
      segments: ['Insert a row into', { subBlockId: 'tableSelector', noun: 'a table' }],
      values: { tableSelector: 'Tickets' },
    },
    rows: [],
    x: 960,
    y: 240,
    className: 'left-[960px] top-60',
    focusClassName:
      '@max-[760px]:translate-x-[calc(-50%-480px)] @max-[760px]:translate-y-[calc(-50%-108px)]',
  },
]

/** Both outputs consume the drafted reply; this is a fan-out, not a conditional branch. */
export const PREVIEW_EDGES = [
  ['request', 'knowledge'],
  ['knowledge', 'draft'],
  ['draft', 'reply'],
  ['draft', 'record'],
] as const
