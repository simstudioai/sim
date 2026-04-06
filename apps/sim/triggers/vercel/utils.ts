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
  { label: 'Generic Webhook (All Events)', id: 'vercel_webhook' },
]

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
    description: 'Unique webhook delivery ID',
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

/**
 * Deployment-specific output fields
 */
const deploymentOutputs = {
  deployment: {
    id: { type: 'string', description: 'Deployment ID' },
    url: { type: 'string', description: 'Deployment URL' },
    name: { type: 'string', description: 'Deployment name' },
  },
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
    description: 'Deployment target (production, preview)',
  },
  plan: {
    type: 'string',
    description: 'Account plan type',
  },
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
    ...deploymentOutputs,
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for project events
 */
export function buildProjectOutputs(): Record<string, TriggerOutput> {
  return {
    ...coreOutputs,
    ...projectOutputs,
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for domain events
 */
export function buildDomainOutputs(): Record<string, TriggerOutput> {
  return {
    ...coreOutputs,
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
    deployment: {
      id: { type: 'string', description: 'Deployment ID' },
      url: { type: 'string', description: 'Deployment URL' },
      name: { type: 'string', description: 'Deployment name' },
    },
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
      description: 'Deployment target (production, preview)',
    },
    plan: {
      type: 'string',
      description: 'Account plan type',
    },
    domain: {
      name: { type: 'string', description: 'Domain name' },
    },
  } as Record<string, TriggerOutput>
}
