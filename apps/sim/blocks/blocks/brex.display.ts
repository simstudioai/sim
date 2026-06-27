import { BrexIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const BrexBlockDisplay = {
  type: 'brex',
  name: 'Brex',
  description: 'Manage expenses, receipts, transactions, and team data in Brex',
  category: 'tools',
  bgColor: '#171717',
  icon: BrexIcon,
  longDescription:
    'Integrates Brex into the workflow. List and update expenses, upload and match receipts, view card and cash transactions, accounts, budgets, spend limits, vendors, transfers, and team data.',
  docsLink: 'https://docs.sim.ai/integrations/brex',
  integrationType: IntegrationType.Commerce,
} satisfies BlockDisplay

export const BrexBlockMeta = {
  tags: ['payments'],
  url: 'https://www.brex.com',
  templates: [
    {
      icon: BrexIcon,
      title: 'Brex receipt auto-attach',
      prompt:
        'Build a workflow that takes an uploaded receipt file and sends it to Brex with the Match Receipt operation so Brex automatically pairs it with the right card expense.',
      modules: ['workflows', 'files'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: BrexIcon,
      title: 'Brex daily expense digest',
      prompt:
        'Build a scheduled workflow that runs every weekday morning, lists Brex expenses settled in the last 24 hours, summarizes total spend by merchant category, and posts the digest to a Slack channel.',
      modules: ['workflows', 'scheduled'],
      category: 'operations',
      tags: ['automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: BrexIcon,
      title: 'Brex memo enforcer',
      prompt:
        'Build a scheduled workflow that lists approved Brex expenses, finds ones missing a memo, has an agent draft a memo from the merchant and amount details, and updates each expense with the drafted memo.',
      modules: ['agent', 'workflows', 'scheduled'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: BrexIcon,
      title: 'Brex spend anomaly alert',
      prompt:
        'Build a scheduled workflow that lists recent Brex card transactions, flags any transaction above a configurable threshold, and emails the finance team a report of flagged transactions with merchant details.',
      modules: ['workflows', 'scheduled'],
      category: 'operations',
      tags: ['automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: BrexIcon,
      title: 'Brex cash balance monitor',
      prompt:
        'Build a scheduled workflow that checks Brex cash account balances every morning and sends a Slack alert when the available balance of any account drops below a set threshold.',
      modules: ['workflows', 'scheduled'],
      category: 'operations',
      tags: ['automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: BrexIcon,
      title: 'Brex budget utilization report',
      prompt:
        'Build a weekly workflow that lists Brex budgets and spend limits, computes utilization for each budget from its amount and current period balance, stores the results in a table, and emails a summary report.',
      modules: ['workflows', 'scheduled', 'tables'],
      category: 'operations',
      tags: ['automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: BrexIcon,
      title: 'Brex team directory assistant',
      prompt:
        'Build an agent that answers questions about company spend and team structure by looking up Brex users, departments, locations, and their expenses on demand.',
      modules: ['agent'],
      category: 'productivity',
      tags: ['automation'],
    },
    {
      icon: BrexIcon,
      title: 'Brex vendor payment tracker',
      prompt:
        'Build a workflow that lists Brex vendors and recent transfers, reconciles transfer statuses against expected payments stored in a table, and flags any failed or delayed payments.',
      modules: ['workflows', 'tables'],
      category: 'operations',
      tags: ['automation'],
    },
  ],
  skills: [
    {
      name: 'spend-report',
      description:
        'Summarize Brex spend over a period, broken down by category, merchant, and user.',
      content:
        '# Spend Report\n\nBuild a clear summary of company spend from Brex expenses.\n\n## Steps\n1. List expenses filtered to the requested period using the purchased-at date filters.\n2. Group expenses by merchant category, merchant, and user, totaling billing amounts (amounts are in cents).\n3. Highlight the largest expenses and any with OUT_OF_POLICY status.\n\n## Output\nReturn total spend, a breakdown by category and merchant, the top spenders, and any flagged out-of-policy expenses with dashboard links.',
    },
    {
      name: 'attach-receipt',
      description: 'Upload a receipt file and attach it to the right Brex expense.',
      content:
        '# Attach a Receipt\n\nGet a receipt onto the correct Brex expense.\n\n## Steps\n1. If the target expense is known, use Upload Receipt with the expense ID.\n2. If not, use Match Receipt so Brex pairs the receipt with the right expense automatically.\n3. Confirm the upload succeeded and capture the receipt ID.\n\n## Output\nReturn the receipt ID, the receipt name, and the expense it was attached to (or note that Brex is matching it automatically).',
    },
    {
      name: 'memo-cleanup',
      description: 'Find Brex expenses missing memos and fill them in from merchant details.',
      content:
        '# Memo Cleanup\n\nKeep expense memos complete for accounting.\n\n## Steps\n1. List recent expenses and find ones with an empty memo.\n2. For each, draft a short memo from the merchant descriptor, category, and amount.\n3. Update each expense with the drafted memo using Update Expense Memo.\n\n## Output\nReturn the list of expenses updated, each with its new memo, and any expenses that could not be updated.',
    },
    {
      name: 'budget-utilization',
      description: 'Report utilization for Brex budgets and spend limits.',
      content:
        '# Budget Utilization\n\nShow how much of each budget and spend limit has been used.\n\n## Steps\n1. List budgets and capture each amount and status.\n2. List spend limits and capture each current period balance.\n3. Compute utilization where both an amount and a balance are available (amounts are in cents).\n\n## Output\nReturn each budget and spend limit with its owner, period, amount, and utilization, flagging any that are near or over their limit.',
    },
    {
      name: 'cash-balance-check',
      description: 'Check Brex cash account balances and recent account activity.',
      content:
        '# Cash Balance Check\n\nGive a quick read on company cash in Brex.\n\n## Steps\n1. List cash accounts and capture current and available balances (amounts are in cents).\n2. For the primary account, list recent cash transactions.\n3. Note any unusually large recent movements.\n\n## Output\nReturn each account with its balances, the most recent transactions for the primary account, and any large movements worth a look.',
    },
    {
      name: 'statement-reconciliation',
      description: 'Reconcile a Brex card statement period against its settled transactions.',
      content:
        '# Statement Reconciliation\n\nTie a card statement back to its underlying transactions.\n\n## Steps\n1. List card statements and pick the period to reconcile.\n2. List card transactions posted within that period using the posted-at filter.\n3. Compare transaction totals to the statement start and end balances and flag gaps.\n\n## Output\nReturn the statement period, its balances, the transaction total for the period, and any discrepancy that needs review.',
    },
  ],
} as const satisfies BlockMeta
