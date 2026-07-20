'use client'

import { AgentIcon, ConditionalIcon, MailIcon, StartIcon, TableIcon } from '@/components/icons'
import { EnterprisePlatformLoop } from '@/app/(landing)/enterprise/components/enterprise-platform-loop'
import type { EnterpriseLoopContent } from '@/app/(landing)/enterprise/components/enterprise-platform-loop/stage-data'

/**
 * Finance content for the shared platform loop - a month-end close agent: the
 * prompt asks for Stripe-to-NetSuite reconciliation with controller review,
 * the sidebar reads like the finance team's Brightwave workspace, and the
 * staged workflow builds the reconciliation flow on the enterprise stage
 * geometry. All tiles stay on the grey ramp, matching the enterprise flow.
 */
const FINANCE_LOOP_CONTENT: EnterpriseLoopContent = {
  workspaceName: 'Brightwave Finance',
  greeting: 'What should we get done, Elena?',
  placeholder: 'Ask Sim to automate a process.',
  prompt:
    'At month-end close, match transactions in Stripe against the NetSuite ledger, flag unreconciled items, and send the summary to the controller.',
  reply:
    "On it. I'll match every Stripe transaction to the NetSuite ledger, flag what doesn't reconcile, and send the close summary to the controller.",
  sidebarChats: [
    'June close checklist',
    'Unreconciled Stripe payouts',
    'Vendor invoice exceptions',
    'Budget variance review',
  ],
  sidebarWorkflows: [
    'Month-end reconciliation',
    'Invoice exception routing',
    'Expense report audit',
    'Revenue recognition',
    'Weekly cash report',
  ],
  suggestedActions: [
    'Reconcile this week\u2019s Stripe payouts',
    'Review flagged vendor invoices',
    'Summarize budget variances',
    'Draft the weekly cash report',
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
      id: 'match',
      name: 'Match transactions',
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
      id: 'exceptions',
      name: 'Flag exceptions',
      icon: ConditionalIcon,
      bgColor: 'var(--text-secondary)',
      rows: [{ title: 'Conditions', value: '-' }],
      x: 155,
      y: 372,
    },
    {
      id: 'review',
      name: 'Controller review',
      icon: MailIcon,
      bgColor: 'var(--text-body)',
      isTerminal: true,
      rows: [
        { title: 'To', value: '-' },
        { title: 'Subject', value: '-' },
      ],
      x: 0,
      y: 560,
    },
    {
      id: 'ledger',
      name: 'Post to ledger',
      icon: TableIcon,
      bgColor: 'var(--text-muted)',
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
    ['start', 'match'],
    ['match', 'exceptions'],
    ['exceptions', 'review'],
    ['exceptions', 'ledger'],
  ],
  stageCanvas: { width: 560, height: 680 },
}

/**
 * The finance hero's platform loop - the shared enterprise loop replayed with
 * the month-end close story above. Client wrapper so the icon-bearing content
 * object never crosses a server/client boundary.
 */
export function FinanceHeroLoop() {
  return <EnterprisePlatformLoop content={FINANCE_LOOP_CONTENT} />
}
