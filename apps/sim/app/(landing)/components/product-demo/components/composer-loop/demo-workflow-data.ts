import { Table as TableIcon } from '@sim/emcn/icons'
import {
  AgentIcon,
  ConditionalIcon,
  HumanInTheLoopIcon,
  JiraIcon,
  PackageSearchIcon,
  PagerDutyIcon,
  SlackIcon,
  StartIcon,
  ZendeskIcon,
} from '@/components/icons'
import type { BlockDef } from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

/** Column pitch: production's 250px card plus a 100px run of edge. */
const COLUMN = 350
const col = (index: number) => 40 + index * COLUMN
/** Row pitch: room for the tallest card plus a clear gap. */
const ROW = 200
const row = (index: number) => index * ROW

/**
 * The workflow Sim builds from the composer prompt - "Triage new Zendesk
 * tickets: pull the runbook, classify severity, page on-call for P1s, and
 * draft replies for approval" - in build order, which is also the order the
 * selection walk visits the cards. The Start block every new workflow opens
 * with leads the list and is on the canvas before Sim builds anything; it and
 * a Zendesk ticket trigger both feed the first step, so the workflow runs by
 * hand from Start and in production on each new ticket. A Knowledge search
 * pulls the matching runbook, an agent classifies severity,
 * and a condition splits the ticket: P1s page on-call in PagerDuty, open a Jira
 * incident, and alert the incident channel in Slack; everything else gets a
 * drafted reply that a human approves before it posts back to Zendesk and the
 * outcome lands in a Tables audit log. Production block types, tags, colours,
 * and card sentences throughout, laid out left to right on production's
 * left-input / right-output topology, and staggered on a five-row grid so the
 * graph reads as a laid-out canvas rather than a strip: the ticket trigger
 * sits above Start, the escalation lane climbs away from the condition, and
 * the standard lane steps down from it. The Start card carries no sentence,
 * as in production: its header already says what it is.
 */
export const DEMO_BLOCKS: BlockDef[] = [
  {
    id: 'start',
    name: 'Start',
    type: 'start_trigger',
    icon: StartIcon,
    bgColor: '#34B5FF',
    isTrigger: true,
    rows: [],
    x: col(0),
    /* Header-only, so it is short: this puts its handle level with the first step's. */
    y: row(2) + 44,
  },
  {
    id: 'ticket',
    name: 'New Zendesk ticket',
    type: 'zendesk',
    typeLabel: 'Zendesk',
    isIntegration: true,
    icon: ZendeskIcon,
    bgColor: '#03363D',
    isTrigger: true,
    sentence: {
      segments: ['Run on', { subBlockId: 'selectedTriggerId', noun: 'an event' }],
      values: { selectedTriggerId: 'Ticket Created' },
    },
    rows: [],
    x: col(0),
    y: row(1),
  },
  {
    id: 'runbook',
    name: 'Find the runbook',
    type: 'knowledge',
    typeLabel: 'Knowledge',
    icon: PackageSearchIcon,
    bgColor: '#00B0B0',
    sentence: {
      segments: [
        'Search',
        { subBlockId: 'knowledgeBaseId', noun: 'a knowledge base' },
        'for',
        { subBlockId: 'query', noun: 'a query' },
      ],
      values: { knowledgeBaseId: 'Support runbooks', query: 'ticket summary' },
    },
    rows: [],
    x: col(1),
    y: row(2),
  },
  {
    id: 'classify',
    name: 'Classify severity',
    type: 'agent',
    typeLabel: 'Agent',
    icon: AgentIcon,
    bgColor: 'var(--text-primary)',
    sentence: {
      segments: ['Prompt', { subBlockId: 'model', noun: 'a model' }],
      values: { model: 'claude-sonnet-5' },
    },
    rows: [],
    x: col(2),
    y: row(2),
  },
  {
    id: 'severity',
    name: 'P1 incident?',
    type: 'condition',
    typeLabel: 'Condition',
    icon: ConditionalIcon,
    bgColor: '#FF752F',
    rows: [
      { title: 'If', value: 'P1 severity' },
      { title: 'Else', value: 'everything else' },
    ],
    x: col(3),
    y: row(2),
  },
  {
    id: 'draft',
    name: 'Draft the reply',
    type: 'agent',
    typeLabel: 'Agent',
    icon: AgentIcon,
    bgColor: 'var(--text-primary)',
    sentence: {
      segments: ['Prompt', { subBlockId: 'model', noun: 'a model' }],
      values: { model: 'claude-sonnet-5' },
    },
    rows: [],
    x: col(4),
    y: row(3),
  },
  {
    id: 'approve',
    name: 'Approve the reply',
    type: 'human_in_the_loop',
    typeLabel: 'Human',
    icon: HumanInTheLoopIcon,
    bgColor: '#10B981',
    sentence: {
      segments: ['Pause execution until a human responds'],
      values: {},
    },
    rows: [],
    x: col(5),
    y: row(4),
  },
  {
    id: 'reply',
    name: 'Reply in Zendesk',
    type: 'zendesk',
    typeLabel: 'Zendesk',
    isIntegration: true,
    icon: ZendeskIcon,
    bgColor: '#03363D',
    sentence: {
      segments: [
        'Update ticket',
        { subBlockId: 'ticketId', noun: 'a ticket' },
        ', setting status to',
        { subBlockId: 'status', noun: 'a status' },
      ],
      values: { ticketId: 'the new ticket', status: 'pending' },
    },
    rows: [],
    x: col(6),
    y: row(4),
  },
  {
    id: 'log',
    name: 'Log the outcome',
    type: 'table',
    typeLabel: 'Table',
    icon: TableIcon,
    bgColor: '#10B981',
    isTerminal: true,
    sentence: {
      segments: ['Insert a row into', { subBlockId: 'tableId', noun: 'a table' }],
      values: { tableId: 'Ticket triage' },
    },
    rows: [],
    x: col(7),
    y: row(4),
  },
  {
    id: 'page',
    name: 'Page on-call',
    type: 'pagerduty',
    typeLabel: 'PagerDuty',
    isIntegration: true,
    icon: PagerDutyIcon,
    bgColor: '#06AC38',
    sentence: {
      segments: [
        'Open incident',
        { subBlockId: 'title', noun: 'a title' },
        'on service',
        { subBlockId: 'createServiceId', noun: 'a service' },
      ],
      values: { title: 'P1 ticket', createServiceId: 'Customer Support' },
    },
    rows: [],
    x: col(4),
    y: row(1),
  },
  {
    id: 'incident',
    name: 'Open the incident',
    type: 'jira',
    typeLabel: 'Jira',
    isIntegration: true,
    icon: JiraIcon,
    bgColor: '#FFFFFF',
    tileBorder: true,
    sentence: {
      segments: [
        'Create',
        { subBlockId: 'issueType', noun: 'an issue type' },
        'in',
        { subBlockId: 'projectId', noun: 'a project' },
      ],
      values: { issueType: 'Incident', projectId: 'OPS' },
    },
    rows: [],
    x: col(5),
    y: row(0),
  },
  {
    id: 'alert',
    name: 'Alert #incidents',
    type: 'slack',
    typeLabel: 'Slack',
    isIntegration: true,
    icon: SlackIcon,
    bgColor: '#611F69',
    isTerminal: true,
    sentence: {
      segments: [
        'Post',
        { subBlockId: 'message', noun: 'a message' },
        'to',
        { subBlockId: 'channel', noun: 'a channel' },
      ],
      values: { message: 'incident summary', channel: '#incidents' },
    },
    rows: [],
    x: col(6),
    y: row(0),
  },
]

/**
 * Source → target pairs. The first edge out of the condition is its `If`
 * branch (the P1 escalation) and the second its `Else` (the standard path),
 * which is how the stage assigns branch handles.
 */
export const DEMO_EDGES: ReadonlyArray<readonly [string, string]> = [
  ['start', 'runbook'],
  ['ticket', 'runbook'],
  ['runbook', 'classify'],
  ['classify', 'severity'],
  ['severity', 'page'],
  ['severity', 'draft'],
  ['draft', 'approve'],
  ['approve', 'reply'],
  ['reply', 'log'],
  ['page', 'incident'],
  ['incident', 'alert'],
]

/** Design-space box the stage geometry was laid out in. */
export const DEMO_CANVAS = { width: col(7) + 250 + 40, height: row(4) + 140 + 40 } as const
