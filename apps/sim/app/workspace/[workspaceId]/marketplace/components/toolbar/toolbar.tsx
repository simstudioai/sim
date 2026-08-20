'use client'

import { useEffect, useState } from 'react'
import { Clock, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CATEGORIES, getCategoryIcon, getCategoryLabel } from '../../constants/categories'

export type MarketplaceCategory = 'popular' | 'programming' | 'marketing' | 'all'

interface ToolbarProps {
  scrollToSection: (sectionId: string) => void
  activeSection: string | null
}

// Map of special section icons
const specialIcons: Record<string, React.ReactNode> = {
  popular: <Star className='mr-2 h-4 w-4' />,
  recent: <Clock className='mr-2 h-4 w-4' />,
}

export function Toolbar({ scrollToSection, activeSection }: ToolbarProps) {
  const [categories, setCategories] = useState<string[]>([])

  // Set categories including special sections
  useEffect(() => {
    // Start with special sections like 'popular' and 'recent'
    const specialSections = ['popular', 'recent']

    // Add categories from centralized definitions
    const categoryValues = CATEGORIES.map((cat) => cat.value)

    // Put special sections first, then regular categories
    const allCategories = [...specialSections, ...categoryValues]

    setCategories(allCategories)
  }, [])

  return (
    <div className='h-full w-60 overflow-auto border-r p-4'>
      <h2 className='mb-4 pl-2 font-medium text-sm'>Categories</h2>
      <nav className='space-y-1'>
        {categories.map((category) => (
          <Button
            key={category}
            variant='ghost'
            className={`w-full justify-start px-2 py-2 font-medium text-muted-foreground text-sm capitalize transition-colors hover:text-foreground ${
              activeSection === category ? 'bg-accent text-foreground' : 'hover:bg-accent/50'
            }`}
            onClick={() => scrollToSection(category)}
          >
            {specialIcons[category] || getCategoryIcon(category)}
            {category === 'popular'
              ? 'Popular'
              : category === 'recent'
                ? 'Recent'
                : getCategoryLabel(category)}
          </Button>
        ))}
      </nav>
    </div>
  )
}
