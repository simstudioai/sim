'use client'

import { AgentIcon, ConditionalIcon, ScheduleIcon, SlackIcon, TableIcon } from '@/components/icons'
import { EnterprisePlatformLoop } from '@/app/(landing)/enterprise/components/enterprise-platform-loop'
import type { EnterpriseLoopContent } from '@/app/(landing)/enterprise/components/enterprise-platform-loop/stage-data'

/**
 * Compliance content for the shared platform loop - an evidence-collection
 * agent: the prompt asks for weekly SOC 2 evidence sweeps with drift flags,
 * the sidebar reads like the GRC team's Brightwave workspace, and the staged
 * workflow builds the evidence flow on the enterprise stage geometry. The
 * trigger is a Schedule block (the prompt's "every Monday" cadence); the only
 * brand tile is Slack's, where drift gets flagged.
 */
const COMPLIANCE_LOOP_CONTENT: EnterpriseLoopContent = {
  workspaceName: 'Brightwave GRC',
  greeting: 'What should we get done, Dana?',
  placeholder: 'Ask Sim to automate a process.',
  prompt:
    'Every Monday, pull access logs and config changes from our core systems, check them against SOC 2 controls, and flag any drift for review.',
  reply:
    "On it. I'll collect the evidence every Monday, map it to your SOC 2 controls, and flag any drift for the team to review.",
  sidebarChats: [
    'SOC 2 evidence gaps',
    'Vendor DPA renewals',
    'Q3 access review',
    'Policy update rollout',
  ],
  sidebarWorkflows: [
    'Evidence collection',
    'Access review',
    'Vendor risk scoring',
    'Policy attestation',
    'Audit trail export',
  ],
  suggestedActions: [
    'Collect this week\u2019s SOC 2 evidence',
    'Review stale access grants',
    'Summarize open audit findings',
    'Draft the vendor risk report',
  ],
  stageBlocks: [
    {
      id: 'schedule',
      name: 'Schedule',
      icon: ScheduleIcon,
      bgColor: 'var(--text-muted)',
      isTrigger: true,
      rows: [{ title: 'Cadence', value: '-' }],
      x: 155,
      y: 12,
    },
    {
      id: 'collect',
      name: 'Collect evidence',
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
      id: 'controls',
      name: 'Check controls',
      icon: ConditionalIcon,
      bgColor: 'var(--text-secondary)',
      rows: [{ title: 'Conditions', value: '-' }],
      x: 155,
      y: 372,
    },
    {
      id: 'drift',
      name: 'Flag drift',
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
      id: 'ledger',
      name: 'Evidence log',
      icon: TableIcon,
      bgColor: 'var(--text-body)',
      isTerminal: true,
      rows: [
        { title: 'Table', value: '-' },
        { title: 'Operation', value: '-' },
      ],
      x: 310,
      y: 560,
    },
  ],
  stageEdges: [
    ['schedule', 'collect'],
    ['collect', 'controls'],
    ['controls', 'drift'],
    ['controls', 'ledger'],
  ],
  stageCanvas: { width: 560, height: 680 },
}

/**
 * The compliance hero's platform loop - the shared enterprise loop replayed
 * with the evidence-collection story above. Client wrapper so the icon-bearing
 * content object never crosses a server/client boundary.
 */
export function ComplianceHeroLoop() {
  return <EnterprisePlatformLoop content={COMPLIANCE_LOOP_CONTENT} />
}
