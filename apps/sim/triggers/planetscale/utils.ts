import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/** Documented production events; webhook.test is an authenticated reachability probe. */
const PLANETSCALE_EVENTS = [
  { id: 'branch.anomaly', label: 'Branch Anomaly (Vitess, Neki, Postgres)' },
  { id: 'branch.out_of_memory', label: 'Branch Out of Memory (Postgres)' },
  { id: 'branch.primary_promoted', label: 'Branch Primary Promoted (Postgres)' },
  { id: 'branch.ready', label: 'Branch Ready (Vitess, Neki, Postgres)' },
  { id: 'branch.sleeping', label: 'Branch Sleeping (Vitess, Neki, Postgres)' },
  { id: 'branch.start_maintenance', label: 'Branch Start Maintenance (Vitess, Neki, Postgres)' },
  { id: 'backup.failed', label: 'Backup Failed (Vitess, Neki, Postgres)' },
  { id: 'backup.succeeded', label: 'Backup Succeeded (Vitess, Neki, Postgres)' },
  { id: 'deploy_request.opened', label: 'Deploy Request Opened (Vitess)' },
  { id: 'deploy_request.queued', label: 'Deploy Request Queued (Vitess)' },
  { id: 'deploy_request.in_progress', label: 'Deploy Request In Progress (Vitess)' },
  { id: 'deploy_request.pending_cutover', label: 'Deploy Request Pending Cutover (Vitess)' },
  { id: 'deploy_request.schema_applied', label: 'Deploy Request Schema Applied (Vitess)' },
  { id: 'deploy_request.errored', label: 'Deploy Request Errored (Vitess)' },
  { id: 'deploy_request.reverted', label: 'Deploy Request Reverted (Vitess)' },
  { id: 'deploy_request.closed', label: 'Deploy Request Closed (Vitess)' },
  { id: 'cluster.storage', label: 'Cluster Storage (Postgres)' },
  { id: 'database.access_request', label: 'Database Access Request (Vitess, Neki, Postgres)' },
  { id: 'keyspace.storage', label: 'Keyspace Storage (Vitess)' },
] as const

export const planetscaleTriggerOptions = [
  ...PLANETSCALE_EVENTS.slice(0, 16).map((event) => ({
    id: `planetscale_${event.id.replace('.', '_')}`,
    label: event.label,
  })),
  { id: 'planetscale_webhook', label: 'Selected Events' },
]

/** Validates the literal event selection used for registration and delivery filtering. */
export function getPlanetScaleEvents(config: Record<string, unknown>): string[] {
  if (config.triggerId !== 'planetscale_webhook') {
    const event = PLANETSCALE_EVENTS.slice(0, 16).find(
      (item) => `planetscale_${item.id.replace('.', '_')}` === config.triggerId
    )
    if (!event) throw new Error('Select a supported PlanetScale trigger.')
    return [event.id]
  }
  const events = config.events
  if (
    !Array.isArray(events) ||
    events.length === 0 ||
    events.some((value) => !PLANETSCALE_EVENTS.some((event) => event.id === value))
  ) {
    throw new Error('Select at least one supported PlanetScale production event.')
  }
  return [...new Set(events)]
}

export function planetscaleSetupInstructions(eventLabel: string): string {
  return [
    'Create an organization <strong>service token</strong> with <code>read_database</code> and <code>write_database</code> permissions for the database.',
    'Enter the <strong>Service Token ID</strong>, <strong>Service Token</strong>, and <strong>Organization</strong>, then select a database. Sim environment references are supported.',
    `Deploy the workflow to register <strong>${eventLabel}</strong> automatically. PlanetScale requires a publicly reachable HTTPS webhook URL.`,
    'Undeploy to remove the subscription. PlanetScale allows five webhooks per database; updating a deployed trigger temporarily needs another slot.',
  ]
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

export function buildPlanetScaleExtraFields(triggerId: string): SubBlockConfig[] {
  const condition = { field: 'selectedTriggerId', value: triggerId }
  return [
    {
      id: 'triggerServiceTokenId',
      title: 'Service Token ID',
      type: 'short-input',
      canonicalParamId: 'serviceTokenId',
      password: true,
      paramVisibility: 'user-only',
      required: true,
      mode: 'trigger',
      condition,
    },
    {
      id: 'triggerServiceToken',
      title: 'Service Token',
      type: 'short-input',
      canonicalParamId: 'serviceToken',
      password: true,
      paramVisibility: 'user-only',
      required: true,
      mode: 'trigger',
      condition,
    },
    {
      id: 'triggerOrganization',
      title: 'Organization',
      type: 'short-input',
      canonicalParamId: 'organization',
      placeholder: 'Organization slug',
      required: true,
      mode: 'trigger',
      condition,
    },
    {
      id: 'triggerDatabaseSelector',
      title: 'Database',
      type: 'file-selector',
      canonicalParamId: 'database',
      selectorKey: 'planetscale.databases',
      dependsOn: ['triggerServiceTokenId', 'triggerServiceToken', 'triggerOrganization'],
      placeholder: 'Select database',
      required: true,
      mode: 'trigger',
      condition,
    },
    {
      id: 'triggerManualDatabase',
      title: 'Database Name',
      type: 'short-input',
      canonicalParamId: 'database',
      placeholder: 'Database name',
      required: true,
      mode: 'trigger-advanced',
      condition,
    },
    ...(triggerId === 'planetscale_webhook'
      ? [
          {
            id: 'events',
            title: 'Events',
            type: 'dropdown' as const,
            multiSelect: true,
            options: [...PLANETSCALE_EVENTS],
            defaultValue: ['branch.ready'],
            required: true,
            mode: 'trigger' as const,
            condition,
          },
        ]
      : []),
  ]
}

const commonOutputs = {
  event: { type: 'string', description: 'Documented PlanetScale event name' },
  timestamp: { type: 'number', description: 'Provider event time in Unix seconds' },
  organization: { type: 'string', description: 'Organization slug' },
  database: { type: 'string', description: 'Database name' },
  payload: { type: 'json', description: 'Complete original signed webhook payload' },
} as const
const identityOutputs = {
  id: { type: 'string', description: 'Resource ID' },
  name: { type: 'string', description: 'Resource name' },
  state: { type: 'string', description: 'Current resource state' },
  createdAt: { type: 'string', description: 'Creation time, or null when unavailable' },
  updatedAt: { type: 'string', description: 'Update time, or null when unavailable' },
} as const

export function buildPlanetScaleOutputs(
  family: 'branch' | 'backup' | 'deploy_request' | 'webhook'
): Record<string, TriggerOutput> {
  if (family === 'webhook')
    return {
      ...commonOutputs,
      resource: { type: 'json', description: 'Original event-specific resource' },
    }
  if (family === 'branch')
    return {
      ...commonOutputs,
      resource: {
        ...identityOutputs,
        ready: { type: 'boolean', description: 'Whether the branch is ready' },
        production: { type: 'boolean', description: 'Whether this is a production branch' },
        safeMigrations: { type: 'boolean', description: 'Whether safe migrations are enabled' },
        parentBranch: { type: 'string', description: 'Parent branch name, or null' },
        htmlUrl: { type: 'string', description: 'PlanetScale branch URL, or null' },
      },
    }
  if (family === 'backup')
    return {
      ...commonOutputs,
      resource: {
        ...identityOutputs,
        size: { type: 'number', description: 'Backup size in bytes, or null' },
        protected: { type: 'boolean', description: 'Whether the backup is protected' },
        startedAt: { type: 'string', description: 'Start time, or null' },
        completedAt: { type: 'string', description: 'Completion time, or null' },
        expiresAt: { type: 'string', description: 'Expiry time, or null' },
        branch: {
          id: { type: 'string', description: 'Database branch ID, or null' },
          name: { type: 'string', description: 'Database branch name, or null' },
        },
      },
    }
  return {
    ...commonOutputs,
    resource: {
      id: identityOutputs.id,
      state: identityOutputs.state,
      createdAt: identityOutputs.createdAt,
      updatedAt: identityOutputs.updatedAt,
      number: { type: 'number', description: 'Database-scoped deploy request number' },
      branch: { type: 'string', description: 'Source branch name' },
      intoBranch: { type: 'string', description: 'Target branch name' },
      deploymentState: { type: 'string', description: 'Current deployment state' },
      approved: { type: 'boolean', description: 'Whether the request is approved' },
      numComments: { type: 'number', description: 'Number of comments' },
      notes: { type: 'string', description: 'Deploy request notes' },
      closedAt: { type: 'string', description: 'Close time, or null' },
      deployedAt: { type: 'string', description: 'Deployment time, or null' },
      htmlUrl: { type: 'string', description: 'PlanetScale deploy request URL' },
    },
  }
}
