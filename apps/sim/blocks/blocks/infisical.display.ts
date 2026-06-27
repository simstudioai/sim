import { InfisicalIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const InfisicalBlockDisplay = {
  type: 'infisical',
  name: 'Infisical',
  description: 'Manage secrets with Infisical',
  category: 'tools',
  bgColor: '#F7FE62',
  icon: InfisicalIcon,
  longDescription:
    'Integrate Infisical into your workflow. List, get, create, update, and delete secrets across project environments.',
  docsLink: 'https://docs.sim.ai/integrations/infisical',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay

export const InfisicalBlockMeta = {
  tags: ['secrets-management'],
  url: 'https://infisical.com',
  templates: [
    {
      icon: InfisicalIcon,
      title: 'Infisical secret rotation orchestrator',
      prompt:
        'Build a scheduled workflow that lists Infisical secrets, generates fresh values for those due for rotation, updates them across each environment, and writes rotation status to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise'],
    },
    {
      icon: InfisicalIcon,
      title: 'Infisical environment drift detector',
      prompt:
        'Create a scheduled workflow that diffs Infisical environments against expected schemas, alerts on missing or extra secrets, and writes a remediation queue.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: InfisicalIcon,
      title: 'Infisical env bootstrapper',
      prompt:
        'Build a workflow that on a Workday new-hire event creates the standard set of Infisical secrets for the new engineer’s scoped dev environment from a template, and writes the provisioning record to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: InfisicalIcon,
      title: 'Infisical offboarding rotation',
      prompt:
        'Create a workflow that on a Workday termination rotates the shared Infisical secrets the departing engineer had access to by generating new values and updating them across environments, then writes the action log to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: InfisicalIcon,
      title: 'Infisical CI sync',
      prompt:
        'Build a workflow that mirrors Infisical secrets into GitHub Actions environments for CI deploys, keeping the secret store as the single source of truth.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'sync'],
      alsoIntegrations: ['github'],
    },
    {
      icon: InfisicalIcon,
      title: 'Infisical secret-inventory reviewer',
      prompt:
        'Create a scheduled quarterly workflow that lists Infisical secrets per project and environment, flags ones with weak or aged values for owner attestation in Slack, and writes the review to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: InfisicalIcon,
      title: 'Infisical secret-inventory snapshot',
      prompt:
        'Build a scheduled workflow that lists Infisical secrets across environments, writes a redacted inventory snapshot to S3 for long-term retention, and tracks secret count trends in a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['s3'],
    },
  ],
  skills: [
    {
      name: 'fetch-secret-for-run',
      description:
        'Retrieve a named secret from Infisical to use as a credential during a workflow run.',
      content:
        '# Fetch a Secret for a Run\n\nPull a single secret from Infisical so a downstream step can authenticate without hardcoding credentials.\n\n## Steps\n1. Identify the project, environment (e.g. dev, staging, prod), and secret path.\n2. Get the secret by name from that scope.\n3. Pass the value to the consuming step. Never echo the raw secret into logs or output.\n\n## Output\nConfirm the secret was retrieved (by name and environment) and that it was used. Do not print the secret value itself.',
    },
    {
      name: 'rotate-secret',
      description: 'Update an existing secret in Infisical with a new value as part of a rotation.',
      content:
        '# Rotate a Secret\n\nReplace a secret value in Infisical during a credential rotation.\n\n## Steps\n1. Confirm the project, environment, and secret name to rotate.\n2. Update the secret with the new value at that path.\n3. Optionally read the secret back by name to confirm it now exists (without printing the value).\n\n## Output\nConfirm the secret name and environment that was rotated and the timestamp. Never expose the old or new value.',
    },
    {
      name: 'audit-environment-secrets',
      description:
        'List the secret names present in an Infisical environment for an inventory or audit.',
      content:
        '# Audit Environment Secrets\n\nProduce an inventory of which secrets exist in an Infisical environment without exposing their values.\n\n## Steps\n1. Choose the project, environment, and path to audit.\n2. List secrets at that scope and collect only the keys and metadata.\n3. Compare against the expected set if one is provided and flag missing or unexpected keys.\n\n## Output\nReturn a list of secret names (keys only) with count, and any discrepancies versus the expected set. Never include secret values.',
    },
  ],
} as const satisfies BlockMeta
