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
    'Enter your Ashby API Key above.',
    'You can find your API key in Ashby at <strong>Settings > API Keys</strong>. The key must have the <strong>apiKeysWrite</strong> permission.',
    `Click <strong>"Save Configuration"</strong> to automatically create the webhook in Ashby for <strong>${eventType}</strong> events.`,
    'The webhook will be automatically deleted when you remove this trigger.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Ashby-specific extra fields for triggers.
 * Includes API key (required for automatic webhook creation).
 */
export function buildAshbyExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Ashby API key',
      description: 'Required to create the webhook in Ashby. Must have apiKeysWrite permission.',
      password: true,
      required: true,
      paramVisibility: 'user-only',
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
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
