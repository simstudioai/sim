import { CheckrIcon } from '@/components/icons'
import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerConfig, TriggerOutput } from '@/triggers/types'

/** The catch-all trigger: runs on every event the Checkr webhook delivers. */
export const CHECKR_ALL_EVENTS_TRIGGER_ID = 'checkr_webhook'

/** Which resource a Checkr event carries in `data.object`, keyed by trigger output name. */
type CheckrResource =
  | 'report'
  | 'invitation'
  | 'candidate'
  | 'adverseAction'
  | 'verification'
  | 'continuousCheck'

interface CheckrEventDefinition {
  triggerId: string
  label: string
  eventType: string
  resource: CheckrResource
  description: string
}

/**
 * Every typed Checkr trigger and the event `type` it listens for. Checkr sends
 * all subscribed events to every registered webhook, so the event type is
 * matched locally rather than at registration.
 */
const CHECKR_EVENTS: readonly CheckrEventDefinition[] = [
  {
    triggerId: 'checkr_report_created',
    label: 'Report Created',
    eventType: 'report.created',
    resource: 'report',
    description: 'Trigger workflow when a report is created',
  },
  {
    triggerId: 'checkr_report_completed',
    label: 'Report Completed',
    eventType: 'report.completed',
    resource: 'report',
    description: 'Trigger workflow when a report is completed',
  },
  {
    triggerId: 'checkr_report_updated',
    label: 'Report Updated',
    eventType: 'report.updated',
    resource: 'report',
    description:
      'Trigger workflow when a report is updated, such as an ETA change or drug screening update',
  },
  {
    triggerId: 'checkr_report_upgraded',
    label: 'Report Upgraded',
    eventType: 'report.upgraded',
    resource: 'report',
    description: 'Trigger workflow when a report is upgraded to another package',
  },
  {
    triggerId: 'checkr_report_suspended',
    label: 'Report Suspended',
    eventType: 'report.suspended',
    resource: 'report',
    description: 'Trigger workflow when a report is suspended awaiting candidate documentation',
  },
  {
    triggerId: 'checkr_report_resumed',
    label: 'Report Resumed',
    eventType: 'report.resumed',
    resource: 'report',
    description: 'Trigger workflow when a suspended report resumes',
  },
  {
    triggerId: 'checkr_report_paused',
    label: 'Report Paused',
    eventType: 'report.paused',
    resource: 'report',
    description: 'Trigger workflow when a report pauses awaiting a review action',
  },
  {
    triggerId: 'checkr_report_canceled',
    label: 'Report Canceled',
    eventType: 'report.canceled',
    resource: 'report',
    description: 'Trigger workflow when a report is canceled',
  },
  {
    triggerId: 'checkr_report_disputed',
    label: 'Report Disputed',
    eventType: 'report.disputed',
    resource: 'report',
    description: 'Trigger workflow when a candidate disputes a report',
  },
  {
    triggerId: 'checkr_report_dispute_completed',
    label: 'Report Dispute Completed',
    eventType: 'report.dispute_completed',
    resource: 'report',
    description: 'Trigger workflow when a report dispute is resolved',
  },
  {
    triggerId: 'checkr_report_engaged',
    label: 'Report Engaged',
    eventType: 'report.engaged',
    resource: 'report',
    description: 'Trigger workflow when a report is adjudicated as engaged',
  },
  {
    triggerId: 'checkr_invitation_created',
    label: 'Invitation Created',
    eventType: 'invitation.created',
    resource: 'invitation',
    description: 'Trigger workflow when an invitation is created',
  },
  {
    triggerId: 'checkr_invitation_completed',
    label: 'Invitation Completed',
    eventType: 'invitation.completed',
    resource: 'invitation',
    description: 'Trigger workflow when a candidate completes an invitation',
  },
  {
    triggerId: 'checkr_invitation_expired',
    label: 'Invitation Expired',
    eventType: 'invitation.expired',
    resource: 'invitation',
    description: 'Trigger workflow when an invitation expires',
  },
  {
    triggerId: 'checkr_invitation_deleted',
    label: 'Invitation Canceled',
    eventType: 'invitation.deleted',
    resource: 'invitation',
    description: 'Trigger workflow when an invitation is canceled',
  },
  {
    triggerId: 'checkr_candidate_created',
    label: 'Candidate Created',
    eventType: 'candidate.created',
    resource: 'candidate',
    description: 'Trigger workflow when a candidate is created',
  },
  {
    triggerId: 'checkr_candidate_updated',
    label: 'Candidate Updated',
    eventType: 'candidate.updated',
    resource: 'candidate',
    description: 'Trigger workflow when a candidate is updated',
  },
  {
    triggerId: 'checkr_adverse_action_created',
    label: 'Adverse Action Created',
    eventType: 'adverse_action.created',
    resource: 'adverseAction',
    description: 'Trigger workflow when an adverse action is created',
  },
  {
    triggerId: 'checkr_adverse_action_completed',
    label: 'Adverse Action Completed',
    eventType: 'adverse_action.completed',
    resource: 'adverseAction',
    description: 'Trigger workflow when the post-adverse action notice is sent',
  },
  {
    triggerId: 'checkr_adverse_action_canceled',
    label: 'Adverse Action Canceled',
    eventType: 'adverse_action.canceled',
    resource: 'adverseAction',
    description: 'Trigger workflow when an adverse action is canceled',
  },
  {
    triggerId: 'checkr_adverse_action_notice_not_delivered',
    label: 'Adverse Action Notice Not Delivered',
    eventType: 'adverse_action.notice_not_delivered',
    resource: 'adverseAction',
    description: 'Trigger workflow when an adverse action notice cannot be delivered',
  },
  {
    triggerId: 'checkr_report_pre_adverse_action',
    label: 'Report Pre-Adverse Action Sent',
    eventType: 'report.pre_adverse_action',
    resource: 'report',
    description: 'Trigger workflow when the pre-adverse action notice for a report is sent',
  },
  {
    triggerId: 'checkr_report_post_adverse_action',
    label: 'Report Post-Adverse Action Sent',
    eventType: 'report.post_adverse_action',
    resource: 'report',
    description: 'Trigger workflow when the post-adverse action notice for a report is sent',
  },
  {
    triggerId: 'checkr_adverse_action_paused',
    label: 'Adverse Action Paused',
    eventType: 'adverse_action.paused',
    resource: 'adverseAction',
    description: 'Trigger workflow when delivery of a post-adverse action notice is paused',
  },
  {
    triggerId: 'checkr_adverse_action_resumed',
    label: 'Adverse Action Resumed',
    eventType: 'adverse_action.resumed',
    resource: 'adverseAction',
    description: 'Trigger workflow when a paused adverse action resumes',
  },
  {
    triggerId: 'checkr_verification_created',
    label: 'Verification Created',
    eventType: 'verification.created',
    resource: 'verification',
    description:
      'Trigger workflow when a candidate is asked to verify information or upload a document',
  },
  {
    triggerId: 'checkr_verification_completed',
    label: 'Verification Completed',
    eventType: 'verification.completed',
    resource: 'verification',
    description: 'Trigger workflow when a candidate completes a verification',
  },
  {
    triggerId: 'checkr_verification_processed',
    label: 'Verification Processed',
    eventType: 'verification.processed',
    resource: 'verification',
    description: 'Trigger workflow when a verification is processed and a decision is made',
  },
  {
    triggerId: 'checkr_continuous_check_subscription_error',
    label: 'Continuous Check Enrollment Error',
    eventType: 'continuous_check.subscription_error',
    resource: 'continuousCheck',
    description: 'Trigger workflow when enrolling a candidate in Continuous MVR fails',
  },
  {
    triggerId: 'checkr_continuous_check_confirmation_required',
    label: 'Continuous Check Confirmation Required',
    eventType: 'continuous_check.confirmation_required',
    resource: 'continuousCheck',
    description:
      'Trigger workflow when a candidate is unenrolled from Continuous MVR and must be re-enrolled',
  },
]

const EVENTS_BY_TRIGGER_ID = new Map(CHECKR_EVENTS.map((event) => [event.triggerId, event]))

const checkrTriggerOptions = [
  ...CHECKR_EVENTS.map((event) => ({ label: event.label, id: event.triggerId })),
  { label: 'All Events', id: CHECKR_ALL_EVENTS_TRIGGER_ID },
]

/**
 * Whether a delivered event type belongs to the configured trigger. The
 * catch-all trigger accepts every event; an unknown trigger accepts none.
 */
export function isCheckrEventMatch(triggerId: string, eventType: string): boolean {
  if (triggerId === CHECKR_ALL_EVENTS_TRIGGER_ID) return true
  return EVENTS_BY_TRIGGER_ID.get(triggerId)?.eventType === eventType
}

/** The output key that carries the event's object for a typed trigger, or null for the catch-all. */
export function getCheckrResourceKey(triggerId: string): CheckrResource | null {
  return EVENTS_BY_TRIGGER_ID.get(triggerId)?.resource ?? null
}

function checkrSetupInstructions(eventLabel: string): string {
  const instructions = [
    'Enter your Checkr production secret API key above (staging keys are not supported). Find it in the Checkr Dashboard under <strong>Account Settings &gt; Developer Settings</strong>.',
    `When you deploy the workflow, Sim registers a webhook in Checkr and runs this workflow on <strong>${eventLabel}</strong> events. Checkr signs every delivery with your API key, and Sim rejects unsigned requests.`,
    'Checkr allows at most two webhooks per account, and each deployed Checkr trigger uses one. To react to several events with one webhook, use <strong>All Events</strong> and branch on the event type.',
    'The webhook is deleted from Checkr when you remove this trigger and redeploy.',
  ]
  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

export function buildCheckrSubBlocks(options: {
  triggerId: string
  eventLabel: string
  includeDropdown?: boolean
}): SubBlockConfig[] {
  const { triggerId, eventLabel, includeDropdown = false } = options
  const blocks: SubBlockConfig[] = []

  if (includeDropdown) {
    blocks.push({
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      canvasNoun: 'an event',
      type: 'dropdown',
      mode: 'trigger',
      options: checkrTriggerOptions,
      value: () => triggerId,
      required: true,
    })
  }

  blocks.push({
    id: 'apiKey',
    title: 'API Key',
    type: 'short-input',
    placeholder: 'Enter your Checkr secret API key',
    password: true,
    required: true,
    paramVisibility: 'user-only',
    mode: 'trigger',
    condition: { field: 'selectedTriggerId', value: triggerId },
  })

  blocks.push({
    id: 'triggerInstructions',
    title: 'Setup Instructions',
    hideFromPreview: true,
    type: 'text',
    defaultValue: checkrSetupInstructions(eventLabel),
    mode: 'trigger',
    condition: { field: 'selectedTriggerId', value: triggerId },
  })

  return blocks
}

export const CHECKR_EVENT_OUTPUTS = {
  eventId: { type: 'string', description: 'Checkr event ID, stable across delivery retries' },
  eventType: { type: 'string', description: 'Event type, e.g. report.completed' },
  createdAt: { type: 'string', description: 'Time the event occurred (ISO 8601)' },
  accountId: { type: 'string', description: 'Checkr account ID the event belongs to' },
  objectType: { type: 'string', description: 'Type of the object in the event, e.g. report' },
  objectId: { type: 'string', description: 'ID of the object in the event' },
} as const satisfies Record<string, TriggerOutput>

const REPORT_OUTPUT: Record<string, TriggerOutput> = {
  id: { type: 'string', description: 'Report ID' },
  object: { type: 'string', description: 'Object type (report)' },
  uri: { type: 'string', description: 'Report API URI' },
  status: {
    type: 'string',
    description: 'Status (pending, complete, suspended, paused, dispute, canceled)',
  },
  result: { type: 'string', description: 'Result (clear, consider)' },
  adjudication: {
    type: 'string',
    description: 'Adjudication (engaged, pre_adverse_action, post_adverse_action)',
  },
  assessment: { type: 'string', description: 'Assess result (eligible, review, escalated)' },
  package: { type: 'string', description: 'Package the report was ordered with' },
  source: { type: 'string', description: 'How the report was created' },
  candidate_id: { type: 'string', description: 'Screened candidate ID' },
  created_at: { type: 'string', description: 'Time the report was created' },
  received_at: { type: 'string', description: 'Time the report was received' },
  completed_at: { type: 'string', description: 'Time the report was completed' },
  revised_at: { type: 'string', description: 'Time the report was revised' },
  upgraded_at: { type: 'string', description: 'Time the report was upgraded' },
  turnaround_time: { type: 'number', description: 'Seconds from creation to completion' },
  estimated_completion_time: { type: 'string', description: 'Predicted completion date' },
  includes_canceled: {
    type: 'boolean',
    description: 'Whether the report includes a canceled screening',
  },
  ssn_trace_id: { type: 'string', description: 'SSN trace ID' },
  sex_offender_search_id: { type: 'string', description: 'Sex offender search ID' },
  national_criminal_search_id: { type: 'string', description: 'National criminal search ID' },
  global_watchlist_search_id: { type: 'string', description: 'Global watchlist search ID' },
  motor_vehicle_report_id: { type: 'string', description: 'Motor vehicle report ID' },
  county_criminal_search_ids: { type: 'array', description: 'County criminal search IDs' },
  state_criminal_search_ids: { type: 'array', description: 'State criminal search IDs' },
  document_ids: { type: 'array', description: 'Document IDs' },
  geo_ids: { type: 'array', description: 'Geo IDs' },
  dispute_summary: {
    type: 'json',
    description:
      'Dispute outcome on report.dispute_completed (unresolved_disputes, disputes with id, status, changes_made, resolved_at)',
  },
}

const INVITATION_OUTPUT: Record<string, TriggerOutput> = {
  id: { type: 'string', description: 'Invitation ID' },
  object: { type: 'string', description: 'Object type (invitation)' },
  uri: { type: 'string', description: 'Invitation API URI' },
  status: { type: 'string', description: 'Status (pending, completed, expired)' },
  invitation_url: { type: 'string', description: 'URL the candidate opens to apply' },
  package: { type: 'string', description: 'Package slug' },
  candidate_id: { type: 'string', description: 'Invited candidate ID' },
  report_id: { type: 'string', description: 'Report created when the invitation was completed' },
  created_at: { type: 'string', description: 'Time the invitation was created' },
  expires_at: { type: 'string', description: 'Time the invitation expires' },
  completed_at: { type: 'string', description: 'Time the invitation was completed' },
  deleted_at: { type: 'string', description: 'Time the invitation was canceled' },
}

const CANDIDATE_OUTPUT: Record<string, TriggerOutput> = {
  id: { type: 'string', description: 'Candidate ID' },
  object: { type: 'string', description: 'Object type (candidate)' },
  uri: { type: 'string', description: 'Candidate API URI' },
  created_at: { type: 'string', description: 'Time the candidate was created' },
  first_name: { type: 'string', description: 'First name' },
  middle_name: { type: 'string', description: 'Middle name' },
  last_name: { type: 'string', description: 'Last name' },
  email: { type: 'string', description: 'Email address' },
  phone: { type: 'string', description: 'Phone number' },
  zipcode: { type: 'string', description: 'Zip code' },
  dob: { type: 'string', description: 'Date of birth' },
  ssn: { type: 'string', description: 'SSN redacted to the last four digits' },
  driver_license_state: { type: 'string', description: 'Driver license state' },
  driver_license_number: { type: 'string', description: 'Driver license number' },
  adjudication: { type: 'string', description: 'Adjudication of the most recent report' },
  custom_id: { type: 'string', description: 'Your own ID for the candidate' },
  report_ids: { type: 'array', description: 'Report IDs' },
  geo_ids: { type: 'array', description: 'Geo IDs' },
  metadata: { type: 'json', description: 'Custom key-value metadata' },
}

const ADVERSE_ACTION_OUTPUT: Record<string, TriggerOutput> = {
  id: { type: 'string', description: 'Adverse action ID' },
  object: { type: 'string', description: 'Object type (adverse_action)' },
  uri: { type: 'string', description: 'Adverse action API URI' },
  status: { type: 'string', description: 'Status (pending, complete, dispute, canceled)' },
  report_id: { type: 'string', description: 'Report the adverse action is based on' },
  created_at: { type: 'string', description: 'Time the adverse action was created' },
  canceled_at: { type: 'string', description: 'Time the adverse action was canceled' },
  post_notice_scheduled_at: {
    type: 'string',
    description: 'Time the post-adverse action notice is scheduled',
  },
  post_notice_ready_at: {
    type: 'string',
    description: 'Earliest time the post-adverse action notice can be sent',
  },
  individualized_assessment_engaged: {
    type: 'boolean',
    description: 'Whether an individualized assessment was engaged',
  },
  context: { type: 'string', description: 'Scoping identifier for the adverse action' },
  delivery: {
    state: { type: 'string', description: 'Notice delivery state' },
    reason: { type: 'string', description: 'Reason for the delivery state' },
    updated_at: { type: 'string', description: 'Time the delivery state changed' },
  },
  adverse_items: { type: 'array', description: 'Adverse items (id, object, text)' },
}

const VERIFICATION_OUTPUT: Record<string, TriggerOutput> = {
  id: { type: 'string', description: 'Verification ID' },
  object: { type: 'string', description: 'Object type (verification)' },
  uri: { type: 'string', description: 'Verification API URI' },
  verification_type: {
    type: 'string',
    description: 'Verification type, such as id or ssn_confirmation',
  },
  verification_url: {
    type: 'string',
    description: 'URL where the candidate submits the requested information',
  },
  report_id: { type: 'string', description: 'Report ID' },
  created_at: { type: 'string', description: 'Time the verification was created' },
  completed_at: { type: 'string', description: 'Time the candidate completed the verification' },
  processed_at: { type: 'string', description: 'Time the verification was processed' },
}

const CONTINUOUS_CHECK_OUTPUT: Record<string, TriggerOutput> = {
  id: { type: 'string', description: 'Continuous check ID' },
  object: { type: 'string', description: 'Object type (continuous_check)' },
  candidate_id: { type: 'string', description: 'Enrolled candidate ID' },
  created_at: { type: 'string', description: 'Time the continuous check was created' },
  node: { type: 'string', description: 'Hierarchy node custom ID' },
  work_locations: {
    type: 'array',
    description: 'Work locations (country, state, city)',
  },
}

const RESOURCE_OUTPUTS: Record<CheckrResource, Record<string, TriggerOutput>> = {
  report: REPORT_OUTPUT,
  invitation: INVITATION_OUTPUT,
  candidate: CANDIDATE_OUTPUT,
  adverseAction: ADVERSE_ACTION_OUTPUT,
  verification: VERIFICATION_OUTPUT,
  continuousCheck: CONTINUOUS_CHECK_OUTPUT,
}

/** Builds a typed Checkr trigger from its event definition. */
export function createCheckrTrigger(
  triggerId: string,
  options: { includeDropdown?: boolean } = {}
): TriggerConfig {
  const event = EVENTS_BY_TRIGGER_ID.get(triggerId)
  if (!event) throw new Error(`Unknown Checkr trigger: ${triggerId}`)
  return {
    id: event.triggerId,
    name: `Checkr ${event.label}`,
    provider: 'checkr',
    description: event.description,
    version: '1.0.0',
    icon: CheckrIcon,
    subBlocks: buildCheckrSubBlocks({
      triggerId: event.triggerId,
      eventLabel: event.label,
      includeDropdown: options.includeDropdown,
    }),
    outputs: {
      ...CHECKR_EVENT_OUTPUTS,
      [event.resource]: RESOURCE_OUTPUTS[event.resource],
    } as Record<string, TriggerOutput>,
    webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
  }
}
