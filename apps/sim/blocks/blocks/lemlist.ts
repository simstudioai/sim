import { LemlistIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { LemlistResponse } from '@/tools/lemlist/types'
import { getTrigger } from '@/triggers'

export const LemlistBlock: BlockConfig<LemlistResponse> = {
  type: 'lemlist',
  name: 'Lemlist',
  description: 'Manage outreach activities, leads, and send emails via Lemlist',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Lemlist into your workflow. Retrieve campaign activities and replies, get lead information, and send emails through the Lemlist inbox.',
  docsLink: 'https://docs.sim.ai/tools/lemlist',
  category: 'tools',
  bgColor: '#316BFF',
  icon: LemlistIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Activities', id: 'get_activities' },
        { label: 'Get Lead', id: 'get_lead' },
        { label: 'Send Email', id: 'send_email' },
      ],
      value: () => 'get_activities',
    },
    {
      id: 'type',
      title: 'Activity Type',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Email Opened', id: 'emailOpened' },
        { label: 'Email Clicked', id: 'emailClicked' },
        { label: 'Email Replied', id: 'emailReplied' },
        { label: 'Email Sent', id: 'emailsSent' },
        { label: 'Email Bounced', id: 'emailsBounced' },
        { label: 'Paused', id: 'paused' },
        { label: 'Interested', id: 'interested' },
        { label: 'Not Interested', id: 'notInterested' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'get_activities' },
    },
    {
      id: 'campaignId',
      title: 'Campaign ID',
      type: 'short-input',
      placeholder: 'Filter by campaign ID (optional)',
      condition: { field: 'operation', value: 'get_activities' },
    },
    {
      id: 'filterLeadId',
      title: 'Lead ID',
      type: 'short-input',
      placeholder: 'Filter by lead ID (optional)',
      condition: { field: 'operation', value: 'get_activities' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '100 (max)',
      condition: { field: 'operation', value: 'get_activities' },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'get_activities' },
    },
    {
      id: 'email',
      title: 'Email Address',
      type: 'short-input',
      placeholder: 'Enter lead email address',
      condition: { field: 'operation', value: 'get_lead' },
      mode: 'basic',
      canonicalParamId: 'leadIdentifier',
    },
    {
      id: 'leadIdLookup',
      title: 'Lead ID',
      type: 'short-input',
      placeholder: 'Enter lead ID',
      condition: { field: 'operation', value: 'get_lead' },
      mode: 'advanced',
      canonicalParamId: 'leadIdentifier',
    },
    {
      id: 'sendUserId',
      title: 'Sender User ID',
      type: 'short-input',
      placeholder: 'Your Lemlist user ID',
      required: { field: 'operation', value: 'send_email' },
      condition: { field: 'operation', value: 'send_email' },
    },
    {
      id: 'sendUserEmail',
      title: 'Sender Email',
      type: 'short-input',
      placeholder: 'Your email address',
      required: { field: 'operation', value: 'send_email' },
      condition: { field: 'operation', value: 'send_email' },
    },
    {
      id: 'sendUserMailboxId',
      title: 'Mailbox ID',
      type: 'short-input',
      placeholder: 'Your mailbox ID',
      required: { field: 'operation', value: 'send_email' },
      condition: { field: 'operation', value: 'send_email' },
    },
    {
      id: 'contactId',
      title: 'Contact ID',
      type: 'short-input',
      placeholder: 'Recipient contact ID',
      required: { field: 'operation', value: 'send_email' },
      condition: { field: 'operation', value: 'send_email' },
    },
    {
      id: 'leadId',
      title: 'Lead ID',
      type: 'short-input',
      placeholder: 'Associated lead ID',
      required: { field: 'operation', value: 'send_email' },
      condition: { field: 'operation', value: 'send_email' },
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Email subject',
      required: { field: 'operation', value: 'send_email' },
      condition: { field: 'operation', value: 'send_email' },
    },
    {
      id: 'message',
      title: 'Message',
      type: 'long-input',
      placeholder: 'Email message body (HTML supported)',
      required: { field: 'operation', value: 'send_email' },
      condition: { field: 'operation', value: 'send_email' },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Lemlist API key',
      password: true,
    },
    // Trigger subBlocks - first trigger has dropdown, others don't
    ...getTrigger('lemlist_email_replied').subBlocks,
    ...getTrigger('lemlist_linkedin_replied').subBlocks,
    ...getTrigger('lemlist_interested').subBlocks,
    ...getTrigger('lemlist_not_interested').subBlocks,
    ...getTrigger('lemlist_email_opened').subBlocks,
    ...getTrigger('lemlist_email_clicked').subBlocks,
    ...getTrigger('lemlist_email_bounced').subBlocks,
    ...getTrigger('lemlist_email_sent').subBlocks,
    ...getTrigger('lemlist_webhook').subBlocks,
  ],
  tools: {
    access: ['lemlist_get_activities', 'lemlist_get_lead', 'lemlist_send_email'],
    config: {
      tool: (params) => {
        if (params.limit) {
          params.limit = Number(params.limit)
        }
        if (params.offset) {
          params.offset = Number(params.offset)
        }
        // Map filterLeadId to leadId for get_activities tool
        if (params.filterLeadId) {
          params.leadId = params.filterLeadId
        }

        switch (params.operation) {
          case 'get_activities':
            return 'lemlist_get_activities'
          case 'get_lead':
            return 'lemlist_get_lead'
          case 'send_email':
            return 'lemlist_send_email'
          default:
            return 'lemlist_get_activities'
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Lemlist API key' },
    type: { type: 'string', description: 'Activity type filter' },
    campaignId: { type: 'string', description: 'Campaign ID filter' },
    filterLeadId: { type: 'string', description: 'Lead ID filter for activities' },
    leadId: { type: 'string', description: 'Lead ID for send email' },
    limit: { type: 'number', description: 'Result limit' },
    offset: { type: 'number', description: 'Result offset' },
    leadIdentifier: { type: 'string', description: 'Lead email address or ID' },
    sendUserId: { type: 'string', description: 'Sender user ID' },
    sendUserEmail: { type: 'string', description: 'Sender email address' },
    sendUserMailboxId: { type: 'string', description: 'Sender mailbox ID' },
    contactId: { type: 'string', description: 'Recipient contact ID' },
    subject: { type: 'string', description: 'Email subject' },
    message: { type: 'string', description: 'Email message body' },
  },
  outputs: {
    activities: { type: 'json', description: 'List of campaign activities' },
    count: { type: 'number', description: 'Number of activities returned' },
    _id: { type: 'string', description: 'Lead ID' },
    email: { type: 'string', description: 'Lead email' },
    firstName: { type: 'string', description: 'Lead first name' },
    lastName: { type: 'string', description: 'Lead last name' },
    companyName: { type: 'string', description: 'Company name' },
    jobTitle: { type: 'string', description: 'Job title' },
    isPaused: { type: 'boolean', description: 'Whether lead is paused' },
    emailStatus: { type: 'string', description: 'Email deliverability status' },
    ok: { type: 'boolean', description: 'Whether email was sent successfully' },
  },
  triggers: {
    enabled: true,
    available: [
      'lemlist_email_replied',
      'lemlist_linkedin_replied',
      'lemlist_interested',
      'lemlist_not_interested',
      'lemlist_email_opened',
      'lemlist_email_clicked',
      'lemlist_email_bounced',
      'lemlist_email_sent',
      'lemlist_webhook',
    ],
  },
}
