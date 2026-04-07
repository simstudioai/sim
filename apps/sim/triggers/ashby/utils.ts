import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Dropdown options for the Ashby trigger type selector.
 */
export const ashbyTriggerOptions = [
  { label: 'Application Submitted', id: 'ashby_application_submit' },
  { label: 'Candidate Stage Change', id: 'ashby_candidate_stage_change' },
  { label: 'Candidate Hired', id: 'ashby_candidate_hire' },
  { label: 'Candidate Deleted', id: 'ashby_candidate_delete' },
  { label: 'Job Created', id: 'ashby_job_create' },
  { label: 'Offer Created', id: 'ashby_offer_create' },
]

/**
 * Generates setup instructions for Ashby webhooks.
 * Webhooks are automatically created/deleted via the Ashby API.
 */
export function ashbySetupInstructions(eventType: string): string {
  const instructions = [
    'Enter your Ashby API Key above. You can find your API key in Ashby at <strong>Settings &gt; API Keys</strong>.',
    `The webhook for <strong>${eventType}</strong> events will be automatically created in Ashby when you save the trigger.`,
    'The webhook will be automatically deleted if you remove this trigger.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Builds the complete subBlocks array for an Ashby trigger.
 * Ashby webhooks are managed via API, so no webhook URL is displayed.
 *
 * Structure: [dropdown?] -> apiKey -> instructions
 */
export function buildAshbySubBlocks(options: {
  triggerId: string
  eventType: string
  includeDropdown?: boolean
}): SubBlockConfig[] {
  const { triggerId, eventType, includeDropdown = false } = options
  const blocks: SubBlockConfig[] = []

  if (includeDropdown) {
    blocks.push({
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: ashbyTriggerOptions,
      value: () => triggerId,
      required: true,
    })
  }

  blocks.push({
    id: 'apiKey',
    title: 'API Key',
    type: 'short-input',
    placeholder: 'Enter your Ashby API key',
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
    defaultValue: ashbySetupInstructions(eventType),
    mode: 'trigger',
    condition: { field: 'selectedTriggerId', value: triggerId },
  })

  return blocks
}

/**
 * Core fields present in all Ashby webhook payloads.
 */
const coreOutputs = {
  action: {
    type: 'string',
    description: 'The webhook event type (e.g., applicationSubmit, candidateHire)',
  },
} as const

/**
 * Build outputs for applicationSubmit events.
 * Payload: { action, data: { application: { id, createdAt, updatedAt, status,
 *   candidate: { id, name }, currentInterviewStage: { id, title },
 *   job: { id, title } } } }
 */
export function buildApplicationSubmitOutputs(): Record<string, TriggerOutput> {
  return {
    ...coreOutputs,
    application: {
      id: { type: 'string', description: 'Application UUID' },
      createdAt: { type: 'string', description: 'Application creation timestamp (ISO 8601)' },
      updatedAt: {
        type: 'string',
        description: 'Application last update timestamp (ISO 8601)',
      },
      status: {
        type: 'string',
        description: 'Application status (Active, Hired, Archived, Lead)',
      },
      candidate: {
        id: { type: 'string', description: 'Candidate UUID' },
        name: { type: 'string', description: 'Candidate name' },
      },
      currentInterviewStage: {
        id: { type: 'string', description: 'Current interview stage UUID' },
        title: { type: 'string', description: 'Current interview stage title' },
      },
      job: {
        id: { type: 'string', description: 'Job UUID' },
        title: { type: 'string', description: 'Job title' },
      },
    },
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for candidateStageChange events.
 * Payload matches the application object structure (same as applicationUpdate).
 * Payload: { action, data: { application: { id, createdAt, updatedAt, status,
 *   candidate: { id, name }, currentInterviewStage: { id, title, type },
 *   job: { id, title } } } }
 */
export function buildCandidateStageChangeOutputs(): Record<string, TriggerOutput> {
  return {
    ...coreOutputs,
    application: {
      id: { type: 'string', description: 'Application UUID' },
      createdAt: { type: 'string', description: 'Application creation timestamp (ISO 8601)' },
      updatedAt: {
        type: 'string',
        description: 'Application last update timestamp (ISO 8601)',
      },
      status: {
        type: 'string',
        description: 'Application status (Active, Hired, Archived, Lead)',
      },
      candidate: {
        id: { type: 'string', description: 'Candidate UUID' },
        name: { type: 'string', description: 'Candidate name' },
      },
      currentInterviewStage: {
        id: { type: 'string', description: 'Current interview stage UUID' },
        title: { type: 'string', description: 'Current interview stage title' },
      },
      job: {
        id: { type: 'string', description: 'Job UUID' },
        title: { type: 'string', description: 'Job title' },
      },
    },
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for candidateHire events.
 * Payload: { action, data: { application: { id, createdAt, updatedAt, status,
 *   candidate: { id, name }, currentInterviewStage: { id, title },
 *   job: { id, title } } } }
 */
export function buildCandidateHireOutputs(): Record<string, TriggerOutput> {
  return {
    ...coreOutputs,
    application: {
      id: { type: 'string', description: 'Application UUID' },
      createdAt: { type: 'string', description: 'Application creation timestamp (ISO 8601)' },
      updatedAt: {
        type: 'string',
        description: 'Application last update timestamp (ISO 8601)',
      },
      status: { type: 'string', description: 'Application status (Hired)' },
      candidate: {
        id: { type: 'string', description: 'Candidate UUID' },
        name: { type: 'string', description: 'Candidate name' },
      },
      currentInterviewStage: {
        id: { type: 'string', description: 'Current interview stage UUID' },
        title: { type: 'string', description: 'Current interview stage title' },
      },
      job: {
        id: { type: 'string', description: 'Job UUID' },
        title: { type: 'string', description: 'Job title' },
      },
    },
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for candidateDelete events.
 * Payload: { action, data: { candidate: { id } } }
 */
export function buildCandidateDeleteOutputs(): Record<string, TriggerOutput> {
  return {
    ...coreOutputs,
    candidate: {
      id: { type: 'string', description: 'Deleted candidate UUID' },
    },
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for jobCreate events.
 * Payload: { action, data: { job: { id, title, confidential, status, employmentType } } }
 */
export function buildJobCreateOutputs(): Record<string, TriggerOutput> {
  return {
    ...coreOutputs,
    job: {
      id: { type: 'string', description: 'Job UUID' },
      title: { type: 'string', description: 'Job title' },
      confidential: { type: 'boolean', description: 'Whether the job is confidential' },
      status: { type: 'string', description: 'Job status (Open, Closed, Draft, Archived)' },
      employmentType: {
        type: 'string',
        description: 'Employment type (Full-time, Part-time, etc.)',
      },
    },
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for offerCreate events.
 * Payload: { action, data: { offer: { id, decidedAt, applicationId, acceptanceStatus,
 *   offerStatus, latestVersion: { id } } } }
 */
export function buildOfferCreateOutputs(): Record<string, TriggerOutput> {
  return {
    ...coreOutputs,
    offer: {
      id: { type: 'string', description: 'Offer UUID' },
      applicationId: { type: 'string', description: 'Associated application UUID' },
      acceptanceStatus: {
        type: 'string',
        description:
          'Offer acceptance status (Accepted, Declined, Pending, Created, Cancelled, WaitingOnResponse)',
      },
      offerStatus: {
        type: 'string',
        description:
          'Offer process status (WaitingOnApprovalStart, WaitingOnOfferApproval, WaitingOnCandidateResponse, CandidateAccepted, CandidateRejected, OfferCancelled)',
      },
      decidedAt: {
        type: 'string',
        description:
          'Offer decision timestamp (ISO 8601). Typically null at creation; populated after candidate responds.',
      },
      latestVersion: {
        id: { type: 'string', description: 'Latest offer version UUID' },
      },
    },
  } as Record<string, TriggerOutput>
}
