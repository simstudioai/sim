import type { ComponentType, SVGProps } from 'react'
import {
  Button,
  Chip,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemLabel,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Tooltip,
} from '@sim/emcn'
import { Check, ChevronDown, MoreHorizontal } from '@sim/emcn/icons'
import type { Editor } from '@tiptap/react'

interface ToolbarMenuProps {
  editor: Editor
  label: string
  value?: string
  active?: boolean
  items: {
    label: string
    icon: ComponentType<SVGProps<SVGSVGElement>>
    shortcut?: string
    active: boolean
    disabled?: boolean
    onSelect: () => void
  }[]
}

/**
 * Formatting commands share the platform menu while retaining the editor's selection.
 * Focusing the trigger before its portal opens keeps TipTap's blur handler inside the toolbar.
 */
export function ToolbarMenu({ editor, label, value, active, items }: ToolbarMenuProps) {
  if (!editor.isEditable) return null

  return (
    <DropdownMenu modal={false}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <DropdownMenuTrigger asChild>
            {value ? (
              <Chip
                rightIcon={ChevronDown}
                aria-label={label}
                className='h-10 w-[76px] focus-visible:bg-[var(--surface-hover)] sm:h-[28px]'
                onPointerDown={(event) => event.currentTarget.focus()}
              >
                {value}
              </Chip>
            ) : (
              <Button
                type='button'
                variant={active ? 'active' : 'ghost'}
                size='icon'
                aria-label={label}
                className={cn(
                  'size-10 focus-visible:bg-[var(--surface-hover)] sm:size-[28px]',
                  !active && 'hover-hover:bg-[var(--surface-hover)]'
                )}
                onPointerDown={(event) => event.currentTarget.focus()}
              >
                <MoreHorizontal className='size-[14px]' />
              </Button>
            )}
          </DropdownMenuTrigger>
        </Tooltip.Trigger>
        <Tooltip.Content>{label}</Tooltip.Content>
      </Tooltip.Root>
      <DropdownMenuContent
        align='start'
        className='w-[220px]'
        onKeyDown={(event) => event.stopPropagation()}
      >
        {items.map(({ label: itemLabel, icon: Icon, shortcut, active, disabled, onSelect }) => (
          <DropdownMenuItem
            key={itemLabel}
            role='menuitemcheckbox'
            aria-checked={active}
            active={active}
            disabled={disabled}
            onSelect={() => {
              if (!editor.isDestroyed && editor.isEditable) onSelect()
            }}
          >
            <Icon className='size-[14px]' />
            <DropdownMenuItemLabel label={itemLabel} />
            {shortcut && <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>}
            {active && <Check className='size-[14px]' />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
