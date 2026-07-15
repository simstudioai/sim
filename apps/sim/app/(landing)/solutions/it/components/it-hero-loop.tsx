'use client'

import { AgentIcon, ConditionalIcon, MailIcon, OktaIcon, StartIcon } from '@/components/icons'
import { EnterprisePlatformLoop } from '@/app/(landing)/enterprise/components/enterprise-platform-loop'
import type { EnterpriseLoopContent } from '@/app/(landing)/enterprise/components/enterprise-platform-loop/stage-data'

/**
 * IT content for the shared platform loop - an access-request agent: the
 * prompt asks for Okta-verified provisioning with an audit note, the sidebar
 * reads like the IT team's Brightwave workspace, and the staged workflow
 * builds the access flow on the enterprise stage geometry. The Okta mark is
 * monochrome (`currentColor`), so its tile follows the Jira convention - the
 * real mark on a hairlined white tile.
 */
const IT_LOOP_CONTENT: EnterpriseLoopContent = {
  workspaceName: 'Brightwave IT',
  greeting: 'What should we get done, Priya?',
  placeholder: 'Ask Sim to automate a process.',
  prompt:
    'When an access request comes in, check the requester\u2019s role in Okta, provision the right groups, and close the ticket with an audit note.',
  reply:
    "On it. I'll verify each request against Okta roles, provision the groups automatically, and close the ticket with a full audit note.",
  sidebarChats: [
    'Okta group cleanup',
    'Laptop refresh queue',
    'VPN access requests',
    'Zendesk backlog triage',
  ],
  sidebarWorkflows: [
    'Access provisioning',
    'Ticket triage',
    'Employee offboarding',
    'License audit',
    'Device compliance check',
  ],
  suggestedActions: [
    'Triage new IT tickets in Zendesk',
    'Review pending access requests',
    'Audit unused software licenses',
    'Draft the weekly IT ops summary',
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
      id: 'verify',
      name: 'Verify request',
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
      id: 'policy',
      name: 'Route by policy',
      icon: ConditionalIcon,
      bgColor: 'var(--text-secondary)',
      rows: [{ title: 'Conditions', value: '-' }],
      x: 155,
      y: 372,
    },
    {
      id: 'okta',
      name: 'Provision in Okta',
      icon: OktaIcon,
      bgColor: '#FFFFFF',
      tileBorder: true,
      isTerminal: true,
      rows: [
        { title: 'Groups', value: '-' },
        { title: 'Action', value: '-' },
      ],
      x: 0,
      y: 560,
    },
    {
      id: 'notify',
      name: 'Notify requester',
      icon: MailIcon,
      bgColor: 'var(--text-body)',
      isTerminal: true,
      rows: [
        { title: 'To', value: '-' },
        { title: 'Subject', value: '-' },
      ],
      x: 310,
      y: 560,
    },
  ],
  stageEdges: [
    ['start', 'verify'],
    ['verify', 'policy'],
    ['policy', 'okta'],
    ['policy', 'notify'],
  ],
  stageCanvas: { width: 560, height: 680 },
}

/**
 * The IT hero's platform loop - the shared enterprise loop replayed with the
 * access-provisioning story above. Client wrapper so the icon-bearing content
 * object never crosses a server/client boundary.
 */
export function ItHeroLoop() {
  return <EnterprisePlatformLoop content={IT_LOOP_CONTENT} />
}
