'use client'

import { AgentIcon, ConditionalIcon, OktaIcon, SlackIcon, StartIcon } from '@/components/icons'
import { EnterprisePlatformLoop } from '@/app/(landing)/enterprise/components/enterprise-platform-loop'
import type { EnterpriseLoopContent } from '@/app/(landing)/enterprise/components/enterprise-platform-loop/stage-data'

/**
 * HR content for the shared platform loop - a new-hire onboarding agent: the
 * prompt asks for account provisioning, orientation scheduling, and the
 * day-one welcome, the sidebar reads like the people team's Brightwave
 * workspace, and the staged workflow builds the onboarding flow on the
 * enterprise stage geometry. Brand tiles follow the stage convention - Slack's
 * plum, Okta's monochrome mark on a hairlined white tile.
 */
const HR_LOOP_CONTENT: EnterpriseLoopContent = {
  workspaceName: 'Brightwave HR',
  greeting: 'What should we get done, Sam?',
  placeholder: 'Ask Sim to automate a process.',
  prompt:
    'When a new hire signs their offer, create their accounts in Okta and Slack, schedule orientation, and send the day-one welcome packet.',
  reply:
    "On it. I'll provision Okta and Slack accounts, schedule orientation with the team, and send the welcome packet on day one.",
  sidebarChats: [
    'July onboarding cohort',
    'Benefits enrollment Qs',
    'PTO policy update',
    'Manager training invites',
  ],
  sidebarWorkflows: [
    'New hire onboarding',
    'Employee questions bot',
    'PTO request routing',
    'Benefits enrollment',
    'Offboarding checklist',
  ],
  suggestedActions: [
    'Onboard Monday\u2019s new hires',
    'Answer open benefits questions',
    'Review pending PTO requests',
    'Draft the new-team announcement',
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
      id: 'onboard',
      name: 'Onboard hire',
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
      id: 'tasks',
      name: 'Route setup tasks',
      icon: ConditionalIcon,
      bgColor: 'var(--text-secondary)',
      rows: [{ title: 'Conditions', value: '-' }],
      x: 155,
      y: 372,
    },
    {
      id: 'accounts',
      name: 'Create accounts',
      icon: OktaIcon,
      bgColor: '#FFFFFF',
      tileBorder: true,
      isTerminal: true,
      rows: [
        { title: 'Apps', value: '-' },
        { title: 'Action', value: '-' },
      ],
      x: 0,
      y: 560,
    },
    {
      id: 'welcome',
      name: 'Welcome message',
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
    ['start', 'onboard'],
    ['onboard', 'tasks'],
    ['tasks', 'accounts'],
    ['tasks', 'welcome'],
  ],
  stageCanvas: { width: 560, height: 680 },
}

/**
 * The HR hero's platform loop - the shared enterprise loop replayed with the
 * onboarding story above. Client wrapper so the icon-bearing content object
 * never crosses a server/client boundary.
 */
export function HrHeroLoop() {
  return <EnterprisePlatformLoop content={HR_LOOP_CONTENT} />
}
