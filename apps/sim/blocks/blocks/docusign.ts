import { DocuSignIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { DocuSignResponse } from '@/tools/docusign/types'

export const DocuSignBlock: BlockConfig<DocuSignResponse> = {
  type: 'docusign',
  name: 'DocuSign',
  description: 'Send documents for e-signature via DocuSign',
  longDescription:
    'Create and send envelopes for e-signature, use templates, check signing status, download signed documents, and manage recipients with DocuSign.',
  docsLink: 'https://docs.sim.ai/tools/docusign',
  category: 'tools',
  integrationType: IntegrationType.Documents,
  tags: ['e-signatures', 'document-processing'],
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
    base64Content: { type: 'string', description: 'Base64-encoded document content' },
    mimeType: { type: 'string', description: 'Document MIME type' },
    fileName: { type: 'string', description: 'Document file name' },
    totalSetSize: { type: 'number', description: 'Total matching results' },
    resultSetSize: { type: 'number', description: 'Results returned in this response' },
  },
}
