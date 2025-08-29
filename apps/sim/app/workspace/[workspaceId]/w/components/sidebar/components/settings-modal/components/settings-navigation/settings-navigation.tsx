import {
  Bot,
  CreditCard,
  FileCode,
  Key,
  Settings,
  Shield,
  User,
  Users,
  Waypoints,
} from 'lucide-react'
import { getEnv, isTruthy } from '@/lib/env'
import { isHosted } from '@/lib/environment'
import { cn } from '@/lib/utils'

const isBillingEnabled = isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))

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
      | 'copilot'
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
    | 'copilot'
    | 'privacy'
  label: string
  icon: React.ComponentType<{ className?: string }>
  hideWhenBillingDisabled?: boolean
  requiresTeam?: boolean
}

const allNavigationItems: NavigationItem[] = [
  {
    id: 'general',
    label: 'General',
    icon: Settings,
  },
  {
    id: 'credentials',
    label: 'Integrations',
    icon: Waypoints,
  },
  {
    id: 'environment',
    label: 'Environment',
    icon: FileCode,
  },
  {
    id: 'account',
    label: 'Account',
    icon: User,
  },
  {
    id: 'apikeys',
    label: 'API Keys',
    icon: Key,
  },
  {
    id: 'copilot',
    label: 'Copilot Keys',
    icon: Bot,
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
    hideWhenBillingDisabled: true,
  },
  {
    id: 'team',
    label: 'Team',
    icon: Users,
    hideWhenBillingDisabled: true,
    requiresTeam: true,
  },
]

export function SettingsNavigation({
  activeSection,
  onSectionChange,
  hasOrganization,
}: SettingsNavigationProps) {
  const navigationItems = allNavigationItems.filter((item) => {
    if (item.id === 'copilot' && !isHosted) {
      return false
    }
    if (item.hideWhenBillingDisabled && !isBillingEnabled) {
      return false
    }

    // Hide team tab if user doesn't have an active organization
    if (item.requiresTeam && !hasOrganization) {
      return false
    }

    return true
  })

  return (
    <div className='px-2 py-4'>
      {navigationItems.map((item) => (
        <div key={item.id} className='mb-1'>
          <button
            onClick={() => onSectionChange(item.id)}
            className={cn(
              'group flex h-9 w-full cursor-pointer items-center rounded-[8px] px-2 py-2 font-medium font-sans text-sm transition-colors',
              activeSection === item.id ? 'bg-muted' : 'hover:bg-muted'
            )}
          >
            <item.icon
              className={cn(
                'mr-2 h-[14px] w-[14px] flex-shrink-0 transition-colors',
                activeSection === item.id
                  ? 'text-foreground'
                  : 'text-muted-foreground group-hover:text-foreground'
              )}
            />
            <span
              className={cn(
                'min-w-0 flex-1 select-none truncate pr-1 text-left transition-colors',
                activeSection === item.id
                  ? 'text-foreground'
                  : 'text-muted-foreground group-hover:text-foreground'
              )}
            >
              {item.label}
            </span>
          </button>
        </div>
      ))}
    </div>
  )
}
