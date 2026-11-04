import 'server-only'
import type { ShellData } from '@/platform/design-system/models/shell'
import type { Scenario } from '@/platform/fixtures'

const full: ShellData = {
  organization: { name: 'Sim Enterprise', memberCount: 5 },
  user: { name: 'Emir Karabeg' },
  workspaces: [
    { id: 'operations', name: 'Customer operations' },
    { id: 'revenue', name: 'Revenue operations' },
    { id: 'finance', name: 'Finance' },
    { id: 'marketing', name: 'Marketing' },
    { id: 'people', name: 'People operations' },
    ...[
      'Customer onboarding',
      'Sales development',
      'Product operations',
      'Engineering',
      'Legal & compliance',
      'IT operations',
      'Data & analytics',
      'Procurement',
      'Partner operations',
      'Customer success',
      'Security',
      'Business operations',
      'Executive office',
      'Revenue intelligence',
      'Internal tools',
    ].map((name) => ({
      id: name.toLowerCase().replaceAll(' & ', '-').replaceAll(' ', '-'),
      name,
      sidebar: false,
    })),
  ],
  chats: [
    { id: 'weekly-review', title: 'Review the renewal brief' },
    { id: 'customer-onboarding', title: 'Customer onboarding' },
    { id: 'october-close', title: 'Prepare October close' },
    { id: 'q4-planning', title: 'Q4 planning' },
  ],
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
      href: '/home',
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

export const shellScenarios: Record<Scenario, ShellData> = {
  empty: {
    ...full,
    organization: { name: 'Sim Enterprise', memberCount: 1 },
    workspaces: [],
    chats: [],
    inbox: [],
    notifications: [],
  },
  full,
  stress: {
    ...full,
    organization: { name: 'International customer operations and research', memberCount: 178 },
    workspaces: Array.from({ length: 36 }, (_, i) => ({
      id: `workspace-${i}`,
      name: `International customer operations and onboarding ${i + 1}`,
    })),
    chats: full.chats.map((chat) => ({
      ...chat,
      title:
        chat.id === 'weekly-review'
          ? 'Review the international customer renewal briefing'
          : chat.title,
    })),
  },
}
