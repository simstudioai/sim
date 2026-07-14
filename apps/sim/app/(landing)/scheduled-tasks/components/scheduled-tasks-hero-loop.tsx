'use client'

import { AgentIcon, GmailIcon, GoogleSheetsIcon, ScheduleIcon, SlackIcon } from '@/components/icons'
import { EditorLoop, type EditorLoopContent } from '@/app/(landing)/components/shared/editor-loop'

/**
 * The scheduled-tasks hero's content for the shared {@link EditorLoop}: a
 * recurring-ops workspace sidebar and the complete scheduled digest workflow -
 * a schedule trigger holding the cadence, the digest agent, and a three-way
 * fan-out to Slack, Gmail, and Sheets. The schedule trigger is the block the
 * "editing" beat selects, since the cadence is this page's story. Colors
 * follow the stage convention - grey ramp for platform blocks, brand tiles
 * only for real third-party marks (multicolor Gmail/Sheets glyphs sit on
 * white tiles with a hairline, the Jira treatment). Blocks are ordered by
 * build sequence; an edge draws once both endpoints are on canvas.
 */
const SCHEDULED_TASKS_EDITOR_CONTENT: EditorLoopContent = {
  sidebarChats: [
    'Morning digest setup',
    'Move sync to nightly',
    'Weekly KPI report',
    'Retry failed runs',
  ],
  sidebarWorkflows: [
    'Morning digest',
    'Nightly data sync',
    'Weekly KPI report',
    'Invoice sweep',
    'Churn-risk alerts',
  ],
  blocks: [
    {
      id: 'schedule',
      name: 'Schedule',
      icon: ScheduleIcon,
      bgColor: 'var(--text-muted)',
      isTrigger: true,
      rows: [
        { title: 'Cadence', value: 'Weekdays' },
        { title: 'Time', value: '9:00 AM PT' },
      ],
      x: 555,
      y: 20,
    },
    {
      id: 'agent',
      name: 'Digest agent',
      icon: AgentIcon,
      bgColor: 'var(--text-primary)',
      rows: [
        { title: 'Messages', value: '-' },
        { title: 'Model', value: '-' },
      ],
      x: 555,
      y: 280,
    },
    {
      id: 'slack',
      name: 'Post to Slack',
      icon: SlackIcon,
      bgColor: '#611F69',
      isTerminal: true,
      rows: [
        { title: 'Channel', value: '-' },
        { title: 'Message', value: '-' },
      ],
      x: 100,
      y: 560,
    },
    {
      id: 'gmail',
      name: 'Send by email',
      icon: GmailIcon,
      bgColor: '#FFFFFF',
      tileBorder: true,
      isTerminal: true,
      rows: [
        { title: 'To', value: '-' },
        { title: 'Subject', value: '-' },
      ],
      x: 555,
      y: 560,
    },
    {
      id: 'sheets',
      name: 'Append to Sheets',
      icon: GoogleSheetsIcon,
      bgColor: '#FFFFFF',
      tileBorder: true,
      isTerminal: true,
      rows: [
        { title: 'Spreadsheet', value: '-' },
        { title: 'Range', value: '-' },
      ],
      x: 1010,
      y: 560,
    },
  ],
  edges: [
    ['schedule', 'agent'],
    ['agent', 'slack'],
    ['agent', 'gmail'],
    ['agent', 'sheets'],
  ],
  canvas: { width: 1360, height: 780 },
  selectedBlockId: 'schedule',
}

/**
 * The scheduled-tasks hero's editor loop - the shared {@link EditorLoop}
 * replaying the morning-digest workflow with the schedule trigger as the
 * "being edited" beat, the cadence being this page's story.
 */
export function ScheduledTasksHeroLoop() {
  return <EditorLoop content={SCHEDULED_TASKS_EDITOR_CONTENT} />
}
