'use client'

import { useRouter } from 'next/navigation'
import { getCategoryLabel } from '../../constants/categories'

interface BrowseAllButtonProps {
  category: string
  className?: string
}

export function BrowseAllButton({ category, className }: BrowseAllButtonProps) {
  const router = useRouter()

  const handleClick = () => {
    router.push(`/w/templates/${category}`)
  }

  return (
    <button
      onClick={handleClick}
      className={`text-sm text-muted-foreground hover:text-foreground transition-colors ${className}`}
    >
      Browse {getCategoryLabel(category)}
    </button>
  )
} 