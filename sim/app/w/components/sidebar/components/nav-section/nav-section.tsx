'use client'

import { ReactNode } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface NavSectionProps {
  children: ReactNode
}

interface NavItemProps {
  icon: ReactNode
  label: string
  href?: string
  active?: boolean
  onClick?: () => void
  isCollapsed?: boolean
}

export function NavSection({ children }: NavSectionProps) {
  return <nav className="space-y-[1px]">{children}</nav>
}

function NavItem({ icon, label, href, active, onClick, isCollapsed }: NavItemProps) {
  const className = clsx(
    'flex w-full items-center gap-2 rounded-md px-2 py-[6px] text-sm font-medium text-muted-foreground',
    {
      'bg-accent': active,
      'hover:bg-accent/50': !active,
      'cursor-pointer': onClick,
      'justify-center': isCollapsed,
    }
  )

  const content = (
    <>
      {icon}
      {!isCollapsed && <span className="truncate">{label}</span>}
    </>
  )

  if (isCollapsed) {
    if (href) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link href={href} className={className}>
              {content}
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      )
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button onClick={onClick} className={className}>
            {content}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    )
  }

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    )
  }

  return (
    <button onClick={onClick} className={className}>
      {content}
    </button>
  )
}

NavSection.Item = NavItem
