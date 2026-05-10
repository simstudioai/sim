import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

export const EMAILBISON_TRIGGER_TO_EVENT_TYPE = {
  emailbison_email_sent: 'email_sent',
  emailbison_lead_first_contacted: 'lead_first_contacted',
  emailbison_lead_replied: 'lead_replied',
  emailbison_lead_interested: 'lead_interested',
  emailbison_lead_unsubscribed: 'lead_unsubscribed',
  emailbison_untracked_reply_received: 'untracked_reply_received',
  emailbison_email_opened: 'email_opened',
  emailbison_email_bounced: 'email_bounced',
  emailbison_email_account_added: 'email_account_added',
  emailbison_email_account_removed: 'email_account_removed',
  emailbison_email_account_disconnected: 'email_account_disconnected',
  emailbison_email_account_reconnected: 'email_account_reconnected',
  emailbison_manual_email_sent: 'manual_email_sent',
  emailbison_tag_attached: 'tag_attached',
  emailbison_tag_removed: 'tag_removed',
  emailbison_warmup_disabled_receiving_bounces: 'warmup_disabled_receiving_bounces',
  emailbison_warmup_disabled_causing_bounces: 'warmup_disabled_causing_bounces',
} as const

export const emailBisonTriggerOptions = [
  { label: 'Email Sent', id: 'emailbison_email_sent' },
  { label: 'Contact First Emailed', id: 'emailbison_lead_first_contacted' },
  { label: 'Contact Replied', id: 'emailbison_lead_replied' },
  { label: 'Contact Interested', id: 'emailbison_lead_interested' },
  { label: 'Contact Unsubscribed', id: 'emailbison_lead_unsubscribed' },
  { label: 'Untracked Reply Received', id: 'emailbison_untracked_reply_received' },
  { label: 'Email Opened', id: 'emailbison_email_opened' },
  { label: 'Email Bounced', id: 'emailbison_email_bounced' },
  { label: 'Email Account Added', id: 'emailbison_email_account_added' },
  { label: 'Email Account Removed', id: 'emailbison_email_account_removed' },
  { label: 'Email Account Disconnected', id: 'emailbison_email_account_disconnected' },
  { label: 'Email Account Reconnected', id: 'emailbison_email_account_reconnected' },
  { label: 'Manual Email Sent', id: 'emailbison_manual_email_sent' },
  { label: 'Tag Attached', id: 'emailbison_tag_attached' },
  { label: 'Tag Removed', id: 'emailbison_tag_removed' },
  {
    label: 'Warmup Disabled Receiving Bounces',
    id: 'emailbison_warmup_disabled_receiving_bounces',
  },
  {
    label: 'Warmup Disabled Causing Bounces',
    id: 'emailbison_warmup_disabled_causing_bounces',
  },
]

export function emailBisonSetupInstructions(eventType: string): string {
  const instructions = [
    'Create an Email Bison API token in <strong>Settings &gt; Developer API</strong>.',
    'Enter the <strong>Instance URL</strong> from Email Bison&rsquo;s webhook payload, Full API Reference, or exported Postman collection.',
    `Click <strong>Save Configuration</strong> to automatically create an Email Bison webhook for <strong>${eventType}</strong>.`,
    'The webhook will be automatically deleted from Email Bison when this trigger is removed.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

export function buildEmailBisonExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Email Bison API token',
      password: true,
      required: true,
      paramVisibility: 'user-only',
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'apiBaseUrl',
      title: 'Instance URL',
      type: 'short-input',
      placeholder: 'https://your-emailbison-workspace.com',
      required: true,
      paramVisibility: 'user-only',
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

export function buildEmailBisonOutputs(): Record<string, TriggerOutput> {
  return {
    eventType: { type: 'string', description: 'Email Bison webhook event type' },
    eventName: { type: 'string', description: 'Human-readable Email Bison event name' },
    instanceUrl: { type: 'string', description: 'Email Bison instance URL' },
    workspaceId: { type: 'number', description: 'Email Bison workspace ID' },
    workspaceName: { type: 'string', description: 'Email Bison workspace name' },
    event: { type: 'json', description: 'Raw Email Bison event metadata object' },
    data: { type: 'json', description: 'Raw Email Bison event data object' },
  }
}

export function buildEmailBisonEmailSentOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildEmailBisonOutputs(),
    scheduledEmail: {
      id: { type: 'number', description: 'Scheduled email ID' },
      lead_id: { type: 'number', description: 'Lead ID' },
      sequence_step_id: { type: 'number', description: 'Sequence step ID' },
      sequence_step_order: { type: 'number', description: 'Sequence step order' },
      sequence_step_variant: { type: 'number', description: 'Sequence step variant' },
      email_subject: { type: 'string', description: 'Email subject' },
      email_body: { type: 'string', description: 'Email body HTML' },
      status: { type: 'string', description: 'Scheduled email status' },
      scheduled_date_est: { type: 'string', description: 'Scheduled date in EST' },
      scheduled_date_local: { type: 'string', description: 'Scheduled date in local timezone' },
      local_timezone: { type: 'string', description: 'Scheduled email local timezone' },
      sent_at: { type: 'string', description: 'Email sent timestamp' },
      opens: { type: 'number', description: 'Open count' },
      replies: { type: 'number', description: 'Reply count' },
      unique_opens: { type: 'number', description: 'Unique open count' },
      unique_replies: { type: 'number', description: 'Unique reply count' },
      interested: { type: 'string', description: 'Interested status' },
      raw_message_id: { type: 'string', description: 'Raw email message ID' },
    },
    campaignEvent: {
      id: { type: 'number', description: 'Campaign event ID' },
      event_type: { type: 'string', description: 'Campaign event type' },
      created_at_local: { type: 'string', description: 'Campaign event local creation timestamp' },
      local_timezone: { type: 'string', description: 'Campaign event local timezone' },
      created_at: { type: 'string', description: 'Campaign event creation timestamp' },
    },
    lead: {
      id: { type: 'number', description: 'Lead ID' },
      email: { type: 'string', description: 'Lead email address' },
      first_name: { type: 'string', description: 'Lead first name' },
      last_name: { type: 'string', description: 'Lead last name' },
      status: { type: 'string', description: 'Lead status' },
      title: { type: 'string', description: 'Lead title' },
      company: { type: 'string', description: 'Lead company' },
      custom_variables: { type: 'json', description: 'Lead custom variables' },
      emails_sent: { type: 'number', description: 'Lead emails sent count' },
      opens: { type: 'number', description: 'Lead open count' },
      unique_opens: { type: 'number', description: 'Lead unique open count' },
      replies: { type: 'number', description: 'Lead reply count' },
      unique_replies: { type: 'number', description: 'Lead unique reply count' },
      bounces: { type: 'number', description: 'Lead bounce count' },
    },
    campaign: {
      id: { type: 'number', description: 'Campaign ID' },
      name: { type: 'string', description: 'Campaign name' },
    },
    senderEmail: {
      id: { type: 'number', description: 'Sender email ID' },
      name: { type: 'string', description: 'Sender email name' },
      email: { type: 'string', description: 'Sender email address' },
      status: { type: 'string', description: 'Sender email status' },
      account_type: { type: 'string', description: 'Sender email connection type' },
      daily_limit: { type: 'number', description: 'Sender email daily limit' },
      emails_sent: { type: 'number', description: 'Sender email sent count' },
      replied: { type: 'number', description: 'Sender email replied count' },
      opened: { type: 'number', description: 'Sender email opened count' },
      unsubscribed: { type: 'number', description: 'Sender email unsubscribed count' },
      bounced: { type: 'number', description: 'Sender email bounced count' },
      unique_replies: { type: 'number', description: 'Sender email unique reply count' },
      unique_opens: { type: 'number', description: 'Sender email unique open count' },
      total_leads_contacted: { type: 'number', description: 'Sender email total leads contacted' },
      interested: { type: 'number', description: 'Sender email interested count' },
      created_at: { type: 'string', description: 'Sender email creation timestamp' },
      updated_at: { type: 'string', description: 'Sender email update timestamp' },
    },
  }
}

export function buildEmailBisonLeadFirstContactedOutputs(): Record<string, TriggerOutput> {
  return buildEmailBisonEmailSentOutputs()
}

export function buildEmailBisonLeadUnsubscribedOutputs(): Record<string, TriggerOutput> {
  return buildEmailBisonEmailSentOutputs()
}

export function buildEmailBisonEmailOpenedOutputs(): Record<string, TriggerOutput> {
  return buildEmailBisonEmailSentOutputs()
}

export function buildEmailBisonLeadRepliedOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildEmailBisonOutputs(),
    reply: {
      id: { type: 'number', description: 'Reply ID' },
      uuid: { type: 'string', description: 'Reply UUID' },
      email_subject: { type: 'string', description: 'Reply email subject' },
      interested: { type: 'boolean', description: 'Whether the reply is marked interested' },
      automated_reply: { type: 'boolean', description: 'Whether the reply is automated' },
      html_body: { type: 'string', description: 'Reply HTML body' },
      text_body: { type: 'string', description: 'Reply plain text body' },
      raw_body: { type: 'string', description: 'Raw MIME reply body' },
      headers: { type: 'string', description: 'Encoded raw email headers' },
      date_received: { type: 'string', description: 'Reply received timestamp' },
      from_name: { type: 'string', description: 'Reply sender name' },
      from_email_address: { type: 'string', description: 'Reply sender email address' },
      primary_to_email_address: { type: 'string', description: 'Primary recipient email address' },
      to: { type: 'json', description: 'Reply To recipients' },
      cc: { type: 'json', description: 'Reply CC recipients' },
      bcc: { type: 'json', description: 'Reply BCC recipients' },
      parent_id: { type: 'number', description: 'Parent reply ID' },
      reply_type: { type: 'string', description: 'Reply type' },
      folder: { type: 'string', description: 'Reply folder' },
      raw_message_id: { type: 'string', description: 'Raw email message ID' },
      created_at: { type: 'string', description: 'Reply creation timestamp' },
      updated_at: { type: 'string', description: 'Reply update timestamp' },
      attachments: { type: 'json', description: 'Reply attachments' },
    },
    campaignEvent: {
      id: { type: 'number', description: 'Campaign event ID' },
      event_type: { type: 'string', description: 'Campaign event type' },
      created_at_local: { type: 'string', description: 'Campaign event local creation timestamp' },
      local_timezone: { type: 'string', description: 'Campaign event local timezone' },
      created_at: { type: 'string', description: 'Campaign event creation timestamp' },
    },
    lead: {
      id: { type: 'number', description: 'Lead ID' },
      email: { type: 'string', description: 'Lead email address' },
      first_name: { type: 'string', description: 'Lead first name' },
      last_name: { type: 'string', description: 'Lead last name' },
      status: { type: 'string', description: 'Lead status' },
      title: { type: 'string', description: 'Lead title' },
      company: { type: 'string', description: 'Lead company' },
      custom_variables: { type: 'json', description: 'Lead custom variables' },
      emails_sent: { type: 'number', description: 'Lead emails sent count' },
      opens: { type: 'number', description: 'Lead open count' },
      unique_opens: { type: 'number', description: 'Lead unique open count' },
      replies: { type: 'number', description: 'Lead reply count' },
      unique_replies: { type: 'number', description: 'Lead unique reply count' },
      bounces: { type: 'number', description: 'Lead bounce count' },
    },
    campaign: {
      id: { type: 'number', description: 'Campaign ID' },
      name: { type: 'string', description: 'Campaign name' },
    },
    scheduledEmail: {
      id: { type: 'number', description: 'Scheduled email ID' },
      sequence_step_id: { type: 'number', description: 'Sequence step ID' },
      sequence_step_order: { type: 'number', description: 'Sequence step order' },
      sequence_step_variant: { type: 'number', description: 'Sequence step variant' },
      status: { type: 'string', description: 'Scheduled email status' },
      scheduled_date_est: { type: 'string', description: 'Scheduled date in EST' },
      scheduled_date_local: { type: 'string', description: 'Scheduled date in local timezone' },
      local_timezone: { type: 'string', description: 'Scheduled email local timezone' },
      sent_at: { type: 'string', description: 'Email sent timestamp' },
      opens: { type: 'number', description: 'Open count' },
      replies: { type: 'number', description: 'Reply count' },
      unique_opens: { type: 'number', description: 'Unique open count' },
      unique_replies: { type: 'number', description: 'Unique reply count' },
      interested: { type: 'string', description: 'Interested status' },
      raw_message_id: { type: 'string', description: 'Raw email message ID' },
    },
    senderEmail: {
      id: { type: 'number', description: 'Sender email ID' },
      name: { type: 'string', description: 'Sender email name' },
      email: { type: 'string', description: 'Sender email address' },
      status: { type: 'string', description: 'Sender email status' },
      account_type: { type: 'string', description: 'Sender email connection type' },
      daily_limit: { type: 'number', description: 'Sender email daily limit' },
      emails_sent: { type: 'number', description: 'Sender email sent count' },
      replied: { type: 'number', description: 'Sender email replied count' },
      opened: { type: 'number', description: 'Sender email opened count' },
      unsubscribed: { type: 'number', description: 'Sender email unsubscribed count' },
      bounced: { type: 'number', description: 'Sender email bounced count' },
      unique_replies: { type: 'number', description: 'Sender email unique reply count' },
      unique_opens: { type: 'number', description: 'Sender email unique open count' },
      total_leads_contacted: { type: 'number', description: 'Sender email total leads contacted' },
      interested: { type: 'number', description: 'Sender email interested count' },
      created_at: { type: 'string', description: 'Sender email creation timestamp' },
      updated_at: { type: 'string', description: 'Sender email update timestamp' },
    },
  }
}

export function buildEmailBisonLeadInterestedOutputs(): Record<string, TriggerOutput> {
  return buildEmailBisonLeadRepliedOutputs()
}

export function buildEmailBisonEmailBouncedOutputs(): Record<string, TriggerOutput> {
  return buildEmailBisonLeadRepliedOutputs()
}

export function buildEmailBisonManualEmailSentOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildEmailBisonOutputs(),
    reply: {
      id: { type: 'number', description: 'Reply ID' },
      email_subject: { type: 'string', description: 'Reply email subject' },
      interested: { type: 'boolean', description: 'Whether the reply is marked interested' },
      automated_reply: { type: 'boolean', description: 'Whether the reply is automated' },
      html_body: { type: 'string', description: 'Reply HTML body' },
      text_body: { type: 'string', description: 'Reply plain text body' },
      raw_body: { type: 'string', description: 'Raw MIME reply body' },
      headers: { type: 'string', description: 'Encoded raw email headers' },
      date_received: { type: 'string', description: 'Reply received timestamp' },
      reply_type: { type: 'string', description: 'Reply type' },
      from_name: { type: 'string', description: 'Reply sender name' },
      from_email_address: { type: 'string', description: 'Reply sender email address' },
      primary_to_email_address: { type: 'string', description: 'Primary recipient email address' },
      to: { type: 'json', description: 'Reply To recipients' },
      cc: { type: 'json', description: 'Reply CC recipients' },
      bcc: { type: 'json', description: 'Reply BCC recipients' },
      parent_id: { type: 'json', description: 'Parent reply ID' },
      folder: { type: 'string', description: 'Reply folder' },
      raw_message_id: { type: 'string', description: 'Raw email message ID' },
      created_at: { type: 'string', description: 'Reply creation timestamp' },
      updated_at: { type: 'string', description: 'Reply update timestamp' },
      attachments: { type: 'json', description: 'Reply attachments' },
    },
    lead: {
      id: { type: 'number', description: 'Lead ID' },
      email: { type: 'string', description: 'Lead email address' },
      first_name: { type: 'string', description: 'Lead first name' },
      last_name: { type: 'string', description: 'Lead last name' },
      status: { type: 'string', description: 'Lead status' },
      title: { type: 'string', description: 'Lead title' },
      company: { type: 'string', description: 'Lead company' },
      custom_variables: { type: 'json', description: 'Lead custom variables' },
      emails_sent: { type: 'number', description: 'Lead emails sent count' },
      opens: { type: 'number', description: 'Lead open count' },
      unique_opens: { type: 'number', description: 'Lead unique open count' },
      replies: { type: 'number', description: 'Lead reply count' },
      unique_replies: { type: 'number', description: 'Lead unique reply count' },
      bounces: { type: 'number', description: 'Lead bounce count' },
    },
    campaign: {
      id: { type: 'number', description: 'Campaign ID' },
      name: { type: 'string', description: 'Campaign name' },
    },
    scheduledEmail: {
      id: { type: 'number', description: 'Scheduled email ID' },
      sequence_step_id: { type: 'number', description: 'Sequence step ID' },
      sequence_step_order: { type: 'number', description: 'Sequence step order' },
      sequence_step_variant: { type: 'number', description: 'Sequence step variant' },
      status: { type: 'string', description: 'Scheduled email status' },
      scheduled_date_est: { type: 'string', description: 'Scheduled date in EST' },
      scheduled_date_local: { type: 'string', description: 'Scheduled date in local timezone' },
      local_timezone: { type: 'string', description: 'Scheduled email local timezone' },
      sent_at: { type: 'string', description: 'Email sent timestamp' },
      opens: { type: 'number', description: 'Open count' },
      replies: { type: 'number', description: 'Reply count' },
      unique_opens: { type: 'number', description: 'Unique open count' },
      unique_replies: { type: 'number', description: 'Unique reply count' },
      interested: { type: 'json', description: 'Interested status' },
      raw_message_id: { type: 'string', description: 'Raw email message ID' },
    },
    senderEmail: {
      id: { type: 'number', description: 'Sender email ID' },
      name: { type: 'string', description: 'Sender email name' },
      email: { type: 'string', description: 'Sender email address' },
      status: { type: 'string', description: 'Sender email status' },
      account_type: { type: 'string', description: 'Sender email connection type' },
      daily_limit: { type: 'number', description: 'Sender email daily limit' },
      emails_sent: { type: 'number', description: 'Sender email sent count' },
      replied: { type: 'number', description: 'Sender email replied count' },
      opened: { type: 'number', description: 'Sender email opened count' },
      unsubscribed: { type: 'number', description: 'Sender email unsubscribed count' },
      bounced: { type: 'number', description: 'Sender email bounced count' },
      unique_replies: { type: 'number', description: 'Sender email unique reply count' },
      unique_opens: { type: 'number', description: 'Sender email unique open count' },
      total_leads_contacted: { type: 'number', description: 'Sender email total leads contacted' },
      interested: { type: 'number', description: 'Sender email interested count' },
      created_at: { type: 'string', description: 'Sender email creation timestamp' },
      updated_at: { type: 'string', description: 'Sender email update timestamp' },
    },
  }
}

export function buildEmailBisonTagAttachedOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildEmailBisonOutputs(),
    tagId: { type: 'number', description: 'Email Bison tag ID' },
    tagName: { type: 'string', description: 'Email Bison tag name' },
    taggableId: { type: 'number', description: 'ID of the tagged resource' },
    taggableType: { type: 'string', description: 'Type of the tagged resource' },
  }
}

export function buildEmailBisonTagRemovedOutputs(): Record<string, TriggerOutput> {
  return buildEmailBisonTagAttachedOutputs()
}

export function buildEmailBisonEmailAccountAddedOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildEmailBisonOutputs(),
    senderEmail: {
      id: { type: 'number', description: 'Sender email ID' },
      name: { type: 'string', description: 'Sender email name' },
      email: { type: 'string', description: 'Sender email address' },
      status: { type: 'string', description: 'Sender email status' },
      account_type: { type: 'string', description: 'Sender email connection type' },
      daily_limit: { type: 'number', description: 'Sender email daily limit' },
      emails_sent: { type: 'number', description: 'Sender email sent count' },
      replied: { type: 'number', description: 'Sender email replied count' },
      opened: { type: 'number', description: 'Sender email opened count' },
      unsubscribed: { type: 'number', description: 'Sender email unsubscribed count' },
      bounced: { type: 'number', description: 'Sender email bounced count' },
      unique_replies: { type: 'number', description: 'Sender email unique reply count' },
      unique_opens: { type: 'number', description: 'Sender email unique open count' },
      total_leads_contacted: { type: 'number', description: 'Sender email total leads contacted' },
      interested: { type: 'number', description: 'Sender email interested count' },
      created_at: { type: 'string', description: 'Sender email creation timestamp' },
      updated_at: { type: 'string', description: 'Sender email update timestamp' },
    },
  }
}

export function buildEmailBisonEmailAccountRemovedOutputs(): Record<string, TriggerOutput> {
  return buildEmailBisonEmailAccountAddedOutputs()
}

export function buildEmailBisonEmailAccountDisconnectedOutputs(): Record<string, TriggerOutput> {
  return buildEmailBisonEmailAccountAddedOutputs()
}

export function buildEmailBisonEmailAccountReconnectedOutputs(): Record<string, TriggerOutput> {
  return buildEmailBisonEmailAccountAddedOutputs()
}

export function buildEmailBisonWarmupDisabledReceivingBouncesOutputs(): Record<
  string,
  TriggerOutput
> {
  return buildEmailBisonEmailAccountAddedOutputs()
}

export function buildEmailBisonWarmupDisabledCausingBouncesOutputs(): Record<
  string,
  TriggerOutput
> {
  return buildEmailBisonEmailAccountAddedOutputs()
}

export function buildEmailBisonUntrackedReplyReceivedOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildEmailBisonOutputs(),
    reply: {
      id: { type: 'number', description: 'Reply ID' },
      uuid: { type: 'string', description: 'Reply UUID' },
      email_subject: { type: 'string', description: 'Reply email subject' },
      interested: { type: 'boolean', description: 'Whether the reply is marked interested' },
      automated_reply: { type: 'boolean', description: 'Whether the reply is automated' },
      html_body: { type: 'string', description: 'Reply HTML body' },
      text_body: { type: 'string', description: 'Reply plain text body' },
      raw_body: { type: 'string', description: 'Raw MIME reply body' },
      headers: { type: 'string', description: 'Encoded raw email headers' },
      date_received: { type: 'string', description: 'Reply received timestamp' },
      from_name: { type: 'string', description: 'Reply sender name' },
      from_email_address: { type: 'string', description: 'Reply sender email address' },
      primary_to_email_address: { type: 'string', description: 'Primary recipient email address' },
      to: { type: 'json', description: 'Reply To recipients' },
      cc: { type: 'json', description: 'Reply CC recipients' },
      bcc: { type: 'json', description: 'Reply BCC recipients' },
      parent_id: { type: 'number', description: 'Parent reply ID' },
      reply_type: { type: 'string', description: 'Reply type' },
      folder: { type: 'string', description: 'Reply folder' },
      raw_message_id: { type: 'string', description: 'Raw email message ID' },
      created_at: { type: 'string', description: 'Reply creation timestamp' },
      updated_at: { type: 'string', description: 'Reply update timestamp' },
      attachments: { type: 'json', description: 'Reply attachments' },
    },
    senderEmail: {
      id: { type: 'number', description: 'Sender email ID' },
      name: { type: 'string', description: 'Sender email name' },
      email: { type: 'string', description: 'Sender email address' },
      status: { type: 'string', description: 'Sender email status' },
      account_type: { type: 'string', description: 'Sender email connection type' },
      daily_limit: { type: 'number', description: 'Sender email daily limit' },
      emails_sent: { type: 'number', description: 'Sender email sent count' },
      replied: { type: 'number', description: 'Sender email replied count' },
      opened: { type: 'number', description: 'Sender email opened count' },
      unsubscribed: { type: 'number', description: 'Sender email unsubscribed count' },
      bounced: { type: 'number', description: 'Sender email bounced count' },
      unique_replies: { type: 'number', description: 'Sender email unique reply count' },
      unique_opens: { type: 'number', description: 'Sender email unique open count' },
      total_leads_contacted: { type: 'number', description: 'Sender email total leads contacted' },
      interested: { type: 'number', description: 'Sender email interested count' },
      created_at: { type: 'string', description: 'Sender email creation timestamp' },
      updated_at: { type: 'string', description: 'Sender email update timestamp' },
    },
  }
}

export function getEmailBisonEventTypeForTrigger(triggerId: string): string | undefined {
  return EMAILBISON_TRIGGER_TO_EVENT_TYPE[
    triggerId as keyof typeof EMAILBISON_TRIGGER_TO_EVENT_TYPE
  ]
}

export function isEmailBisonEventMatch(triggerId: string, body: Record<string, unknown>): boolean {
  const expectedEventType = getEmailBisonEventTypeForTrigger(triggerId)
  if (!expectedEventType) return false

  const event = body.event
  if (!isRecord(event)) return false

  const actualEventType = event.type
  return typeof actualEventType === 'string' && actualEventType.toLowerCase() === expectedEventType
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
