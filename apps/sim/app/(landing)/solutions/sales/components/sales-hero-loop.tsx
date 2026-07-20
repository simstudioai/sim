'use client'

import {
  AgentIcon,
  ConditionalIcon,
  SalesforceIcon,
  SlackIcon,
  StartIcon,
} from '@/components/icons'
import { EnterprisePlatformLoop } from '@/app/(landing)/enterprise/components/enterprise-platform-loop'
import type { EnterpriseLoopContent } from '@/app/(landing)/enterprise/components/enterprise-platform-loop/stage-data'

/**
 * Sales content for the shared platform loop - an inbound-lead agent: the
 * prompt asks for lead research, fit scoring, and Salesforce record creation
 * with a Slack alert to the owner, the sidebar reads like the sales team's
 * Brightwave workspace, and the staged workflow builds the routing flow on
 * the enterprise stage geometry. The Salesforce mark is a colored brand
 * mark, so its tile follows the Jira convention - the real mark on a
 * hairlined white tile.
 */
const SALES_LOOP_CONTENT: EnterpriseLoopContent = {
  workspaceName: 'Brightwave Sales',
  greeting: 'What should we get done, Marcus?',
  placeholder: 'Ask Sim to automate a process.',
  prompt:
    'When a new lead comes in, research the company, score the fit, create the record in Salesforce, and alert the account owner in Slack.',
  reply:
    "On it. I'll research every new lead, score the fit against your best customers, create the Salesforce record, and alert the owner in Slack.",
  sidebarChats: [
    'Inbound lead backlog',
    'Acme Co renewal prep',
    'Q3 forecast review',
    'Stale opportunity cleanup',
  ],
  sidebarWorkflows: [
    'Lead research',
    'Inbound routing',
    'CRM hygiene',
    'Meeting prep briefs',
    'Weekly pipeline digest',
  ],
  suggestedActions: [
    'Research this week\u2019s inbound leads',
    'Update stale opportunities',
    'Draft follow-ups from yesterday\u2019s calls',
    'Summarize the Q3 pipeline',
  ],
  stageBlocks: [
    {
      id: 'start',
      name: 'Start',
      icon: StartIcon,
      bgColor: 'var(--text-muted)',
      isTrigger: true,
      rows: [{ title: 'Inputs', value: '-' }],
      x: 155,
      y: 12,
    },
    {
      id: 'research',
      name: 'Research lead',
      icon: AgentIcon,
      bgColor: 'var(--text-primary)',
      rows: [
        { title: 'Messages', value: '-' },
        { title: 'Model', value: '-' },
      ],
      x: 155,
      y: 172,
    },
    {
      id: 'score',
      name: 'Score the fit',
      icon: ConditionalIcon,
      bgColor: 'var(--text-secondary)',
      rows: [{ title: 'Conditions', value: '-' }],
      x: 155,
      y: 372,
    },
    {
      id: 'salesforce',
      name: 'Create in Salesforce',
      icon: SalesforceIcon,
      bgColor: '#FFFFFF',
      tileBorder: true,
      isTerminal: true,
      rows: [
        { title: 'Object', value: '-' },
        { title: 'Action', value: '-' },
      ],
      x: 0,
      y: 560,
    },
    {
      id: 'notify',
      name: 'Alert owner',
      icon: SlackIcon,
      bgColor: '#611F69',
      isTerminal: true,
      rows: [
        { title: 'Channel', value: '-' },
        { title: 'Message', value: '-' },
      ],
      x: 310,
      y: 560,
    },
  ],
  stageEdges: [
    ['start', 'research'],
    ['research', 'score'],
    ['score', 'salesforce'],
    ['score', 'notify'],
  ],
  stageCanvas: { width: 560, height: 680 },
}

/**
 * The sales hero's platform loop - the shared enterprise loop replayed with
 * the inbound-lead story above. Client wrapper so the icon-bearing content
 * object never crosses a server/client boundary.
 */
export function SalesHeroLoop() {
  return <EnterprisePlatformLoop content={SALES_LOOP_CONTENT} />
}
