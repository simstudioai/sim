import { OnePasswordIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const OnePasswordBlockDisplay = {
  type: 'onepassword',
  name: '1Password',
  description: 'Manage secrets and items in 1Password vaults',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: OnePasswordIcon,
  longDescription:
    'Access and manage secrets stored in 1Password vaults using the Connect API or Service Account SDK. List vaults, retrieve items with their fields and secrets, create new items, update existing ones, delete items, and resolve secret references.',
  docsLink: 'https://docs.sim.ai/integrations/onepassword',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay

export const OnePasswordBlockMeta = {
  tags: ['secrets-management', 'identity'],
  url: 'https://1password.com',
  templates: [
    {
      icon: OnePasswordIcon,
      title: '1Password vault audit',
      prompt:
        'Build a scheduled monthly workflow that scans 1Password vaults for weak or reused passwords, expired items, and unused secrets, and writes a remediation queue.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
    },
    {
      icon: OnePasswordIcon,
      title: '1Password offboarding sweep',
      prompt:
        'Create a workflow that on a Workday termination rotates the shared 1Password secrets the departing employee had access to, updates the affected items, and writes the action log.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: OnePasswordIcon,
      title: '1Password access-review automator',
      prompt:
        'Build a scheduled quarterly workflow that inventories 1Password items per vault, requires owner re-attestation in Slack, and writes the audit log to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: OnePasswordIcon,
      title: '1Password secret rotation watcher',
      prompt:
        'Create a scheduled workflow that finds 1Password items older than the rotation policy, opens a Linear ticket per item to rotate, and writes the rotation status back.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: OnePasswordIcon,
      title: '1Password onboarding kit',
      prompt:
        'Build a workflow that when a new hire is provisioned creates their starter 1Password items based on role and team, and writes the access record to the onboarding table.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: OnePasswordIcon,
      title: '1Password Slack secret-share guard',
      prompt:
        'Create a workflow that monitors Slack for accidental secret sharing, redacts the message, and posts a polite reminder to use 1Password Secret Sharing instead.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'communication'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: OnePasswordIcon,
      title: '1Password compliance reporter',
      prompt:
        'Build a scheduled workflow that produces a 1Password compliance report — item counts, ages, and categories per vault — and writes the report file for auditors.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
  ],
  skills: [
    {
      name: 'fetch-secret-for-runtime',
      description:
        'Retrieve a secret (API key, token, or credential) from a 1Password vault to pass into a downstream step.',
      content:
        '# Fetch Secret for Runtime\n\nSecurely read a credential from 1Password so a later step can authenticate without hardcoding it.\n\n## Steps\n1. Identify the vault and item that holds the needed secret.\n2. Read the specific field (password, token, or key) from that item.\n3. Pass the value to the downstream tool or request that needs it.\n\n## Output\nConfirm the secret was retrieved without printing its value. Never echo, log, or include the raw secret in any summary or message.',
    },
    {
      name: 'audit-vault-items',
      description:
        'List items in a 1Password vault and report metadata like titles, categories, and last-updated dates.',
      content:
        '# Audit Vault Items\n\nProduce an inventory of items in a 1Password vault for review.\n\n## Steps\n1. List the items in the specified vault.\n2. For each item collect non-sensitive metadata: title, category, tags, and last-updated date.\n3. Flag items that look stale or duplicated based on titles and dates.\n\n## Output\nA table of items with metadata only. Do not retrieve or display any secret values, just the item references.',
    },
    {
      name: 'create-credential-item',
      description:
        'Store a new credential (login, API key, or token) as an item in a 1Password vault.',
      content:
        '# Create Credential Item\n\nSave a new secret into 1Password so it is centrally managed.\n\n## Steps\n1. Determine the target vault and the item category (login, API credential, secure note).\n2. Set the title and the secret fields from the provided values.\n3. Create the item in the vault.\n\n## Output\nConfirm the item was created with its title and vault. Do not repeat the secret value back in the response.',
    },
  ],
} as const satisfies BlockMeta
