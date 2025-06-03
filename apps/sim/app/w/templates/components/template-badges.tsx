'use client'

import { Eye, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

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
    return name
      .split(' ')
      .map(word => word[0])
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
    const numPrice = parseFloat(priceStr)
    if (!isNaN(numPrice) && numPrice > 0) {
      return `$${numPrice.toFixed(2)}`
    }
    return priceStr
  }

  return (
    <div className={`flex items-center justify-between gap-2 ${className}`}>
      {/* Author Info */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Avatar className="h-6 w-6">
          <AvatarFallback className="text-xs bg-muted text-muted-foreground">
            {getAuthorInitials(authorName)}
          </AvatarFallback>
        </Avatar>
        <span className="text-xs text-muted-foreground truncate">
          {authorName}
        </span>
      </div>

      {/* Stats and Price */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Views Badge */}
        <div className="flex items-center gap-1">
          <Eye className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {formatViews(views)}
          </span>
        </div>

        {/* Price Badge */}
        <Badge 
          variant="outline" 
          className="text-xs px-2 py-0.5 h-5"
        >
          {formatPrice(price)}
        </Badge>
      </div>
    </div>
  )
}
