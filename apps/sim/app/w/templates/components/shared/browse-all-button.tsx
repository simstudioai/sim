'use client'

import { useRouter } from 'next/navigation'
import { CATEGORY_GROUPS, getCategoryLabel } from '../../constants/categories'

interface BrowseAllButtonProps {
  category: string
  className?: string
}

export function BrowseAllButton({ category, className }: BrowseAllButtonProps) {
  const router = useRouter()

  const handleClick = () => {
    // Find which parent category this subcategory belongs to
    let parentCategory = category // Default to the category itself

    if (CATEGORY_GROUPS.operations.includes(category as any)) {
      parentCategory = 'operations'
      router.push(`/w/templates/operations?subcategory=${category}`)
    } else if (CATEGORY_GROUPS.personal.includes(category as any)) {
      parentCategory = 'personal'
      router.push(`/w/templates/personal?subcategory=${category}`)
    } else if (CATEGORY_GROUPS.technical.includes(category as any)) {
      parentCategory = 'technical'
      router.push(`/w/templates/technical?subcategory=${category}`)
    } else {
      // For main categories or unknown categories, navigate directly
      router.push(`/w/templates/${category}`)
    }
  }

  return (
    <button
      onClick={handleClick}
      className={`text-muted-foreground text-sm transition-colors hover:text-foreground ${className}`}
    >
      Browse {getCategoryLabel(category)}
    </button>
  )
}
