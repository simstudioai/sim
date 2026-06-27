import { SapConcurIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const SapConcurBlockDisplay = {
  type: 'sap_concur',
  name: 'SAP Concur',
  description: 'Manage expense reports, travel requests, cash advances, and more in SAP Concur',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: SapConcurIcon,
  longDescription:
    'Connect SAP Concur via OAuth 2.0. Manage expense reports and line items, allocations, attendees, comments, exceptions, quick expenses, receipts, travel requests and expected expenses, cash advances, itineraries, user identities, custom lists, budgets, exchange rates, and purchase requests across every Concur datacenter.',
  docsLink: 'https://docs.sim.ai/integrations/sap_concur',
  integrationType: IntegrationType.Productivity,
} satisfies BlockDisplay

export const SapConcurBlockMeta = {
  tags: ['automation'],
  url: 'https://www.concur.com',
  templates: [
    {
      icon: SapConcurIcon,
      title: 'SAP Concur expense classifier',
      prompt:
        'Build a scheduled workflow that polls SAP Concur for newly submitted expense reports, classifies each line item, validates against policy, and routes exceptions to the approver in Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SapConcurIcon,
      title: 'SAP Concur policy auditor',
      prompt:
        'Create a scheduled monthly workflow that audits SAP Concur expense reports against policy, flags pattern violations by employee, and writes a compliance report.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'enterprise'],
    },
    {
      icon: SapConcurIcon,
      title: 'SAP Concur travel pre-approval',
      prompt:
        'Build a scheduled workflow that polls SAP Concur for pending travel requests, routes each to the right approver based on amount and destination, captures the decision over Microsoft Teams, and moves the request to the approved or sent-back state.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'enterprise'],
      alsoIntegrations: ['microsoft_teams'],
    },
    {
      icon: SapConcurIcon,
      title: 'SAP Concur receipt OCR',
      prompt:
        'Create a workflow that processes SAP Concur receipt images with AWS Textract, validates the extracted vendor and amount against the report line, and flags mismatches.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['textract'],
    },
    {
      icon: SapConcurIcon,
      title: 'SAP Concur reimbursement chaser',
      prompt:
        'Build a scheduled workflow that finds SAP Concur reports stuck pending more than 7 days, sends the approver a reminder, and writes the chase log to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
    },
    {
      icon: SapConcurIcon,
      title: 'SAP Concur travel reconciler',
      prompt:
        'Create a workflow that reconciles SAP Concur travel bookings with corporate card transactions, flags missing receipts, and writes a reconciliation table for finance.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'enterprise'],
    },
    {
      icon: SapConcurIcon,
      title: 'SAP Concur budget watcher',
      prompt:
        'Build a scheduled monthly workflow that aggregates SAP Concur spend per department, compares against budget, and pings managers in Teams when overspend is projected.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
      alsoIntegrations: ['microsoft_teams'],
    },
  ],
  skills: [
    {
      name: 'review-expense-reports',
      description:
        'List submitted SAP Concur expense reports, inspect line items, and flag policy exceptions.',
      content:
        '# Review Expense Reports\n\nSurface expense reports that need attention and check them against policy.\n\n## Steps\n1. Run List Expense Reports to pull recently submitted reports, or List Reports To Approve for items awaiting the current approver.\n2. For each report of interest, run Get Expense Report and List Expenses to read the individual line items, then List Exceptions to see Concur policy flags.\n3. Summarize totals, flagged line items, and any missing receipts.\n\n## Output\nReturn a per-report summary with the report ID, owner, total amount, and a list of policy exceptions or anomalies that warrant follow-up.',
    },
    {
      name: 'route-report-approval',
      description: 'Approve or send back a submitted SAP Concur expense report after review.',
      content:
        '# Route Report Approval\n\nAct on an expense report once a review decision is made.\n\n## Steps\n1. Confirm the report ID and the decision.\n2. To approve, run Approve Expense Report. To return it for correction, run Send Back Expense Report with a clear comment explaining what must change.\n3. Optionally run Create Report Comment first to leave context for the submitter.\n\n## Output\nConfirm the report ID, the action taken (approved or sent back), and the comment provided so the decision is auditable.',
    },
    {
      name: 'capture-quick-expense',
      description:
        'Create a quick expense in SAP Concur from a receipt, attaching the receipt image.',
      content:
        '# Capture Quick Expense\n\nLog an out-of-pocket expense quickly, with the receipt attached.\n\n## Steps\n1. If you have a receipt image, run Upload Receipt Image and keep the returned receipt ID, or use Create Quick Expense (With Image) to do both in one step.\n2. Run Create Quick Expense with the vendor, amount, currency, and transaction date.\n3. Verify the entry with Get Expense.\n\n## Output\nReport the created quick expense ID, the captured vendor and amount, and confirm the receipt image is attached.',
    },
    {
      name: 'manage-travel-requests',
      description:
        'List and act on SAP Concur travel requests, moving them through the approval workflow.',
      content:
        '# Manage Travel Requests\n\nHandle pre-trip travel requests through their approval lifecycle.\n\n## Steps\n1. Run List Travel Requests to find pending requests, then Get Travel Request for full detail on a specific one.\n2. Review the expected expenses and any linked cash advance via Get Request Cash Advance.\n3. Run Move Travel Request (Workflow Action) to advance, approve, or send back the request based on the decision.\n\n## Output\nReturn the travel request ID, destination, estimated cost, and the workflow action applied so the trip approval state is clear.',
    },
  ],
} as const satisfies BlockMeta
