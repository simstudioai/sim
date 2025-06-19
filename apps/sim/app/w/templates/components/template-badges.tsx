'use client'

import { Eye } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'

interface TemplateBadgesProps {
  authorName: string
  views: number
  price: string
  className?: string
}

/**
 * TemplateBadges component - Displays author, views, and price information for template cards
 * Shows author avatar, name, view count, and price in a clean badge layout
 */
export function TemplateBadges({ authorName, views, price, className = '' }: TemplateBadgesProps) {
  // Get author initials for avatar fallback
  const getAuthorInitials = (name: string) => {
    if (!name || name.trim() === '') return '??'
    return name
      .split(' ')
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  // Format views count
  const formatViews = (count: number) => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`
    }
    return count.toString()
  }

  // Format price display
  const formatPrice = (priceStr: string) => {
    if (!priceStr || priceStr.toLowerCase() === 'free' || priceStr === '0') {
      return 'Free'
    }
    // If it's a number, format as currency
    const numPrice = Number.parseFloat(priceStr)
    if (!Number.isNaN(numPrice) && numPrice > 0) {
      return `$${numPrice.toFixed(2)}`
    }
    return priceStr
  }

  return (
    <div className={`flex items-center justify-between gap-2 ${className}`}>
      {/* Author Info */}
      <div className='flex min-w-0 flex-1 items-center gap-2'>
        <Avatar className='h-6 w-6'>
          <AvatarFallback className='bg-muted text-muted-foreground text-xs'>
            {getAuthorInitials(authorName)}
          </AvatarFallback>
        </Avatar>
        <span className='truncate text-muted-foreground text-xs'>{authorName}</span>
      </div>

      {/* Stats and Price */}
      <div className='flex flex-shrink-0 items-center gap-2'>
        {/* Views Badge */}
        <div className='flex items-center gap-1'>
          <Eye className='h-3 w-3 text-muted-foreground' />
          <span className='text-muted-foreground text-xs'>{formatViews(views)}</span>
        </div>

        {/* Price Badge */}
        <Badge variant='outline' className='h-5 px-2 py-0.5 text-xs'>
          {formatPrice(price)}
        </Badge>
      </div>
    </div>
  )
}
