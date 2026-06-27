import { PersonaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const PersonaBlockDisplay = {
  type: 'persona',
  name: 'Persona',
  description: 'Verify identities with Persona',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: PersonaIcon,
  longDescription:
    'Integrate Persona identity verification into the workflow. Manage the full inquiry lifecycle (create, update, approve, decline, review, resume, expire, redact), generate one-time verification links and PDF summaries, manage accounts including CSV bulk import, run watchlist and adverse media reports, review cases, retrieve verifications and documents, and discover inquiry templates.',
  docsLink: 'https://docs.sim.ai/integrations/persona',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay

export const PersonaBlockMeta = {
  tags: ['identity'],
  url: 'https://withpersona.com',
  templates: [
    {
      icon: PersonaIcon,
      title: 'Customer onboarding identity verification',
      prompt:
        'Build a workflow triggered when a new customer signs up that creates a Persona inquiry from our KYC template with their name and email pre-filled, generates a one-time verification link, and emails it to the customer.',
      modules: ['workflows', 'agent'],
      category: 'operations',
      tags: ['onboarding', 'compliance'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: PersonaIcon,
      title: 'Verification decision router',
      prompt:
        'Build a workflow that takes an inquiry ID, fetches the inquiry from Persona, and routes on its status: approved customers get a welcome email, needs-review inquiries post to a compliance Slack channel with a summary, and declined inquiries update our CRM.',
      modules: ['workflows', 'agent'],
      category: 'operations',
      tags: ['compliance', 'automation'],
      alsoIntegrations: ['slack', 'gmail'],
    },
    {
      icon: PersonaIcon,
      title: 'Daily pending-review digest',
      prompt:
        'Build a scheduled workflow that runs every morning, lists Persona inquiries with needs_review status from the last 24 hours, summarizes each one, and posts a digest to the compliance team in Slack.',
      modules: ['scheduled', 'workflows', 'agent'],
      category: 'operations',
      tags: ['compliance', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PersonaIcon,
      title: 'Watchlist screening on signup',
      prompt:
        "Build a workflow that takes a new user's name and birthdate, runs a Persona watchlist report against them, polls until the report is ready, and creates a case in our tracking table if the report has a match.",
      modules: ['workflows', 'tables', 'agent'],
      category: 'operations',
      tags: ['compliance', 'screening'],
    },
    {
      icon: PersonaIcon,
      title: 'Bulk account import from CRM export',
      prompt:
        'Build a workflow that takes an uploaded CSV export of customers, imports them into Persona as accounts using the account importer, polls the importer status, and reports how many rows succeeded, errored, or were duplicates.',
      modules: ['files', 'workflows', 'agent'],
      category: 'operations',
      tags: ['migration', 'automation'],
    },
    {
      icon: PersonaIcon,
      title: 'Compliance audit PDF archive',
      prompt:
        'Build a workflow that takes an approved inquiry ID, downloads the inquiry summary PDF from Persona, and uploads it to a compliance archive folder in Google Drive named by customer reference ID.',
      modules: ['workflows', 'files', 'agent'],
      category: 'operations',
      tags: ['compliance', 'audit'],
      alsoIntegrations: ['google_drive'],
    },
    {
      icon: PersonaIcon,
      title: 'Manual review case triage agent',
      prompt:
        'Build an agent that lists open Persona cases, fetches the linked inquiry and verification details for each, drafts a recommended approve/decline decision with reasoning, and posts the triage summary to Slack for a human reviewer.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['compliance', 'triage'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PersonaIcon,
      title: 'Re-verification campaign for stale accounts',
      prompt:
        'Build a scheduled workflow that lists Persona accounts, finds ones whose latest approved inquiry is older than a year, creates a new inquiry for each from our re-verification template, and emails customers a one-time verification link.',
      modules: ['scheduled', 'workflows', 'agent'],
      category: 'operations',
      tags: ['compliance', 'lifecycle'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'verify-customer-identity',
      description:
        'Create a Persona inquiry for a customer and send them a one-time verification link.',
      content:
        '# Verify Customer Identity\n\nStart an identity verification for a customer using Persona.\n\n## Steps\n1. Use the Create Inquiry operation with your inquiry template ID. Pass the customer reference ID so the inquiry links to an account in your user model, and pre-fill known fields (e.g. {"name-first": "Jane", "name-last": "Doe"}).\n2. Use the Generate Inquiry Link operation with the new inquiry ID to mint a one-time verification link. Set a custom expiry only if the default (24 hours) does not fit.\n3. Deliver the one-time link to the customer (email, SMS, or chat).\n\n## Output\nReturn the inquiry ID, its status, and the one-time link. Note when the link expires so follow-ups can be scheduled.',
    },
    {
      name: 'check-verification-status',
      description:
        'Look up a Persona inquiry and report whether the individual passed, failed, or needs review.',
      content:
        '# Check Verification Status\n\nRead the current state of an identity verification from Persona.\n\n## Steps\n1. Use the Get Inquiry operation with the inquiry ID (or List Inquiries filtered by reference ID to find it).\n2. Read the status: approved or completed means verified; needs_review means a human should look; failed, expired, or declined means not verified.\n3. For deeper detail, use Get Verification with a verification ID to inspect the individual checks that ran.\n\n## Output\nReturn the status, decision timestamps, and collected fields. Recommend the next action (proceed, route to review, or re-verify).',
    },
    {
      name: 'screen-against-watchlists',
      description:
        'Run a Persona watchlist, adverse media, or PEP report on a person and surface matches.',
      content:
        '# Screen Against Watchlists\n\nScreen an individual for sanctions, adverse media, or political exposure using Persona reports.\n\n## Steps\n1. Use the Create Report operation with the report type (watchlist, adverse-media, or politically-exposed-person) and your report template ID. Provide the name parts or a full-name term, plus birthdate and country code when known to reduce false positives.\n2. Reports run asynchronously: poll Get Report with the report ID until the status is ready.\n3. Check hasMatch and the report attributes for matched lists and match details.\n\n## Output\nReturn whether the screening found matches, the matched lists, and the report ID for the audit trail.',
    },
    {
      name: 'triage-pending-reviews',
      description:
        'List Persona inquiries awaiting manual review and approve or decline them after assessment.',
      content:
        '# Triage Pending Reviews\n\nWork through identity verifications that need a manual decision in Persona.\n\n## Steps\n1. Use the List Inquiries operation with status needs_review (optionally bounded by created-after/created-before).\n2. For each inquiry, use Get Inquiry for collected fields and List Cases / Get Case to see any linked review case.\n3. After assessment, use Approve Inquiry or Decline Inquiry. Both are final: they prevent further progress and trigger associated workflows and webhooks.\n\n## Output\nReturn a summary of inquiries reviewed and the decision taken for each, with inquiry IDs for the audit trail.',
    },
    {
      name: 'import-accounts-from-csv',
      description: 'Bulk-import existing users into Persona as accounts from a CSV file.',
      content:
        '# Import Accounts from CSV\n\nMigrate an existing user base into Persona using the account importer.\n\n## Steps\n1. Prepare a CSV of users (one row per account, with reference IDs and account fields).\n2. Use the Import Accounts (CSV) operation with the file.\n3. The importer runs asynchronously and returns pending at first; report the importer ID and counts once available.\n\n## Output\nReturn the importer ID, status, and the successful, errored, and duplicate row counts.',
    },
    {
      name: 'archive-verification-pdf',
      description: 'Download the PDF summary of a Persona inquiry for compliance record-keeping.',
      content:
        '# Archive Verification PDF\n\nKeep a permanent record of an identity verification decision.\n\n## Steps\n1. Use the Print Inquiry PDF operation with the inquiry ID.\n2. The PDF lands in execution files; pass it to a storage integration (Google Drive, S3, SharePoint) named by customer reference ID and date.\n\n## Output\nReturn the stored file and where it was archived.',
    },
  ],
} as const satisfies BlockMeta
