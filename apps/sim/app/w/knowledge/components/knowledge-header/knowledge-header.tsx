'use client'

import { LibraryBig, MoreHorizontal, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface BreadcrumbItem {
  label: string
  href?: string
}

interface KnowledgeHeaderProps {
  breadcrumbs: BreadcrumbItem[]
  onDeleteKnowledgeBase?: () => void
}

export function KnowledgeHeader({ breadcrumbs, onDeleteKnowledgeBase }: KnowledgeHeaderProps) {
  return (
    <div className='flex items-center justify-between px-6 pt-[14px] pb-6'>
      <div className='flex items-center gap-2'>
        {breadcrumbs.map((breadcrumb, index) => (
          <div key={index} className='flex items-center gap-2'>
            {index === 0 && (
              <LibraryBig className='h-[18px] w-[18px] text-muted-foreground transition-colors group-hover:text-muted-foreground/70' />
            )}

            {breadcrumb.href ? (
              <Link
                href={breadcrumb.href}
                prefetch={true}
                className='group flex items-center gap-2 font-medium text-sm transition-colors hover:text-muted-foreground'
              >
                <span>{breadcrumb.label}</span>
              </Link>
            ) : (
              <span className='font-medium text-sm'>{breadcrumb.label}</span>
            )}

            {index < breadcrumbs.length - 1 && <span className='text-muted-foreground'>/</span>}
          </div>
        ))}
      </div>

      {/* Actions Menu - only show if onDeleteKnowledgeBase is provided */}
      {onDeleteKnowledgeBase && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='sm' className='h-8 w-8 p-0'>
              <MoreHorizontal className='h-4 w-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem
              onClick={onDeleteKnowledgeBase}
              className='text-red-600 focus:text-red-600'
            >
              <Trash2 className='mr-2 h-4 w-4' />
              Delete Knowledge Base
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
