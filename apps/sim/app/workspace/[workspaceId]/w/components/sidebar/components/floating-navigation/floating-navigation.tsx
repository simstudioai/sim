import { HelpCircle, LibraryBig, ScrollText, Settings, Shapes } from 'lucide-react'
import { NavigationItem } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/navigation-item/navigation-item'
import { getKeyboardShortcutText } from '@/app/workspace/[workspaceId]/w/hooks/use-keyboard-shortcuts'

interface FloatingNavigationProps {
  workspaceId: string
  pathname: string
  onShowSettings: () => void
  onShowHelp: () => void
  bottom: number
}

export const FloatingNavigation = ({
  workspaceId,
  pathname,
  onShowSettings,
  onShowHelp,
  bottom,
}: FloatingNavigationProps) => {
  // Navigation items with their respective actions
  const navigationItems = [
    {
      id: 'settings',
      icon: Settings,
      onClick: onShowSettings,
      tooltip: 'Settings',
    },
    {
      id: 'help',
      icon: HelpCircle,
      onClick: onShowHelp,
      tooltip: 'Help',
    },
    {
      id: 'logs',
      icon: ScrollText,
      href: `/workspace/${workspaceId}/logs`,
      tooltip: 'Logs',
      shortcut: getKeyboardShortcutText('L', true, true),
      active: pathname === `/workspace/${workspaceId}/logs`,
    },
    {
      id: 'knowledge',
      icon: LibraryBig,
      href: `/workspace/${workspaceId}/knowledge`,
      tooltip: 'Knowledge',
      active: pathname === `/workspace/${workspaceId}/knowledge`,
    },
    {
      id: 'templates',
      icon: Shapes,
      href: `/workspace/${workspaceId}/templates`,
      tooltip: 'Templates',
      active: pathname === `/workspace/${workspaceId}/templates`,
    },
  ]

  return (
    <div className='pointer-events-auto fixed left-4 z-50 w-56' style={{ bottom: `${bottom}px` }}>
      <div className='flex items-center gap-1'>
        {navigationItems.map((item) => (
          <NavigationItem key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}
