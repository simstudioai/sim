import { DocuSignIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const DocuSignBlockDisplay = {
  type: 'docusign',
  name: 'DocuSign',
  description: 'Send documents for e-signature via DocuSign',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: DocuSignIcon,
  longDescription:
    'Create and send envelopes for e-signature, use templates, check signing status, download signed documents, and manage recipients with DocuSign.',
  docsLink: 'https://docs.sim.ai/integrations/docusign',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay

export const DocuSignBlockMeta = {
  tags: ['e-signatures', 'document-processing'],
  url: 'https://www.docusign.com',
  templates: [
    {
      icon: DocuSignIcon,
      title: 'DocuSign envelope sender',
      prompt:
        'Build a workflow that takes a deal from Salesforce above a threshold, pre-fills a DocuSign envelope from a template, sends it, and writes the envelope ID back to the opportunity.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: DocuSignIcon,
      title: 'DocuSign chase reminder',
      prompt:
        'Create a scheduled workflow that lists DocuSign envelopes pending signature for over 48 hours, notifies the owning rep in Slack to nudge each signer, and escalates with a flagged message after 7 days.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DocuSignIcon,
      title: 'DocuSign completed contract archiver',
      prompt:
        'Build a scheduled workflow that polls DocuSign for completed envelopes, downloads the signed PDF, saves it to a Google Drive contracts folder, and writes the metadata into a contracts table.',
      modules: ['scheduled', 'files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'sync'],
      alsoIntegrations: ['google_drive'],
    },
    {
      icon: DocuSignIcon,
      title: 'DocuSign clause analyzer',
      prompt:
        'Create a workflow that processes signed DocuSign contracts, extracts payment terms, liability caps, and renewal dates, writes them to a table, and flags non-standard clauses for legal review.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'analysis'],
    },
    {
      icon: DocuSignIcon,
      title: 'DocuSign renewal tracker',
      prompt:
        'Build a scheduled workflow that reads a DocuSign contracts table, finds renewals due in the next 60 days, and creates a renewal-prep task in Salesforce for each.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: DocuSignIcon,
      title: 'DocuSign stalled envelope resolver',
      prompt:
        'Create a scheduled workflow that lists in-flight DocuSign envelopes, checks each envelope’s recipients for signers who have left the company, voids the affected envelopes, and posts the list to Slack so a rep can resend from the right template.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DocuSignIcon,
      title: 'DocuSign signature analytics digest',
      prompt:
        'Build a scheduled weekly workflow that pulls DocuSign envelope analytics — time-to-sign, completion rate, drop-off — and posts a digest to the sales ops Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'reporting'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'send-contract-for-signature',
      description:
        'Send a document to one or more signers for e-signature, using a DocuSign template or an uploaded file.',
      content:
        '# Send Contract for Signature\n\nSend a document out for e-signature through DocuSign and confirm it was delivered.\n\n## Steps\n1. Determine whether to send from a template (preferred for standard agreements) or from an uploaded document. If a template is named, use List Templates to resolve its ID.\n2. For a template, call Send from Template with the template ID and a template-roles JSON array mapping each role name to a signer name and email. For an ad-hoc document, call Send Envelope with the email subject, signer name, signer email, and the document file.\n3. Add any CC recipients and set the email subject to something the signer will recognize.\n4. Send immediately unless asked to save as a draft.\n\n## Output\nReport the envelope ID and status. List each signer and CC recipient with their email so the requester can confirm the right people were addressed.',
    },
    {
      name: 'track-pending-envelopes',
      description:
        'List envelopes awaiting signature, identify ones stalled past a threshold, and surface who still needs to sign.',
      content:
        '# Track Pending Envelopes\n\nFind DocuSign envelopes that are sent but not yet completed so stalled signatures can be chased.\n\n## Steps\n1. Call List Envelopes filtered to sent and delivered status over a recent date window.\n2. For each envelope, use List Recipients to see which signers have signed and which are still outstanding.\n3. Compute how long each envelope has been waiting and flag any past the requested threshold (default 48 hours).\n\n## Output\nReturn a table of stalled envelopes: envelope ID, subject, days waiting, and the outstanding signer name and email. Sort by longest waiting first.',
    },
    {
      name: 'archive-completed-documents',
      description:
        'Find completed envelopes, download the signed PDFs, and extract key metadata for archiving.',
      content:
        '# Archive Completed Documents\n\nCollect signed documents once an envelope is complete and capture their metadata.\n\n## Steps\n1. Call List Envelopes filtered to completed status over the requested date window.\n2. For each completed envelope, call Download Document with "combined" to get the full signed PDF.\n3. Record the envelope ID, subject, completed date, and signer list for each document.\n\n## Output\nReturn each completed envelope with its downloaded file, signers, and completed date. Note any envelope where the download failed so it can be retried.',
    },
    {
      name: 'void-stale-envelope',
      description: 'Void an envelope that should no longer be signed and record the reason.',
      content:
        '# Void Stale Envelope\n\nCancel a DocuSign envelope that is no longer valid — wrong recipient, superseded terms, or expired offer.\n\n## Steps\n1. Confirm the envelope ID. If only a subject or signer is known, use List Envelopes to resolve it, and verify it is not already completed.\n2. Call Get Envelope to confirm the current status is still voidable (created, sent, or delivered).\n3. Call Void Envelope with a clear void reason describing why it is being cancelled.\n\n## Output\nConfirm the envelope ID, its new voided status, and the recorded reason. If the envelope was already completed or voided, report that instead of attempting to void it.',
    },
  ],
} as const satisfies BlockMeta
