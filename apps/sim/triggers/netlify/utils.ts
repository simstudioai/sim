import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Dropdown options for the Netlify trigger type selector.
 */
export const netlifyTriggerOptions = [
  { label: 'Deploy Created', id: 'netlify_deploy_created' },
  { label: 'Deploy Building', id: 'netlify_deploy_building' },
  { label: 'Deploy Succeeded', id: 'netlify_deploy_succeeded' },
  { label: 'Deploy Failed', id: 'netlify_deploy_failed' },
  { label: 'Deploy Locked', id: 'netlify_deploy_locked' },
  { label: 'Deploy Unlocked', id: 'netlify_deploy_unlocked' },
]

/**
 * Maps Sim trigger IDs to Netlify hook `event` names. Netlify outgoing webhooks
 * require exactly one event per hook, so each trigger creates a single hook.
 */
export const NETLIFY_TRIGGER_EVENT_TYPES: Record<string, string> = {
  netlify_deploy_created: 'deploy_created',
  netlify_deploy_building: 'deploy_building',
  netlify_deploy_succeeded: 'deploy_succeeded',
  netlify_deploy_failed: 'deploy_failed',
  netlify_deploy_locked: 'deploy_locked',
  netlify_deploy_unlocked: 'deploy_unlocked',
}

/**
 * Returns whether the incoming Netlify event matches the configured trigger.
 * Netlify deploy webhooks deliver the deploy object directly (no `type` field),
 * so we rely on the event configured at subscription time and rarely need to
 * cross-check, but we expose the helper for symmetry with other providers.
 */
export function isNetlifyEventMatch(triggerId: string, state: string | undefined): boolean {
  const expected = NETLIFY_TRIGGER_EVENT_TYPES[triggerId]
  if (!expected) {
    return false
  }
  if (!state) {
    return true
  }
  switch (expected) {
    case 'deploy_succeeded':
      return state === 'ready'
    case 'deploy_failed':
      return state === 'error' || state === 'rejected'
    case 'deploy_building':
      return state === 'building'
    default:
      return true
  }
}

/**
 * Generates HTML setup instructions shown inside the trigger config panel.
 */
export function netlifySetupInstructions(eventLabel: string): string {
  const instructions = [
    'Generate a Personal Access Token at <strong>User settings → Applications → Personal access tokens</strong> (<a href="https://app.netlify.com/user/applications#personal-access-tokens" target="_blank" rel="noreferrer">direct link</a>) and paste it above.',
    'Enter the target <strong>Site ID</strong> (or primary domain) of the Netlify site to listen on.',
    `<strong>Deploy</strong> the workflow — Sim will automatically register an outgoing webhook in Netlify for <strong>${eventLabel}</strong> events on the chosen site.`,
    'The webhook is automatically removed from Netlify when you delete this trigger or undeploy the workflow.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Netlify-specific extra fields exposed in trigger configuration.
 */
export function buildNetlifyExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'apiKey',
      title: 'Access Token',
      type: 'short-input' as const,
      placeholder: 'Enter your Netlify Personal Access Token',
      description: 'Required to register and remove the webhook in Netlify.',
      password: true,
      required: true,
      paramVisibility: 'user-only',
      mode: 'trigger' as const,
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'siteId',
      title: 'Site ID',
      type: 'short-input' as const,
      placeholder: 'Site ID or primary domain (e.g., 0d3a9d2f-... or my-site.netlify.app)',
      description: 'The Netlify site whose deploys will trigger this workflow.',
      required: true,
      mode: 'trigger' as const,
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

const coreOutputs = {
  id: { type: 'string', description: 'Deploy ID' },
  siteId: { type: 'string', description: 'Site ID' },
  state: {
    type: 'string',
    description: 'Deploy state at the time of the event (e.g., ready, error, building)',
  },
  name: { type: 'string', description: 'Site name' },
  url: { type: 'string', description: 'Site URL' },
  deployUrl: { type: 'string', description: 'Unique deploy URL' },
  deploySslUrl: { type: 'string', description: 'Unique deploy HTTPS URL' },
  adminUrl: { type: 'string', description: 'Netlify admin URL' },
  branch: { type: 'string', description: 'Git branch' },
  context: {
    type: 'string',
    description: 'Deploy context: production, deploy-preview, branch-deploy',
  },
  commitRef: { type: 'string', description: 'Git commit SHA' },
  commitUrl: { type: 'string', description: 'Git commit URL' },
  title: { type: 'string', description: 'Commit message / deploy title' },
  errorMessage: { type: 'string', description: 'Error message when the deploy failed' },
  createdAt: { type: 'string', description: 'Deploy creation timestamp' },
  updatedAt: { type: 'string', description: 'Last update timestamp' },
  publishedAt: { type: 'string', description: 'Publish timestamp' },
  payload: { type: 'json', description: 'Raw deploy payload from Netlify' },
} as const

/**
 * Build outputs for any Netlify deploy event. The shape of the deploy object
 * is identical across event types — only the `state` field differs.
 */
export function buildNetlifyDeployOutputs(): Record<string, TriggerOutput> {
  return { ...coreOutputs } as Record<string, TriggerOutput>
}
