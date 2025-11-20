import { Tooltip } from '@/components/emcn'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'

interface NavigationItemProps {
  item: {
    id: string
    icon: React.ElementType
    onClick?: () => void
    href?: string
    tooltip: string
    shortcut?: string
    active?: boolean
    disabled?: boolean
  }
}

export const NavigationItem = ({ item }: NavigationItemProps) => {
  // Settings and help buttons get gray hover, others get purple hover
  const isGrayHover = item.id === 'settings' || item.id === 'help'

  const content = item.disabled ? (
    <div className='inline-flex h-[42px] w-[42px] cursor-not-allowed items-center justify-center gap-2 whitespace-nowrap rounded-[11px] border bg-card font-medium text-card-foreground text-sm opacity-50 ring-offset-background transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0'>
      <item.icon className='h-4 w-4' />
    </div>
  ) : (
    <Button
      variant='outline'
      onClick={item.onClick}
      data-settings-button={item.id === 'settings' ? '' : undefined}
      className={cn(
        'h-[42px] w-[42px] rounded-[10px] border bg-background text-foreground shadow-xs transition-all duration-200',
        isGrayHover && 'hover:bg-secondary',
        !isGrayHover &&
          'hover:border-[var(--brand-primary-hex)] hover:bg-[var(--brand-primary-hex)] hover:text-white',
        item.active && 'border-[var(--brand-primary-hex)] bg-[var(--brand-primary-hex)] text-white'
      )}
    >
      <item.icon className='h-4 w-4' />
    </Button>
  )

  if (item.href && !item.disabled) {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <a href={item.href} className='inline-block'>
            {content}
          </a>
        </Tooltip.Trigger>
        <Tooltip.Content side='top'>
          {item.tooltip}
          {item.shortcut && <span className='ml-1 text-xs opacity-75'> ({item.shortcut})</span>}
        </Tooltip.Content>
      </Tooltip.Root>
    )
  }

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{content}</Tooltip.Trigger>
      <Tooltip.Content side='top'>
        {item.tooltip}
        {item.shortcut && <span className='ml-1 text-xs opacity-75'> ({item.shortcut})</span>}
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
