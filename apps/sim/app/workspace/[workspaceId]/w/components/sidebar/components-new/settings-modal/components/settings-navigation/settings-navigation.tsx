import { useEffect, useState } from 'react'
import {
  CreditCard,
  FileCode,
  Files,
  Home,
  Key,
  LogIn,
  Palette,
  Server,
  Settings,
  Shield,
  User,
  Users,
  Waypoints,
  Wrench,
} from 'lucide-react'
import { useSession } from '@/lib/auth-client'
import { getEnv, isTruthy } from '@/lib/env'
import { isHosted } from '@/lib/environment'
import { cn } from '@/lib/utils'
import { useOrganizationStore } from '@/stores/organization'
import { useGeneralStore } from '@/stores/settings/general/store'
import { useSubscriptionStore } from '@/stores/subscription/store'

const isBillingEnabled = isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))

interface SettingsNavigationProps {
  activeSection: string
  onSectionChange: (
    section:
      | 'general'
      | 'environment'
      | 'account'
      | 'creator-profile'
      | 'credentials'
      | 'apikeys'
      | 'files'
      | 'subscription'
      | 'team'
      | 'sso'
      | 'privacy'
      | 'copilot'
      | 'mcp'
      | 'custom-tools'
  ) => void
  hasOrganization: boolean
}

type NavigationItem = {
  id:
    | 'general'
    | 'environment'
    | 'account'
    | 'creator-profile'
    | 'credentials'
    | 'apikeys'
    | 'files'
    | 'subscription'
    | 'team'
    | 'sso'
    | 'copilot'
    | 'privacy'
    | 'mcp'
    | 'custom-tools'
  label: string
  icon: React.ComponentType<{ className?: string }>
  hideWhenBillingDisabled?: boolean
  requiresTeam?: boolean
  requiresEnterprise?: boolean
  requiresOwner?: boolean
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
    id: 'mcp',
    label: 'MCP Servers',
    icon: Server,
  },
  {
    id: 'custom-tools',
    label: 'Custom Tools',
    icon: Wrench,
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
    id: 'creator-profile',
    label: 'Creator Profile',
    icon: Palette,
  },
  {
    id: 'apikeys',
    label: 'API Keys',
    icon: Key,
  },
  {
    id: 'files',
    label: 'Files',
    icon: Files,
  },
  // {
  //   id: 'copilot',
  //   label: 'Copilot',
  //   icon: Bot,
  // },
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
  {
    id: 'sso',
    label: 'Single Sign-On',
    icon: LogIn,
    requiresTeam: true,
    requiresEnterprise: true,
    requiresOwner: true,
  },
]

export function SettingsNavigation({
  activeSection,
  onSectionChange,
  hasOrganization,
}: SettingsNavigationProps) {
  const { data: session } = useSession()
  const { hasEnterprisePlan, getUserRole } = useOrganizationStore()
  const userEmail = session?.user?.email
  const userId = session?.user?.id
  const userRole = getUserRole(userEmail)
  const isOwner = userRole === 'owner'
  const isAdmin = userRole === 'admin'
  const canManageSSO = isOwner || isAdmin

  const [isSSOProviderOwner, setIsSSOProviderOwner] = useState<boolean | null>(null)

  useEffect(() => {
    if (!isHosted && userId) {
      fetch('/api/auth/sso/providers')
        .then((res) => {
          if (!res.ok) throw new Error('Failed to fetch providers')
          return res.json()
        })
        .then((data) => {
          const ownsProvider = data.providers?.some((p: any) => p.userId === userId) || false
          setIsSSOProviderOwner(ownsProvider)
        })
        .catch(() => {
          setIsSSOProviderOwner(false)
        })
    } else if (isHosted) {
      setIsSSOProviderOwner(null)
    }
  }, [userId, isHosted])

  const navigationItems = allNavigationItems.filter((item) => {
    if (item.hideWhenBillingDisabled && !isBillingEnabled) {
      return false
    }

    if (item.requiresTeam && !hasOrganization) {
      return false
    }

    if (item.requiresEnterprise && !hasEnterprisePlan) {
      return false
    }

    if (item.id === 'sso') {
      if (isHosted) {
        return hasOrganization && hasEnterprisePlan && canManageSSO
      }
      return isSSOProviderOwner === true
    }

    if (item.requiresOwner && !isOwner) {
      return false
    }

    return true
  })

  const handleHomepageClick = () => {
    window.location.href = '/?from=settings'
  }

  return (
    <div className='flex h-full flex-col'>
      <div className='flex-1 overflow-y-auto px-2 py-4'>
        {navigationItems.map((item) => (
          <div key={item.id} className='mb-1'>
            <button
              onMouseEnter={() => {
                switch (item.id) {
                  case 'general':
                    useGeneralStore.getState().loadSettings()
                    break
                  case 'subscription':
                    useSubscriptionStore.getState().loadData()
                    break
                  case 'team':
                    useOrganizationStore.getState().loadData()
                    break
                  default:
                    break
                }
              }}
              onClick={() => onSectionChange(item.id)}
              data-section={item.id}
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

      {/* Homepage link */}
      {isHosted && (
        <div className='px-2 pb-4'>
          <button
            onClick={handleHomepageClick}
            className='group flex h-9 w-full cursor-pointer items-center rounded-[8px] px-2 py-2 font-medium font-sans text-sm transition-colors hover:bg-muted'
          >
            <Home className='mr-2 h-[14px] w-[14px] flex-shrink-0 text-muted-foreground transition-colors group-hover:text-foreground' />
            <span className='min-w-0 flex-1 select-none truncate pr-1 text-left text-muted-foreground transition-colors group-hover:text-foreground'>
              Homepage
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
