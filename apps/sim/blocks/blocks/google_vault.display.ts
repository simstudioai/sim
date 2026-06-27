import { ShieldCheck } from '@/components/emcn/icons'
import { GoogleVaultIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GoogleVaultBlockDisplay = {
  type: 'google_vault',
  name: 'Google Vault',
  description: 'Search, export, and manage holds/exports for Vault matters',
  category: 'tools',
  bgColor: '#E8F0FE',
  icon: GoogleVaultIcon,
  longDescription:
    'Connect Google Vault to create exports, list exports, and manage holds within matters.',
  docsLink: 'https://developers.google.com/vault',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay

export const GoogleVaultBlockMeta = {
  tags: ['google-workspace', 'document-processing'],
  url: 'https://support.google.com/vault',
  templates: [
    {
      icon: ShieldCheck,
      title: 'Google Vault legal hold automator',
      prompt:
        'Build a scheduled workflow that polls Salesforce for new legal-hold instructions, creates a Google Vault matter and hold for the named custodians, and notifies legal with the hold details.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: ShieldCheck,
      title: 'Google Vault hold auditor',
      prompt:
        'Create a scheduled workflow that lists Google Vault matters and holds, flags custodians missing expected holds, and writes the findings to a compliance review table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: ShieldCheck,
      title: 'Google Vault eDiscovery exporter',
      prompt:
        'Build a workflow that takes an eDiscovery request, runs a Google Vault search, exports the matters into structured archives, and writes the export manifest.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: ShieldCheck,
      title: 'Google Vault hold reviewer',
      prompt:
        'Create a scheduled workflow that lists Google Vault holds across matters, summarizes their custodians and scope, and writes a review report for the legal team to approve.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: ShieldCheck,
      title: 'Google Vault sensitive-term exporter',
      prompt:
        'Build a scheduled workflow that creates Google Vault exports for sensitive search terms weekly, downloads the export results, and writes the matching items to a compliance review queue.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
    {
      icon: ShieldCheck,
      title: 'Google Vault export archiver',
      prompt:
        'Create a scheduled workflow that creates Google Vault matter exports, downloads the export files, archives them to S3 long-term storage, and writes the manifest to a compliance table.',
      modules: ['scheduled', 'tables', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['s3'],
    },
    {
      icon: ShieldCheck,
      title: 'Google Vault custodian dashboard',
      prompt:
        'Build a scheduled monthly workflow that summarizes Google Vault holds and custodians, generates a status dashboard, and writes it to a legal review file.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
  ],
  skills: [
    {
      name: 'open-legal-hold',
      description:
        'Create a Vault matter and place a legal hold on custodians for an investigation or litigation.',
      content:
        '# Open Legal Hold\n\nStand up a Vault matter and preserve data for the relevant custodians.\n\n## Steps\n1. Create a matter with a clear name and description tied to the case or investigation.\n2. List existing matters first to avoid creating a duplicate for the same case.\n3. Create a hold on the matter for the named custodians and the relevant service (mail, Drive, etc.).\n4. List holds on the matter to confirm the custodians were preserved.\n\n## Output\nReturn the matterId, the holdId, and the list of custodians now under hold. Note any custodian that could not be added.',
    },
    {
      name: 'run-discovery-export',
      description:
        'Create a Vault export for a matter using a search query, then retrieve the export files.',
      content:
        '# Run Discovery Export\n\nProduce an export of matching data for eDiscovery or compliance review.\n\n## Steps\n1. Identify or create the matter for the export.\n2. Create an export with the search query, date range, and target accounts/org unit scoped as narrowly as possible.\n3. List exports on the matter and poll until the new export status is completed.\n4. Download the export files once the export is ready.\n\n## Output\nReturn the exportId, its status, and the downloaded file references. Summarize the query and scope used so the export is auditable.',
    },
    {
      name: 'audit-active-holds',
      description:
        'List Vault matters and their holds to produce a custodian preservation status report.',
      content:
        '# Audit Active Holds\n\nGenerate a status report of which matters and custodians are currently preserved.\n\n## Steps\n1. List all matters and capture their IDs, names, and states.\n2. For each open matter, list its holds and the custodians and services covered.\n3. Flag matters with no holds and custodians that appear across multiple matters.\n\n## Output\nReturn a per-matter summary listing holds, services, and custodians, plus a flagged section for matters missing holds. Suitable for a monthly legal review.',
    },
  ],
} as const satisfies BlockMeta
