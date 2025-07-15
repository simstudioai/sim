import { cn } from '@/lib/utils'

interface NavigationTab {
  id: string
  label: string
  count?: number
}

interface NavigationTabsProps {
  tabs: NavigationTab[]
  activeTab?: string
  onTabClick?: (tabId: string) => void
  className?: string
}

export function NavigationTabs({ tabs, activeTab, onTabClick, className }: NavigationTabsProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          onClick={() => onTabClick?.(tab.id)}
          className={cn(
            'flex h-[38px] items-center gap-1 rounded-[14px] px-3 font-[440] font-sans text-muted-foreground text-sm transition-all duration-200',
            activeTab === tab.id ? 'bg-secondary' : 'bg-transparent hover:bg-secondary/50'
          )}
        >
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  )
}
