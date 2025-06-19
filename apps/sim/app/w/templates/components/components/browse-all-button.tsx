'use client'

import { useRouter } from 'next/navigation'
import { type CATEGORIES, CATEGORY_GROUPS, getCategoryLabel } from '../../constants/categories'

// At the top of the file, add proper type definitions
type CategoryValue = (typeof CATEGORIES)[number]['value']
type OperationsCategory = (typeof CATEGORY_GROUPS.operations)[number]
type PersonalCategory = (typeof CATEGORY_GROUPS.personal)[number]
type TechnicalCategory = (typeof CATEGORY_GROUPS.technical)[number]

interface BrowseAllButtonProps {
  category: CategoryValue | 'popular' | 'recent'
  className?: string
}

// Create a type guard function
function isOperationsCategory(category: string): category is OperationsCategory {
  return CATEGORY_GROUPS.operations.some((op) => op === category)
}

function isPersonalCategory(category: string): category is PersonalCategory {
  return CATEGORY_GROUPS.personal.some((op) => op === category)
}

function isTechnicalCategory(category: string): category is TechnicalCategory {
  return CATEGORY_GROUPS.technical.some((op) => op === category)
}

export function BrowseAllButton({ category, className }: BrowseAllButtonProps) {
  const router = useRouter()

  const handleClick = () => {
    let parentCategory = category

    if (isOperationsCategory(category)) {
      parentCategory = 'operations'
      router.push(`/w/templates/operations?subcategory=${category}`)
    } else if (isPersonalCategory(category)) {
      parentCategory = 'personal'
      router.push(`/w/templates/personal?subcategory=${category}`)
    } else if (isTechnicalCategory(category)) {
      parentCategory = 'technical'
      router.push(`/w/templates/technical?subcategory=${category}`)
    } else {
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
