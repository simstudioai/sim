import { Key, KeyRound, Settings, UserCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SettingsNavigationProps {
  activeSection: string
  onSectionChange: (section: 'general' | 'environment' | 'account' | 'credentials') => void
}

const navigationItems = [
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
    icon: Key,
  },
] as const

export function SettingsNavigation({ activeSection, onSectionChange }: SettingsNavigationProps) {
  return (
    <div className="py-4">
      {navigationItems.map((item) => (
        <button
          key={item.id}
          onClick={() => onSectionChange(item.id)}
          className={cn(
            'w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
            'hover:bg-muted/50',
            activeSection === item.id
              ? 'bg-muted/50 text-foreground font-medium'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <item.icon className="h-4 w-4" />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}
