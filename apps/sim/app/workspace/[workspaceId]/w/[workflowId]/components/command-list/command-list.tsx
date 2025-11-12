'use client'

import { Layout, LibraryBig, Search } from 'lucide-react'
import Image from 'next/image'
import { Button } from '@/components/emcn'
import { AgentIcon } from '@/components/icons'
import { cn } from '@/lib/utils'

/**
 * Command item data structure
 */
interface CommandItem {
  /** Display label for the command */
  label: string
  /** Icon component from lucide-react */
  icon: React.ComponentType<{ className?: string }>
  /** Keyboard shortcut keys (can be single or array for multiple keys) */
  shortcut: string | string[]
}

/**
 * Available commands list
 */
const commands: CommandItem[] = [
  {
    label: 'Templates',
    icon: Layout,
    shortcut: 'Y',
  },
  {
    label: 'New Agent',
    icon: AgentIcon,
    shortcut: ['⇧', 'A'],
  },
  {
    label: 'Logs',
    icon: LibraryBig,
    shortcut: 'L',
  },
  {
    label: 'Search Blocks',
    icon: Search,
    shortcut: 'K',
  },
]

/**
 * CommandList component that displays available commands with keyboard shortcuts
 * Centered on the screen for empty workflows
 */
export function CommandList() {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 mb-[50px] flex items-center justify-center'
      )}
    >
      <div className='pointer-events-none flex flex-col gap-[8px]'>
        {/* Logo */}
        <div className='mb-[20px] flex justify-center'>
          <Image
            src='/logo/b&w/text/b&w.svg'
            alt='Sim'
            width={99.56}
            height={48.56}
            className='opacity-70'
            style={{
              filter:
                'brightness(0) saturate(100%) invert(69%) sepia(0%) saturate(0%) hue-rotate(202deg) brightness(94%) contrast(89%)',
            }}
            priority
          />
        </div>

        {commands.map((command) => {
          const Icon = command.icon
          const shortcuts = Array.isArray(command.shortcut) ? command.shortcut : [command.shortcut]
          return (
            <div
              key={command.label}
              className='group flex cursor-pointer items-center justify-between gap-[60px]'
            >
              {/* Left side: Icon and Label */}
              <div className='flex items-center gap-[8px]'>
                <Icon className='h-[14px] w-[14px] text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]' />
                <span className='font-medium text-[14px] text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]'>
                  {command.label}
                </span>
              </div>

              {/* Right side: Keyboard Shortcut */}
              <div className='flex items-center gap-[4px]'>
                <Button
                  className='group-hover:-translate-y-0.5 w-[26px] py-[3px] text-[12px] hover:translate-y-0 hover:text-[var(--text-tertiary)] hover:shadow-[0_2px_0_0] group-hover:text-[var(--text-primary)] group-hover:shadow-[0_4px_0_0]'
                  variant='3d'
                >
                  <span>⌘</span>
                </Button>
                {shortcuts.map((key, index) => (
                  <Button
                    key={index}
                    className='group-hover:-translate-y-0.5 w-[26px] py-[3px] text-[12px] hover:translate-y-0 hover:text-[var(--text-tertiary)] hover:shadow-[0_2px_0_0] group-hover:text-[var(--text-primary)] group-hover:shadow-[0_4px_0_0]'
                    variant='3d'
                  >
                    {key}
                  </Button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
