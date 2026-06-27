import { SecretsManagerIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const SecretsManagerBlockDisplay = {
  type: 'secrets_manager',
  name: 'AWS Secrets Manager',
  description: 'Connect to AWS Secrets Manager',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #BD0816 0%, #FF5252 100%)',
  icon: SecretsManagerIcon,
  longDescription:
    'Integrate AWS Secrets Manager into the workflow. Can retrieve, create, update, list, and delete secrets.',
  docsLink: 'https://docs.sim.ai/integrations/secrets_manager',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay

export const SecretsManagerBlockMeta = {
  tags: ['cloud', 'secrets-management'],
  url: 'https://aws.amazon.com/secrets-manager',
  templates: [
    {
      icon: SecretsManagerIcon,
      title: 'Secrets Manager scheduled rotation',
      prompt:
        'Build a scheduled workflow that lists AWS Secrets Manager secrets, generates a new value for each secret past its rotation window, updates it with the new value, and writes the rotation status to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'enterprise'],
    },
    {
      icon: SecretsManagerIcon,
      title: 'Secrets Manager inventory auditor',
      prompt:
        'Create a scheduled workflow that lists all AWS Secrets Manager secrets, flags ones missing descriptions or older than a chosen age, writes a security review, and posts the findings to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SecretsManagerIcon,
      title: 'Secrets Manager stale-secret cleaner',
      prompt:
        'Build a scheduled workflow that lists AWS Secrets Manager secrets, identifies ones created before a chosen cutoff, requests owner approval in Slack, deletes the approved secrets, and writes the cleanup audit.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SecretsManagerIcon,
      title: 'Secrets Manager + Infisical mirror',
      prompt:
        'Create a workflow that mirrors secrets between AWS Secrets Manager and Infisical for cross-cloud applications, normalizes naming, and writes a sync log.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'sync'],
      alsoIntegrations: ['infisical'],
    },
    {
      icon: SecretsManagerIcon,
      title: 'Secrets Manager break-glass retrieval',
      prompt:
        'Build a workflow that gates retrieval of a sensitive AWS Secrets Manager secret behind a Slack approval, captures the requester and justification, fetches the secret only after sign-off, and writes the audit record.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SecretsManagerIcon,
      title: 'Secrets Manager + 1Password bridge',
      prompt:
        'Create a workflow that bridges select AWS Secrets Manager secrets into 1Password for human-shared credentials while keeping access logs aligned for audit.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'sync'],
      alsoIntegrations: ['onepassword'],
    },
    {
      icon: SecretsManagerIcon,
      title: 'Secrets Manager change watcher',
      prompt:
        'Build a scheduled workflow that polls AWS Secrets Manager secret version IDs, compares them against a baseline stored in a table, and pings the security Slack channel when a secret changes unexpectedly.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'rotate-secret-value',
      description:
        'Update a stored secret in AWS Secrets Manager with a new value as part of a rotation flow. Use to push refreshed credentials without manual console edits.',
      content:
        '# Rotate Secret Value\n\nUpdate a secret with a new value.\n\n## Steps\n1. Confirm the target secret exists by getting it (do not log the returned value).\n2. Obtain the new secret value to store, as a string or JSON key/value payload.\n3. Update the secret with the new value, creating a new version.\n4. Verify by getting the secret and checking the updated version metadata, not the raw value.\n\n## Output\nConfirm the secret name and that a new version was created. Never print the secret value itself.',
    },
    {
      name: 'audit-secret-inventory',
      description:
        'List secrets in AWS Secrets Manager and report metadata like last-changed and rotation status. Use for hygiene checks and finding stale secrets.',
      content:
        '# Audit Secret Inventory\n\nReport on the secrets that exist without exposing their values.\n\n## Steps\n1. List secrets to enumerate names, descriptions, and tags.\n2. For each secret of interest, read metadata such as last changed and last rotated dates.\n3. Flag secrets that are stale, undescribed, or appear unused.\n4. Summarize without ever fetching or printing secret values.\n\n## Output\nAn inventory summary: secret names with last-changed and rotation status, and stale or unrotated secrets called out. No secret values.',
    },
    {
      name: 'store-new-secret',
      description:
        'Create a new secret in AWS Secrets Manager from a provided credential or generated value. Use to register app credentials, API keys, or DB passwords centrally.',
      content:
        '# Store New Secret\n\nRegister a new credential in Secrets Manager.\n\n## Steps\n1. Choose a clear hierarchical name for the secret, such as my-app/prod/db-password.\n2. Assemble the value to store — a plain string, or a JSON object of key/value pairs for structured credentials.\n3. Create the secret with that name, value, and a description of what it is and where it is used.\n4. Confirm creation by reading back the version metadata, not the value.\n\n## Output\nConfirm the secret name, ARN, and new version ID. Never echo the stored secret value back.',
    },
    {
      name: 'decommission-secret',
      description:
        'Schedule deletion of a secret in AWS Secrets Manager with a recovery window so it can be restored if needed. Use to retire unused or rotated-out credentials safely.',
      content:
        '# Decommission Secret\n\nRetire a secret without permanently losing it immediately.\n\n## Steps\n1. Confirm the target secret and that nothing still depends on it.\n2. Schedule deletion with a recovery window (e.g. 30 days) so it can be restored during that period; reserve force delete for confirmed-orphaned secrets only.\n3. Record the scheduled deletion date.\n4. Re-list secrets to confirm it is marked for deletion.\n\n## Output\nConfirm the secret name and the scheduled deletion date, or that immediate deletion was requested. Do not print the secret value.',
    },
  ],
} as const satisfies BlockMeta
