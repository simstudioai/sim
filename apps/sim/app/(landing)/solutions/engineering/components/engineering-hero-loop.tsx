'use client'

import { AgentIcon, ConditionalIcon, JiraIcon, SlackIcon, StartIcon } from '@/components/icons'
import { EnterprisePlatformLoop } from '@/app/(landing)/enterprise/components/enterprise-platform-loop'
import type { EnterpriseLoopContent } from '@/app/(landing)/enterprise/components/enterprise-platform-loop/stage-data'

/**
 * Engineering content for the shared platform loop - an on-call triage agent:
 * the prompt asks for alert triage into Jira and Slack, the sidebar reads like
 * the engineering team's Brightwave workspace, and the staged workflow builds
 * the alert-triage flow on the enterprise stage geometry (spine at x=155,
 * terminals fanned at y=560). Colors follow the stage convention - grey ramp
 * for platform blocks, brand tiles only for real third-party marks (Slack's
 * plum, Jira's mark on a hairlined white tile).
 */
const ENGINEERING_LOOP_CONTENT: EnterpriseLoopContent = {
  workspaceName: 'Brightwave Engineering',
  greeting: 'What should we get done, Alex?',
  placeholder: 'Ask Sim to automate a process.',
  prompt:
    'When a PagerDuty alert fires, pull recent deploys and error traces, triage severity, and file a Jira issue with the context on-call needs.',
  reply:
    "On it. I'll triage each alert against recent deploys and traces, set severity, and file the Jira issue with full context for on-call.",
  sidebarChats: [
    'Flaky deploy pipeline',
    'PR review backlog',
    'Incident 4213 postmortem',
    'Staging env access',
  ],
  sidebarWorkflows: [
    'Code review agent',
    'On-call triage',
    'Release notes drafts',
    'CI failure triage',
    'Runbook sync',
  ],
  suggestedActions: [
    'Review open pull requests in GitHub',
    'Triage overnight PagerDuty alerts',
    'Summarize failing CI runs',
    'Draft release notes for v2.31',
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
      id: 'triage',
      name: 'Triage alert',
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
      id: 'severity',
      name: 'Set severity',
      icon: ConditionalIcon,
      bgColor: 'var(--text-secondary)',
      rows: [{ title: 'Conditions', value: '-' }],
      x: 155,
      y: 372,
    },
    {
      id: 'oncall',
      name: 'Notify on-call',
      icon: SlackIcon,
      bgColor: '#611F69',
      isTerminal: true,
      rows: [
        { title: 'Channel', value: '-' },
        { title: 'Message', value: '-' },
      ],
      x: 0,
      y: 560,
    },
    {
      id: 'jira',
      name: 'File Jira issue',
      icon: JiraIcon,
      bgColor: '#FFFFFF',
      tileBorder: true,
      isTerminal: true,
      rows: [
        { title: 'Project', value: '-' },
        { title: 'Summary', value: '-' },
      ],
      x: 310,
      y: 560,
    },
  ],
  stageEdges: [
    ['start', 'triage'],
    ['triage', 'severity'],
    ['severity', 'oncall'],
    ['severity', 'jira'],
  ],
  stageCanvas: { width: 560, height: 680 },
}

/**
 * The engineering hero's platform loop - the shared enterprise loop replayed
 * with the on-call triage story above. Client wrapper so the icon-bearing
 * content object never crosses a server/client boundary.
 */
export function EngineeringHeroLoop() {
  return <EnterprisePlatformLoop content={ENGINEERING_LOOP_CONTENT} />
}
