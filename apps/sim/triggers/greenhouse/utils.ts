import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Dropdown options for the Greenhouse trigger type selector.
 */
export const greenhouseTriggerOptions = [
  { label: 'Candidate Hired', id: 'greenhouse_candidate_hired' },
  { label: 'New Application', id: 'greenhouse_new_application' },
  { label: 'Candidate Stage Change', id: 'greenhouse_candidate_stage_change' },
  { label: 'Candidate Rejected', id: 'greenhouse_candidate_rejected' },
  { label: 'Offer Created', id: 'greenhouse_offer_created' },
  { label: 'Job Created', id: 'greenhouse_job_created' },
  { label: 'Job Updated', id: 'greenhouse_job_updated' },
  { label: 'Generic Webhook (All Events)', id: 'greenhouse_webhook' },
]

/**
 * Maps trigger IDs to Greenhouse webhook action strings.
 * Used for event filtering in the webhook processor.
 */
export const GREENHOUSE_EVENT_MAP: Record<string, string> = {
  greenhouse_candidate_hired: 'hire_candidate',
  greenhouse_new_application: 'new_candidate_application',
  greenhouse_candidate_stage_change: 'candidate_stage_change',
  greenhouse_candidate_rejected: 'reject_candidate',
  greenhouse_offer_created: 'offer_created',
  greenhouse_job_created: 'job_created',
  greenhouse_job_updated: 'job_updated',
}

/**
 * Checks whether a Greenhouse webhook payload matches the configured trigger.
 */
export function isGreenhouseEventMatch(triggerId: string, action: string): boolean {
  const expectedAction = GREENHOUSE_EVENT_MAP[triggerId]
  if (!expectedAction) {
    return true
  }
  return action === expectedAction
}

/**
 * Builds extra fields for Greenhouse triggers.
 * Includes an optional secret key for HMAC signature verification.
 */
export function buildGreenhouseExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'secretKey',
      title: 'Secret Key (Optional)',
      type: 'short-input',
      placeholder: 'Enter the same secret key configured in Greenhouse',
      description: 'Used to verify webhook signatures via HMAC-SHA256.',
      password: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

/**
 * Generates HTML setup instructions for Greenhouse webhooks.
 * Webhooks are manually configured in the Greenhouse admin panel.
 */
export function greenhouseSetupInstructions(eventType: string): string {
  const instructions = [
    'Copy the <strong>Webhook URL</strong> above.',
    'In Greenhouse, go to <strong>Configure &gt; Dev Center &gt; Webhooks</strong>.',
    'Click <strong>Create New Webhook</strong>.',
    'Paste the Webhook URL into the <strong>Endpoint URL</strong> field.',
    'Enter a <strong>Secret Key</strong> for signature verification (optional).',
    `Under <strong>When</strong>, select the <strong>${eventType}</strong> event.`,
    'Click <strong>Create Webhook</strong> to save.',
    'Click "Save" above to activate your trigger.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Build outputs for hire_candidate events.
 * Greenhouse nests candidate inside application: payload.application.candidate
 * Uses both singular `job` (deprecated) and `jobs` array.
 */
export function buildCandidateHiredOutputs(): Record<string, TriggerOutput> {
  return {
    action: { type: 'string', description: 'The webhook event type (hire_candidate)' },
    payload: {
      application: {
        id: { type: 'number', description: 'Application ID' },
        status: { type: 'string', description: 'Application status' },
        prospect: { type: 'boolean', description: 'Whether the applicant is a prospect' },
        applied_at: { type: 'string', description: 'When the application was submitted' },
        url: { type: 'string', description: 'Application URL in Greenhouse' },
        current_stage: {
          id: { type: 'number', description: 'Current stage ID' },
          name: { type: 'string', description: 'Current stage name' },
        },
        candidate: {
          id: { type: 'number', description: 'Candidate ID' },
          first_name: { type: 'string', description: 'First name' },
          last_name: { type: 'string', description: 'Last name' },
          title: { type: 'string', description: 'Current title' },
          company: { type: 'string', description: 'Current company' },
          email_addresses: { type: 'json', description: 'Email addresses' },
          phone_numbers: { type: 'json', description: 'Phone numbers' },
          recruiter: { type: 'json', description: 'Assigned recruiter' },
          coordinator: { type: 'json', description: 'Assigned coordinator' },
        },
        jobs: { type: 'json', description: 'Associated jobs (array)' },
        source: {
          id: { type: 'number', description: 'Source ID' },
          public_name: { type: 'string', description: 'Source name' },
        },
        offer: {
          id: { type: 'number', description: 'Offer ID' },
          version: { type: 'number', description: 'Offer version' },
          starts_at: { type: 'string', description: 'Offer start date' },
          custom_fields: { type: 'json', description: 'Offer custom fields' },
        },
        custom_fields: { type: 'json', description: 'Application custom fields' },
      },
    },
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for new_candidate_application events.
 * Candidate is nested inside application: payload.application.candidate
 */
export function buildNewApplicationOutputs(): Record<string, TriggerOutput> {
  return {
    action: { type: 'string', description: 'The webhook event type (new_candidate_application)' },
    payload: {
      application: {
        id: { type: 'number', description: 'Application ID' },
        status: { type: 'string', description: 'Application status' },
        prospect: { type: 'boolean', description: 'Whether the applicant is a prospect' },
        applied_at: { type: 'string', description: 'When the application was submitted' },
        url: { type: 'string', description: 'Application URL in Greenhouse' },
        current_stage: {
          id: { type: 'number', description: 'Current stage ID' },
          name: { type: 'string', description: 'Current stage name' },
        },
        candidate: {
          id: { type: 'number', description: 'Candidate ID' },
          first_name: { type: 'string', description: 'First name' },
          last_name: { type: 'string', description: 'Last name' },
          title: { type: 'string', description: 'Current title' },
          company: { type: 'string', description: 'Current company' },
          created_at: { type: 'string', description: 'When the candidate was created' },
          email_addresses: { type: 'json', description: 'Email addresses' },
          phone_numbers: { type: 'json', description: 'Phone numbers' },
          tags: { type: 'json', description: 'Candidate tags' },
        },
        jobs: { type: 'json', description: 'Associated jobs (array)' },
        source: {
          id: { type: 'number', description: 'Source ID' },
          public_name: { type: 'string', description: 'Source name' },
        },
        answers: { type: 'json', description: 'Application question answers' },
        attachments: { type: 'json', description: 'Application attachments' },
        custom_fields: { type: 'json', description: 'Application custom fields' },
      },
    },
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for candidate_stage_change events.
 * Candidate is nested inside application: payload.application.candidate
 */
export function buildCandidateStageChangeOutputs(): Record<string, TriggerOutput> {
  return {
    action: { type: 'string', description: 'The webhook event type (candidate_stage_change)' },
    payload: {
      application: {
        id: { type: 'number', description: 'Application ID' },
        status: { type: 'string', description: 'Application status' },
        prospect: { type: 'boolean', description: 'Whether the applicant is a prospect' },
        applied_at: { type: 'string', description: 'When the application was submitted' },
        url: { type: 'string', description: 'Application URL in Greenhouse' },
        current_stage: {
          id: { type: 'number', description: 'Current stage ID' },
          name: { type: 'string', description: 'Current stage name' },
          interviews: { type: 'json', description: 'Interviews in this stage' },
        },
        candidate: {
          id: { type: 'number', description: 'Candidate ID' },
          first_name: { type: 'string', description: 'First name' },
          last_name: { type: 'string', description: 'Last name' },
          title: { type: 'string', description: 'Current title' },
          company: { type: 'string', description: 'Current company' },
          email_addresses: { type: 'json', description: 'Email addresses' },
          phone_numbers: { type: 'json', description: 'Phone numbers' },
        },
        jobs: { type: 'json', description: 'Associated jobs (array)' },
        source: {
          id: { type: 'number', description: 'Source ID' },
          public_name: { type: 'string', description: 'Source name' },
        },
        custom_fields: { type: 'json', description: 'Application custom fields' },
      },
    },
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for reject_candidate events.
 * Candidate is nested inside application: payload.application.candidate
 */
export function buildCandidateRejectedOutputs(): Record<string, TriggerOutput> {
  return {
    action: { type: 'string', description: 'The webhook event type (reject_candidate)' },
    payload: {
      application: {
        id: { type: 'number', description: 'Application ID' },
        status: { type: 'string', description: 'Application status (rejected)' },
        prospect: { type: 'boolean', description: 'Whether the applicant is a prospect' },
        applied_at: { type: 'string', description: 'When the application was submitted' },
        rejected_at: { type: 'string', description: 'When the candidate was rejected' },
        url: { type: 'string', description: 'Application URL in Greenhouse' },
        current_stage: {
          id: { type: 'number', description: 'Stage ID where rejected' },
          name: { type: 'string', description: 'Stage name where rejected' },
        },
        candidate: {
          id: { type: 'number', description: 'Candidate ID' },
          first_name: { type: 'string', description: 'First name' },
          last_name: { type: 'string', description: 'Last name' },
          email_addresses: { type: 'json', description: 'Email addresses' },
          phone_numbers: { type: 'json', description: 'Phone numbers' },
        },
        jobs: { type: 'json', description: 'Associated jobs (array)' },
        rejection_reason: {
          type: 'json',
          description: 'Rejection reason object with id, name, and type fields',
        },
        rejection_details: { type: 'json', description: 'Rejection details with custom fields' },
        custom_fields: { type: 'json', description: 'Application custom fields' },
      },
    },
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for offer_created events.
 * Offer payload is flat under payload (not nested under payload.offer).
 */
export function buildOfferCreatedOutputs(): Record<string, TriggerOutput> {
  return {
    action: { type: 'string', description: 'The webhook event type (offer_created)' },
    payload: {
      id: { type: 'number', description: 'Offer ID' },
      application_id: { type: 'number', description: 'Associated application ID' },
      job_id: { type: 'number', description: 'Associated job ID' },
      user_id: { type: 'number', description: 'User who created the offer' },
      version: { type: 'number', description: 'Offer version number' },
      sent_on: { type: 'string', description: 'When the offer was sent' },
      resolved_at: { type: 'string', description: 'When the offer was resolved' },
      start_date: { type: 'string', description: 'Offer start date' },
      notes: { type: 'string', description: 'Offer notes' },
      offer_status: { type: 'string', description: 'Offer status' },
      custom_fields: { type: 'json', description: 'Custom field values' },
    },
  } as Record<string, TriggerOutput>
}

/**
 * Shared job payload shape used by both job_created and job_updated events.
 */
function buildJobPayload(): Record<string, TriggerOutput> {
  return {
    id: { type: 'number', description: 'Job ID' },
    name: { type: 'string', description: 'Job title' },
    requisition_id: { type: 'string', description: 'Requisition ID' },
    status: { type: 'string', description: 'Job status (open, closed, draft)' },
    confidential: { type: 'boolean', description: 'Whether the job is confidential' },
    created_at: { type: 'string', description: 'When the job was created' },
    opened_at: { type: 'string', description: 'When the job was opened' },
    closed_at: { type: 'string', description: 'When the job was closed' },
    departments: { type: 'json', description: 'Associated departments' },
    offices: { type: 'json', description: 'Associated offices' },
    hiring_team: { type: 'json', description: 'Hiring team (managers, recruiters, etc.)' },
    openings: { type: 'json', description: 'Job openings' },
    custom_fields: { type: 'json', description: 'Custom field values' },
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for job_created events.
 * Job data is nested under payload.job.
 */
export function buildJobCreatedOutputs(): Record<string, TriggerOutput> {
  return {
    action: { type: 'string', description: 'The webhook event type (job_created)' },
    payload: { job: buildJobPayload() },
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for job_updated events.
 * Same structure as job_created.
 */
export function buildJobUpdatedOutputs(): Record<string, TriggerOutput> {
  return {
    action: { type: 'string', description: 'The webhook event type (job_updated)' },
    payload: { job: buildJobPayload() },
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for generic webhook (all events).
 */
export function buildWebhookOutputs(): Record<string, TriggerOutput> {
  return {
    action: { type: 'string', description: 'The webhook event type' },
    payload: { type: 'json', description: 'Full event payload' },
  } as Record<string, TriggerOutput>
}
