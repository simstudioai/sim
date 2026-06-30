import { DocuSignIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { DocuSignResponse } from '@/tools/docusign/types'

export const DocuSignBlock: BlockConfig<DocuSignResponse> = {
  type: 'docusign',
  name: 'DocuSign',
  description: 'Send documents for e-signature via DocuSign',
  longDescription:
    'Create and send envelopes for e-signature, use templates, check signing status, download signed documents, and manage recipients with DocuSign.',
  docsLink: 'https://docs.sim.ai/integrations/docusign',
  category: 'tools',
  integrationType: IntegrationType.Documents,
  bgColor: '#FFFFFF',
  icon: DocuSignIcon,
  authMode: AuthMode.OAuth,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Send Envelope', id: 'send_envelope' },
        { label: 'Send from Template', id: 'create_from_template' },
        { label: 'Get Envelope', id: 'get_envelope' },
        { label: 'List Envelopes', id: 'list_envelopes' },
        { label: 'Void Envelope', id: 'void_envelope' },
        { label: 'Download Document', id: 'download_document' },
        { label: 'List Templates', id: 'list_templates' },
        { label: 'List Recipients', id: 'list_recipients' },
      ],
      value: () => 'send_envelope',
    },
    {
      id: 'credential',
      title: 'DocuSign Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'docusign',
      requiredScopes: getScopesForService('docusign'),
      placeholder: 'Select DocuSign account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'DocuSign Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },

    // Send Envelope fields
    {
      id: 'emailSubject',
      title: 'Email Subject',
      type: 'short-input',
      placeholder: 'Please sign this document',
      condition: { field: 'operation', value: ['send_envelope', 'create_from_template'] },
      required: { field: 'operation', value: 'send_envelope' },
    },
    {
      id: 'emailBody',
      title: 'Email Body',
      type: 'long-input',
      placeholder: 'Optional message to include in the email',
      condition: { field: 'operation', value: ['send_envelope', 'create_from_template'] },
      mode: 'advanced',
    },
    {
      id: 'signerEmail',
      title: 'Signer Email',
      type: 'short-input',
      placeholder: 'signer@example.com',
      condition: { field: 'operation', value: 'send_envelope' },
      required: { field: 'operation', value: 'send_envelope' },
    },
    {
      id: 'signerName',
      title: 'Signer Name',
      type: 'short-input',
      placeholder: 'John Doe',
      condition: { field: 'operation', value: 'send_envelope' },
      required: { field: 'operation', value: 'send_envelope' },
    },
    {
      id: 'uploadDocument',
      title: 'Document',
      type: 'file-upload',
      canonicalParamId: 'documentFile',
      placeholder: 'Upload document for signature',
      mode: 'basic',
      multiple: false,
      condition: { field: 'operation', value: 'send_envelope' },
    },
    {
      id: 'documentRef',
      title: 'Document',
      type: 'short-input',
      canonicalParamId: 'documentFile',
      placeholder: 'Reference file from another block',
      mode: 'advanced',
      condition: { field: 'operation', value: 'send_envelope' },
    },
    {
      id: 'ccEmail',
      title: 'CC Email',
      type: 'short-input',
      placeholder: 'cc@example.com',
      condition: { field: 'operation', value: 'send_envelope' },
      mode: 'advanced',
    },
    {
      id: 'ccName',
      title: 'CC Name',
      type: 'short-input',
      placeholder: 'CC recipient name',
      condition: { field: 'operation', value: 'send_envelope' },
      mode: 'advanced',
    },
    {
      id: 'envelopeStatus',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Send Immediately', id: 'sent' },
        { label: 'Save as Draft', id: 'created' },
      ],
      value: () => 'sent',
      condition: { field: 'operation', value: ['send_envelope', 'create_from_template'] },
      mode: 'advanced',
    },

    // Send from Template fields
    {
      id: 'templateId',
      title: 'Template ID',
      type: 'short-input',
      placeholder: 'DocuSign template ID',
      condition: { field: 'operation', value: 'create_from_template' },
      required: { field: 'operation', value: 'create_from_template' },
    },
    {
      id: 'templateRoles',
      title: 'Template Roles',
      type: 'long-input',
      placeholder: '[{"roleName":"Signer","name":"John Doe","email":"john@example.com"}]',
      condition: { field: 'operation', value: 'create_from_template' },
      required: { field: 'operation', value: 'create_from_template' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of DocuSign template role objects. Each role needs: roleName (must match the template role name), name (full name), email (email address). Return ONLY the JSON array.',
        generationType: 'json-object',
      },
    },

    // Envelope ID field (shared across multiple operations)
    {
      id: 'envelopeId',
      title: 'Envelope ID',
      type: 'short-input',
      placeholder: 'DocuSign envelope ID',
      condition: {
        field: 'operation',
        value: ['get_envelope', 'void_envelope', 'download_document', 'list_recipients'],
      },
      required: {
        field: 'operation',
        value: ['get_envelope', 'void_envelope', 'download_document', 'list_recipients'],
      },
    },

    // Void Envelope fields
    {
      id: 'voidedReason',
      title: 'Void Reason',
      type: 'short-input',
      placeholder: 'Reason for voiding this envelope',
      condition: { field: 'operation', value: 'void_envelope' },
      required: { field: 'operation', value: 'void_envelope' },
    },

    // Download Document fields
    {
      id: 'documentId',
      title: 'Document ID',
      type: 'short-input',
      placeholder: '"combined" for all docs, or specific document ID',
      condition: { field: 'operation', value: 'download_document' },
      mode: 'advanced',
    },

    // List Envelopes filters
    {
      id: 'fromDate',
      title: 'From Date',
      type: 'short-input',
      placeholder: 'ISO 8601 date (defaults to 30 days ago)',
      condition: { field: 'operation', value: 'list_envelopes' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: 'Generate an ISO 8601 timestamp. Return ONLY the timestamp string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'toDate',
      title: 'To Date',
      type: 'short-input',
      placeholder: 'ISO 8601 date',
      condition: { field: 'operation', value: 'list_envelopes' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: 'Generate an ISO 8601 timestamp. Return ONLY the timestamp string.',
        generationType: 'timestamp',
      },
    },
    {
      id: 'listEnvelopeStatus',
      title: 'Status Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Created', id: 'created' },
        { label: 'Sent', id: 'sent' },
        { label: 'Delivered', id: 'delivered' },
        { label: 'Completed', id: 'completed' },
        { label: 'Declined', id: 'declined' },
        { label: 'Voided', id: 'voided' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_envelopes' },
      mode: 'advanced',
    },
    {
      id: 'searchText',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search envelopes or templates',
      condition: { field: 'operation', value: ['list_envelopes', 'list_templates'] },
      mode: 'advanced',
    },
    {
      id: 'count',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: ['list_envelopes', 'list_templates'] },
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'docusign_send_envelope',
      'docusign_create_from_template',
      'docusign_get_envelope',
      'docusign_list_envelopes',
      'docusign_void_envelope',
      'docusign_download_document',
      'docusign_list_templates',
      'docusign_list_recipients',
    ],
    config: {
      tool: (params) => `docusign_${params.operation}`,
      params: (params) => {
        const { oauthCredential, operation, documentFile, listEnvelopeStatus, ...rest } = params

        const cleanParams: Record<string, unknown> = {
          oauthCredential,
        }

        const file = normalizeFileInput(documentFile, { single: true })
        if (file) {
          cleanParams.file = file
        }

        if (listEnvelopeStatus && operation === 'list_envelopes') {
          cleanParams.envelopeStatus = listEnvelopeStatus
        }

        if (operation === 'create_from_template') {
          cleanParams.status = rest.envelopeStatus
        } else if (operation === 'send_envelope') {
          cleanParams.status = rest.envelopeStatus
        }

        const excludeKeys = ['envelopeStatus']
        for (const [key, value] of Object.entries(rest)) {
          if (value !== undefined && value !== null && value !== '' && !excludeKeys.includes(key)) {
            cleanParams[key] = value
          }
        }

        return cleanParams
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'DocuSign access token' },
    emailSubject: { type: 'string', description: 'Email subject for the envelope' },
    emailBody: { type: 'string', description: 'Email body message' },
    signerEmail: { type: 'string', description: 'Signer email address' },
    signerName: { type: 'string', description: 'Signer full name' },
    documentFile: { type: 'string', description: 'Document file for signature' },
    ccEmail: { type: 'string', description: 'CC recipient email' },
    ccName: { type: 'string', description: 'CC recipient name' },
    templateId: { type: 'string', description: 'DocuSign template ID' },
    templateRoles: { type: 'string', description: 'JSON array of template roles' },
    envelopeId: { type: 'string', description: 'Envelope ID' },
    voidedReason: { type: 'string', description: 'Reason for voiding' },
    documentId: { type: 'string', description: 'Document ID to download' },
    fromDate: { type: 'string', description: 'Start date filter' },
    toDate: { type: 'string', description: 'End date filter' },
    searchText: { type: 'string', description: 'Search text filter' },
    count: { type: 'string', description: 'Max results to return' },
  },
  outputs: {
    envelopeId: { type: 'string', description: 'Envelope ID' },
    status: {
      type: 'string',
      description: 'Envelope status (created, sent, delivered, completed, declined, voided)',
    },
    statusDateTime: { type: 'string', description: 'ISO 8601 datetime of status change' },
    uri: { type: 'string', description: 'Envelope URI path' },
    emailSubject: { type: 'string', description: 'Envelope email subject' },
    sentDateTime: { type: 'string', description: 'ISO 8601 datetime when envelope was sent' },
    completedDateTime: { type: 'string', description: 'ISO 8601 datetime when signing completed' },
    createdDateTime: { type: 'string', description: 'ISO 8601 datetime when envelope was created' },
    statusChangedDateTime: {
      type: 'string',
      description: 'ISO 8601 datetime of last status change',
    },
    voidedReason: { type: 'string', description: 'Reason the envelope was voided' },
    signerCount: { type: 'number', description: 'Number of signers on the envelope' },
    documentCount: { type: 'number', description: 'Number of documents in the envelope' },
    envelopes: {
      type: 'json',
      description:
        'Array of envelopes (envelopeId, status, emailSubject, sentDateTime, completedDateTime, createdDateTime, statusChangedDateTime)',
    },
    templates: {
      type: 'json',
      description:
        'Array of templates (templateId, name, description, shared, created, lastModified)',
    },
    signers: {
      type: 'json',
      description:
        'Array of signer recipients (recipientId, name, email, status, signedDateTime, deliveredDateTime)',
    },
    carbonCopies: {
      type: 'json',
      description: 'Array of CC recipients (recipientId, name, email, status)',
    },
    file: { type: 'file', description: 'Stored downloaded document file' },
    base64Content: { type: 'string', description: 'Base64-encoded document content' },
    mimeType: { type: 'string', description: 'Document MIME type' },
    fileName: { type: 'string', description: 'Document file name' },
    totalSetSize: { type: 'number', description: 'Total matching results' },
    resultSetSize: { type: 'number', description: 'Results returned in this response' },
  },
}

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
