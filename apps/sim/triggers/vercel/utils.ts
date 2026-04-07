import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Dropdown options for the Vercel trigger type selector
 */
export const vercelTriggerOptions = [
  { label: 'Deployment Created', id: 'vercel_deployment_created' },
  { label: 'Deployment Ready', id: 'vercel_deployment_ready' },
  { label: 'Deployment Error', id: 'vercel_deployment_error' },
  { label: 'Deployment Canceled', id: 'vercel_deployment_canceled' },
  { label: 'Project Created', id: 'vercel_project_created' },
  { label: 'Project Removed', id: 'vercel_project_removed' },
  { label: 'Domain Created', id: 'vercel_domain_created' },
  { label: 'Common events (curated list)', id: 'vercel_webhook' },
]

/** Maps Sim trigger IDs to Vercel webhook `type` strings (see Vercel Webhooks API). */
export const VERCEL_TRIGGER_EVENT_TYPES: Record<string, string> = {
  vercel_deployment_created: 'deployment.created',
  vercel_deployment_ready: 'deployment.ready',
  vercel_deployment_error: 'deployment.error',
  vercel_deployment_canceled: 'deployment.canceled',
  vercel_project_created: 'project.created',
  vercel_project_removed: 'project.removed',
  vercel_domain_created: 'domain.created',
}

/** Curated set used by the generic Vercel webhook trigger. */
export const VERCEL_GENERIC_TRIGGER_EVENT_TYPES = [
  'deployment.created',
  'deployment.ready',
  'deployment.succeeded',
  'deployment.error',
  'deployment.canceled',
  'deployment.promoted',
  'project.created',
  'project.removed',
  'domain.created',
  'edge-config.created',
  'edge-config.deleted',
] as const

/**
 * Returns whether the incoming Vercel event matches the configured trigger.
 * `vercel_webhook` is handled only at subscription time; deliveries are not filtered here.
 */
export function isVercelEventMatch(triggerId: string, eventType: string | undefined): boolean {
  if (triggerId === 'vercel_webhook') {
    return true
  }
  const expected = VERCEL_TRIGGER_EVENT_TYPES[triggerId]
  if (!expected) {
    return false
  }
  return eventType === expected
}

/**
 * Generates setup instructions for Vercel webhooks.
 * Webhooks are automatically created via the Vercel API.
 */
export function vercelSetupInstructions(eventType: string): string {
  const instructions = [
    'Enter your Vercel Access Token above.',
    'You can create a token at <strong>Vercel Dashboard > Settings > Tokens</strong>.',
    `Click <strong>"Save Configuration"</strong> to automatically create the webhook in Vercel for <strong>${eventType}</strong> events.`,
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
 * Vercel-specific extra fields for triggers.
 * Includes API token (required) and optional project/team filters.
 */
export function buildVercelExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'apiKey',
      title: 'Access Token',
      type: 'short-input' as const,
      placeholder: 'Enter your Vercel access token',
      description: 'Required to create the webhook in Vercel.',
      password: true,
      required: true,
      paramVisibility: 'user-only',
      mode: 'trigger' as const,
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'teamId',
      title: 'Team ID (Optional)',
      type: 'short-input' as const,
      placeholder: 'team_xxxxx (leave empty for personal account)',
      description: 'Scope webhook to a specific team',
      mode: 'trigger' as const,
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'filterProjectIds',
      title: 'Project IDs (Optional)',
      type: 'short-input' as const,
      placeholder: 'prj_xxx,prj_yyy (comma-separated)',
      description: 'Limit webhook to specific projects',
      mode: 'trigger' as const,
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

/**
 * Core outputs present in all Vercel webhook payloads
 */
const coreOutputs = {
  type: {
    type: 'string',
    description: 'Event type (e.g., deployment.created)',
  },
  id: {
    type: 'string',
    description: 'Unique webhook delivery ID (string)',
  },
  createdAt: {
    type: 'number',
    description: 'Event timestamp in milliseconds',
  },
  region: {
    type: 'string',
    description: 'Region where the event occurred',
  },
} as const

/** Raw `payload` object from the Vercel webhook body (event-specific shape). */
const payloadOutput = {
  payload: { type: 'json' as const, description: 'Raw event payload from Vercel' },
} as const

/**
 * Dashboard deep links included on many deployment webhook events (Vercel Webhooks API).
 */
const linksOutputs = {
  links: {
    deployment: {
      type: 'string',
      description: 'Vercel Dashboard URL for the deployment',
    },
    project: {
      type: 'string',
      description: 'Vercel Dashboard URL for the project',
    },
  },
  regions: {
    type: 'json',
    description: 'Regions associated with the deployment (array), when provided by Vercel',
  },
} as const

/** Normalized deployment object from `formatInput` (null when no deployment on the event). */
const deploymentResourceOutputs = {
  deployment: {
    id: { type: 'string', description: 'Deployment ID' },
    url: { type: 'string', description: 'Deployment URL' },
    name: { type: 'string', description: 'Deployment name' },
    meta: {
      type: 'json',
      description: 'Deployment metadata map (e.g. Git metadata), per Vercel Webhooks API',
    },
  },
} as const

/**
 * Deployment-specific output fields
 */
const deploymentOutputs = {
  ...linksOutputs,
  ...deploymentResourceOutputs,
  project: {
    id: { type: 'string', description: 'Project ID' },
    name: { type: 'string', description: 'Project name' },
  },
  team: {
    id: { type: 'string', description: 'Team ID' },
  },
  user: {
    id: { type: 'string', description: 'User ID' },
  },
  target: {
    type: 'string',
    description: 'Deployment target (production, staging, or preview)',
  },
  plan: {
    type: 'string',
    description: 'Account plan type',
  },
  domain: {
    name: { type: 'string', description: 'Domain name' },
    delegated: {
      type: 'boolean',
      description: 'Whether the domain was delegated/shared when present on the payload',
    },
  },
} as const

const deploymentTargetPlanDomain = {
  target: deploymentOutputs.target,
  plan: deploymentOutputs.plan,
  domain: deploymentOutputs.domain,
} as const

/**
 * Project-specific output fields
 */
const projectOutputs = {
  project: {
    id: { type: 'string', description: 'Project ID' },
    name: { type: 'string', description: 'Project name' },
  },
  team: {
    id: { type: 'string', description: 'Team ID' },
  },
  user: {
    id: { type: 'string', description: 'User ID' },
  },
} as const

/**
 * Domain-specific output fields
 */
const domainOutputs = {
  domain: {
    name: { type: 'string', description: 'Domain name' },
    delegated: {
      type: 'boolean',
      description:
        'Whether the domain was delegated/shared (domain.created), per Vercel Webhooks API',
    },
  },
  project: {
    id: { type: 'string', description: 'Project ID' },
  },
  team: {
    id: { type: 'string', description: 'Team ID' },
  },
  user: {
    id: { type: 'string', description: 'User ID' },
  },
} as const

/**
 * Build outputs for deployment events
 */
export function buildDeploymentOutputs(): Record<string, TriggerOutput> {
  return {
    ...coreOutputs,
    ...payloadOutput,
    ...deploymentOutputs,
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for project events
 */
export function buildProjectOutputs(): Record<string, TriggerOutput> {
  return {
    ...coreOutputs,
    ...payloadOutput,
    ...linksOutputs,
    ...deploymentResourceOutputs,
    ...projectOutputs,
    ...deploymentTargetPlanDomain,
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for domain events
 */
export function buildDomainOutputs(): Record<string, TriggerOutput> {
  return {
    ...coreOutputs,
    ...payloadOutput,
    ...linksOutputs,
    ...deploymentResourceOutputs,
    ...deploymentTargetPlanDomain,
    ...domainOutputs,
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for the generic webhook (all events)
 */
export function buildVercelOutputs(): Record<string, TriggerOutput> {
  return {
    ...coreOutputs,
    payload: { type: 'json', description: 'Full event payload' },
    ...linksOutputs,
    ...deploymentResourceOutputs,
    project: deploymentOutputs.project,
    team: deploymentOutputs.team,
    user: deploymentOutputs.user,
    ...deploymentTargetPlanDomain,
  } as Record<string, TriggerOutput>
}
