import 'server-only'
import type { ShellData } from '@/app/(product)/_components/model'
import type { Scenario } from '@/platform/fixtures'
import { workspaceHomePath } from '@/platform/lib/workspace-navigation'

type ShellDetails = Omit<ShellData, 'chats'>

const leadEnrichment = { id: 'lead-enrichment', name: 'Lead enrichment' }
const accountReview = { id: 'account-review', name: 'Account review', folder: 'Operations' }
const workflowsByWorkspace: Record<string, ShellData['workspaces'][number]['workflows']> = {
  operations: [leadEnrichment, accountReview],
  revenue: [leadEnrichment],
  finance: [accountReview],
}

const full: ShellDetails = {
  organization: { name: 'Sim Enterprise', memberCount: 5 },
  user: { name: 'Emir Karabeg' },
  workspaces: [
    ['operations', 'Workspace'],
    ['revenue', 'Revenue operations'],
    ['finance', 'Finance'],
    ['marketing', 'Marketing'],
    ['people', 'People operations'],
    ['onboarding', 'Customer onboarding'],
    ['sales', 'Sales development'],
    ['product', 'Product operations'],
    ['engineering', 'Engineering'],
    ['legal', 'Legal & compliance'],
    ['it', 'IT operations'],
    ['analytics', 'Data & analytics'],
    ['procurement', 'Procurement'],
    ['partners', 'International partnerships & channel operations'],
    ['success', 'Customer success'],
    ['security', 'Security'],
    ['business', 'Business operations'],
    ['executive', 'Executive office'],
    ['intelligence', 'Revenue intelligence'],
    ['tools', 'Internal tools'],
  ].map(([id, name]) => ({
    id,
    name,
    href: workspaceHomePath(id, 'fixture'),
    workflows: workflowsByWorkspace[id] ?? [],
  })),
  inbox: [
    {
      id: 'approval',
      title: 'Review the onboarding process',
      description: 'Approval requested in Wiki',
      icon: 'I082',
      unread: true,
      href: '/home',
    },
    {
      id: 'connection',
      title: 'Reconnect Salesforce',
      description: 'Connection expired',
      icon: 'I084',
      unread: true,
      href: '/integrations/salesforce',
    },
    {
      id: 'renewal',
      title: 'Review the renewal brief',
      description: 'Due tomorrow at 9:00 AM',
      icon: 'I046',
      unread: false,
      href: '/chat/weekly-review',
    },
  ],
  notifications: [
    {
      id: 'workspace',
      title: 'Workspace updated',
      description: 'Customer operations and international onboarding',
      icon: 'I072',
      action: 'Open',
      href: '/home',
    },
    {
      id: 'sync',
      title: 'Syncing knowledge',
      description: '128 of 360 documents',
      icon: 'I014',
      action: 'View',
      href: '/home',
    },
  ],
}

export const shellScenarios: Record<Scenario, ShellDetails> = {
  empty: {
    ...full,
    organization: { name: 'Sim Enterprise', memberCount: 1 },
    workspaces: [],
    inbox: [],
    notifications: [],
  },
  full,
  stress: {
    ...full,
    workspaces: Array.from({ length: 36 }, (_, index) => ({
      id: `workspace-${index}`,
      href: workspaceHomePath(`workspace-${index}`, 'fixture'),
      workflows: [leadEnrichment, accountReview],
      name: `International customer operations and onboarding ${index + 1}`,
    })),
    organization: { name: 'International customer operations and research', memberCount: 178 },
  },
}
