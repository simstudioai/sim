'use client'

import {
  AgentIcon,
  ConditionalIcon,
  JiraIcon,
  SlackIcon,
  StartIcon,
  TableIcon,
} from '@/components/icons'
import { EditorLoop, type EditorLoopContent } from '@/app/(landing)/components/shared/editor-loop'

/**
 * The workflows hero's content for the shared {@link EditorLoop}: a builder's
 * workspace sidebar and the complete support-routing workflow - a trigger, an
 * agent, a router, and a three-way fan-out to Slack, Jira, and Tables. Wider
 * than the chat heroes' half-pane flows (center spine at x=555, terminals
 * fanned across 1360 design px) because the canvas owns the whole workspace
 * pane here. Colors follow the stage convention - grey ramp for platform
 * blocks, brand tiles only for real third-party marks. Blocks are ordered by
 * build sequence; an edge draws once both endpoints are on canvas. The agent
 * block is the one the "editing" beat selects once the flow is assembled.
 */
const WORKFLOWS_EDITOR_CONTENT: EditorLoopContent = {
  sidebarChats: [
    'Support bot revamp',
    'Lead scoring tweaks',
    'Invoice matching flow',
    'Weekly digest agent',
  ],
  sidebarWorkflows: [
    'Support ticket routing',
    'Lead enrichment',
    'Invoice matching',
    'Weekly digest',
    'Churn-risk alerts',
  ],
  blocks: [
    {
      id: 'start',
      name: 'Start',
      icon: StartIcon,
      bgColor: 'var(--text-muted)',
      isTrigger: true,
      rows: [{ title: 'Inputs', value: '-' }],
      x: 555,
      y: 20,
    },
    {
      id: 'agent',
      name: 'Support agent',
      icon: AgentIcon,
      bgColor: 'var(--text-primary)',
      rows: [
        { title: 'Messages', value: '-' },
        { title: 'Model', value: '-' },
      ],
      x: 555,
      y: 230,
    },
    {
      id: 'route',
      name: 'Route intent',
      icon: ConditionalIcon,
      bgColor: 'var(--text-secondary)',
      rows: [{ title: 'Conditions', value: '-' }],
      x: 555,
      y: 470,
    },
    {
      id: 'slack',
      name: 'Reply in Slack',
      icon: SlackIcon,
      bgColor: '#611F69',
      isTerminal: true,
      rows: [
        { title: 'Channel', value: '-' },
        { title: 'Message', value: '-' },
      ],
      x: 100,
      y: 700,
    },
    {
      id: 'jira',
      name: 'Escalate to Jira',
      icon: JiraIcon,
      bgColor: '#FFFFFF',
      tileBorder: true,
      isTerminal: true,
      rows: [
        { title: 'Project', value: '-' },
        { title: 'Summary', value: '-' },
      ],
      x: 555,
      y: 700,
    },
    {
      id: 'tables',
      name: 'Log to Tables',
      icon: TableIcon,
      bgColor: 'var(--text-body)',
      isTerminal: true,
      rows: [
        { title: 'Table', value: '-' },
        { title: 'Operation', value: '-' },
      ],
      x: 1010,
      y: 700,
    },
  ],
  edges: [
    ['start', 'agent'],
    ['agent', 'route'],
    ['route', 'slack'],
    ['route', 'jira'],
    ['route', 'tables'],
  ],
  canvas: { width: 1360, height: 910 },
  selectedBlockId: 'agent',
}

/**
 * The workflows hero's editor loop - the shared {@link EditorLoop} replaying
 * the support-routing workflow with the agent block as the "being edited"
 * beat.
 */
export function WorkflowsEditorLoop() {
  return <EditorLoop content={WORKFLOWS_EDITOR_CONTENT} />
}
