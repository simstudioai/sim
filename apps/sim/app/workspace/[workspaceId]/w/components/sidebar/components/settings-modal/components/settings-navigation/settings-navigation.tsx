import {
  CreditCard,
  KeyRound,
  KeySquare,
  Lock,
  Settings,
  Shield,
  UserCircle,
  Users,
} from 'lucide-react'
import { isDev } from '@/lib/environment'
import { cn } from '@/lib/utils'
import { useSubscriptionStore } from '@/stores/subscription/store'

interface SettingsNavigationProps {
  activeSection: string
  onSectionChange: (
    section:
      | 'general'
      | 'environment'
      | 'account'
      | 'credentials'
      | 'apikeys'
      | 'subscription'
      | 'team'
      | 'privacy'
  ) => void
  hasOrganization: boolean
}

type NavigationItem = {
  id:
    | 'general'
    | 'environment'
    | 'account'
    | 'credentials'
    | 'apikeys'
    | 'subscription'
    | 'team'
    | 'privacy'
  label: string
  icon: React.ComponentType<{ className?: string }>
  hideInDev?: boolean
  requiresTeam?: boolean
}

const allNavigationItems: NavigationItem[] = [
  {
    id: 'general',
    label: 'General',
    icon: Settings,
  },
  {
    id: 'environment',
    label: 'Environment',
    icon: KeyRound,
  },
  {
    id: 'account',
    label: 'Account',
    icon: UserCircle,
  },
  {
    id: 'credentials',
    label: 'Credentials',
    icon: Lock,
  },
  {
    id: 'apikeys',
    label: 'API Keys',
    icon: KeySquare,
  },
  {
    id: 'privacy',
    label: 'Privacy',
    icon: Shield,
  },
  {
    id: 'subscription',
    label: 'Subscription',
    icon: CreditCard,
    hideInDev: true,
  },
  {
    id: 'team',
    label: 'Team',
    icon: Users,
    hideInDev: true,
    requiresTeam: true,
  },
]

export function SettingsNavigation({
  activeSection,
  onSectionChange,
  hasOrganization,
}: SettingsNavigationProps) {
  const { getSubscriptionStatus } = useSubscriptionStore()
  const subscription = getSubscriptionStatus()

  const navigationItems = allNavigationItems.filter((item) => {
    if (item.hideInDev && isDev) {
      return false
    }

    // Hide team tab if user doesn't have team or enterprise subscription
    if (item.requiresTeam && !subscription.isTeam && !subscription.isEnterprise) {
      return false
    }

    return true
  })

  return (
    <div className='py-4'>
      {navigationItems.map((item) => (
        <button
          key={item.id}
          onClick={() => onSectionChange(item.id)}
          className={cn(
            'flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors',
            'hover:bg-muted/50',
            activeSection === item.id
              ? 'bg-muted/50 font-medium text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <item.icon className='h-4 w-4' />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}
