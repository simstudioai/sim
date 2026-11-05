import 'server-only'
import type { ShellData } from '@/platform/app/(shell)/_components/model'
import type { Scenario } from '@/platform/fixtures'

type ShellDetails = Omit<ShellData, 'chats' | 'workspaces'>

const full: ShellDetails = {
  organization: { name: 'Sim Enterprise', memberCount: 5 },
  user: { name: 'Emir Karabeg' },
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

export const shellScenarios: Record<Scenario, ShellDetails> = {
  empty: {
    ...full,
    organization: { name: 'Sim Enterprise', memberCount: 1 },
    inbox: [],
    notifications: [],
  },
  full,
  stress: {
    ...full,
    organization: { name: 'International customer operations and research', memberCount: 178 },
  },
}
