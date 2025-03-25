'use client'

import { useEffect, useState } from 'react'
import {
  BotMessageSquare,
  Clock,
  Code,
  LineChart,
  MailIcon,
  PanelLeftClose,
  PanelRight,
  Sparkles,
  Star,
  Store,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CATEGORIES, getCategoryIcon } from '../../constants/categories'

export type MarketplaceCategory = 'popular' | 'programming' | 'marketing' | 'all'

interface ToolbarProps {
  scrollToSection: (sectionId: string) => void
  activeSection: string | null
}

// Map of special section icons
const specialIcons: Record<string, React.ReactNode> = {
  popular: <Star className="h-4 w-4 mr-2" />,
  recent: <Clock className="h-4 w-4 mr-2" />,
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
    <div className="p-4 w-60 border-r h-full overflow-auto">
      <h2 className="text-sm font-medium mb-4 pl-2">Categories</h2>
      <nav className="space-y-1">
        {categories.map((category) => (
          <Button
            key={category}
            variant="ghost"
            className={`w-full justify-start px-2 py-2 text-sm font-medium capitalize text-muted-foreground transition-colors hover:text-foreground ${
              activeSection === category ? 'bg-accent text-foreground' : 'hover:bg-accent/50'
            }`}
            onClick={() => scrollToSection(category)}
          >
            {specialIcons[category] || getCategoryIcon(category)}
            {category}
          </Button>
        ))}
      </nav>
    </div>
  )
}
