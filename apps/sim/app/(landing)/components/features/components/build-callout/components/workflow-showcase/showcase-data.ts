import {
  AgentIcon,
  AnthropicIcon,
  GmailIcon,
  LinearIcon,
  SlackIcon,
  TableIcon,
} from '@/components/icons'
import type { BlockDef } from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

/**
 * Design-space geometry for the Build card's workflow showcase - a
 * support-triage pipeline flowing LEFT TO RIGHT: two triggers (a Gmail inbox
 * and a Slack channel) converge on a triage agent, which fans out to four
 * destinations - Linear, an eng escalation, a customer reply, and Tables.
 * Rows carry concrete values (not placeholders) so the canvas reads like a
 * configured workflow.
 *
 * Column geometry: three columns at x=0 / x=370 / x=740 on a 990-wide canvas.
 * The triggers straddle the agent's row; the four outputs stack down the
 * right column, spanning y=20-666 on a 686-tall canvas. The bounding box
 * exactly hugs the blocks, so the stage's flex-centering shows the whole
 * flow clean and uncut. Edges run from right handles to left handles at
 * `HANDLE_Y_OFFSET`, matching the real editor's horizontal layout.
 *
 * Icon tiles follow the platform rule: grey text-ramp tiles for first-party
 * blocks, brand colors only for REAL third-party marks, and white bordered
 * tiles for marks that carry their own colors.
 */
export const SHOWCASE_BLOCKS: BlockDef[] = [
  {
    id: 'gmail-trigger',
    name: 'New support email',
    icon: GmailIcon,
    bgColor: '#FFFFFF',
    tileBorder: true,
    isTrigger: true,
    rows: [
      { title: 'From', value: 'Customers' },
      { title: 'Filter', value: 'Unread' },
    ],
    x: 0,
    y: 150,
  },
  {
    id: 'slack-trigger',
    name: 'New #support post',
    icon: SlackIcon,
    bgColor: '#611F69',
    isTrigger: true,
    rows: [
      { title: 'Channel', value: '#support' },
      { title: 'Event', value: 'New message' },
    ],
    x: 0,
    y: 424,
  },
  {
    id: 'triage',
    name: 'Triage request',
    icon: AgentIcon,
    bgColor: 'var(--text-primary)',
    rows: [
      { title: 'Model', value: 'Claude', valueIcon: AnthropicIcon },
      { title: 'Knowledge', value: 'Help center' },
      { title: 'Instructions', value: 'Triage + draft' },
    ],
    x: 370,
    y: 277,
  },
  {
    id: 'linear',
    name: 'File bug',
    icon: LinearIcon,
    bgColor: '#FFFFFF',
    tileBorder: true,
    isTerminal: true,
    rows: [
      { title: 'Team', value: 'Platform' },
      { title: 'Priority', value: 'From triage' },
    ],
    x: 740,
    y: 20,
  },
  {
    id: 'escalate',
    name: 'Escalate to eng',
    icon: SlackIcon,
    bgColor: '#611F69',
    isTerminal: true,
    rows: [
      { title: 'Channel', value: '#eng-oncall' },
      { title: 'When', value: 'Urgent' },
    ],
    x: 740,
    y: 200,
  },
  {
    id: 'reply',
    name: 'Send reply',
    icon: GmailIcon,
    bgColor: '#FFFFFF',
    tileBorder: true,
    isTerminal: true,
    rows: [
      { title: 'To', value: 'Customer' },
      { title: 'Tone', value: 'Friendly' },
    ],
    x: 740,
    y: 380,
  },
  {
    id: 'tables',
    name: 'Log ticket',
    icon: TableIcon,
    bgColor: 'var(--text-body)',
    isTerminal: true,
    rows: [
      { title: 'Table', value: 'Tickets' },
      { title: 'Operation', value: 'Insert' },
    ],
    x: 740,
    y: 560,
  },
]

/** Source → target pairs; every edge is drawn (the flow renders finished). */
export const SHOWCASE_EDGES: ReadonlyArray<readonly [string, string]> = [
  ['gmail-trigger', 'triage'],
  ['slack-trigger', 'triage'],
  ['triage', 'linear'],
  ['triage', 'escalate'],
  ['triage', 'reply'],
  ['triage', 'tables'],
]

/** Design-space bounding box of the layout above. */
export const SHOWCASE_CANVAS = { width: 990, height: 686 } as const
