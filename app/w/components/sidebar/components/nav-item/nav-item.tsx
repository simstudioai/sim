'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function NavItem({
  href,
  label,
  children,
  onClick,
  isActive,
  disabled = false,
}: {
  href: string
  label: string
  children: React.ReactNode
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void
  isActive?: boolean
  disabled?: boolean
}) {
  const pathname = usePathname()
  const isActiveLink = isActive !== undefined ? isActive : pathname === href

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          onClick={onClick}
          className={clsx(
            'flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground md:h-8 md:w-8',
            {
              'bg-accent text-black': isActiveLink,
              'cursor-pointer': onClick,
            }
          )}
          aria-disabled={disabled}
        >
          {children}
          <span className="sr-only">{label}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}
