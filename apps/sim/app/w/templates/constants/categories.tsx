import type { ReactNode } from 'react'
import {
  BarChart3,
  Brain,
  CheckSquare,
  Clock,
  Code,
  Database,
  Folder,
  GraduationCap,
  LineChart,
  MailIcon,
  Search,
  Store,
  TrendingUp,
  Users,
} from 'lucide-react'

export interface Category {
  value: string
  label: string
  icon: ReactNode
  color: string
  hoverColor: string
}

export const CATEGORIES: Category[] = [
  {
    value: 'marketing',
    label: 'Marketing',
    icon: <MailIcon className='mr-2 h-4 w-4' />,
    color: '#f97316',
    hoverColor: 'hover:bg-orange-100 dark:hover:bg-orange-950/40',
  },
  {
    value: 'sales',
    label: 'Sales',
    icon: <Store className='mr-2 h-4 w-4' />,
    color: '#10b981',
    hoverColor: 'hover:bg-green-100 dark:hover:bg-green-950/40',
  },
  {
    value: 'customer_success',
    label: 'Customer Success',
    icon: <Users className='mr-2 h-4 w-4' />,
    color: '#8b5cf6',
    hoverColor: 'hover:bg-purple-100 dark:hover:bg-purple-950/40',
  },
  {
    value: 'data_analysis',
    label: 'Data Analysis',
    icon: <BarChart3 className='mr-2 h-4 w-4' />,
    color: '#3b82f6',
    hoverColor: 'hover:bg-blue-100 dark:hover:bg-blue-950/40',
  },
  {
    value: 'finance',
    label: 'Finance',
    icon: <LineChart className='mr-2 h-4 w-4' />,
    color: '#14b8a6',
    hoverColor: 'hover:bg-teal-100 dark:hover:bg-teal-950/40',
  },
  {
    value: 'exploration',
    label: 'Exploration',
    icon: <Search className='mr-2 h-4 w-4' />,
    color: '#f59e0b',
    hoverColor: 'hover:bg-amber-100 dark:hover:bg-amber-950/40',
  },
  {
    value: 'general_tasks',
    label: 'General Tasks',
    icon: <CheckSquare className='mr-2 h-4 w-4' />,
    color: '#0ea5e9',
    hoverColor: 'hover:bg-sky-100 dark:hover:bg-sky-950/40',
  },
  {
    value: 'other',
    label: 'Other',
    icon: <Brain className='mr-2 h-4 w-4' />,
    color: '#6b7280',
    hoverColor: 'hover:bg-gray-100 dark:hover:bg-gray-800',
  },
  {
    value: 'software_development',
    label: 'Software Development',
    icon: <Code className='mr-2 h-4 w-4' />,
    color: '#6366f1',
    hoverColor: 'hover:bg-indigo-100 dark:hover:bg-indigo-950/40',
  },
  {
    value: 'academic_research',
    label: 'Academic Research',
    icon: <GraduationCap className='mr-2 h-4 w-4' />,
    color: '#dc2626',
    hoverColor: 'hover:bg-red-100 dark:hover:bg-red-950/40',
  },
  {
    value: 'data_science',
    label: 'Data Science',
    icon: <Database className='mr-2 h-4 w-4' />,
    color: '#059669',
    hoverColor: 'hover:bg-emerald-100 dark:hover:bg-emerald-950/40',
  },
  {
    value: 'management',
    label: 'Management',
    icon: <Folder className='mr-2 h-4 w-4' />,
    color: '#059669',
    hoverColor: 'hover:bg-emerald-100 dark:hover:bg-emerald-950/40',
  },
]

// Special categories for Popular and Recent
export const SPECIAL_CATEGORIES = {
  popular: {
    value: 'popular',
    label: 'Popular',
    icon: <TrendingUp className='mr-2 h-4 w-4' />,
    color: '#ef4444', // red-500
    hoverColor: 'hover:bg-red-100 dark:hover:bg-red-950/40',
  },
  recent: {
    value: 'recent',
    label: 'Recent',
    icon: <Clock className='mr-2 h-4 w-4' />,
    color: '#64748b', // slate-500
    hoverColor: 'hover:bg-slate-100 dark:hover:bg-slate-800',
  },
} as const

// Category groupings for navigation
export const CATEGORY_GROUPS = {
  operations: ['marketing', 'sales', 'customer_success', 'data_analysis', 'finance', 'management'],
  personal: ['exploration', 'general_tasks', 'other'],
  technical: ['software_development', 'academic_research', 'data_science'],
} as const

export type CategoryGroup = keyof typeof CATEGORY_GROUPS

// Helper functions to get category information
export const getCategoryByValue = (
  value: string
): Category | typeof SPECIAL_CATEGORIES.popular | typeof SPECIAL_CATEGORIES.recent => {
  // Check special categories first
  if (value === 'popular') return SPECIAL_CATEGORIES.popular
  if (value === 'recent') return SPECIAL_CATEGORIES.recent

  // Default handling for regular categories
  return CATEGORIES.find((cat) => cat.value === value) || CATEGORIES[CATEGORIES.length - 1]
}

export const getCategoryLabel = (value: string): string => {
  // Special handling for "popular" and "recent" sections
  if (value === 'popular') return SPECIAL_CATEGORIES.popular.label
  if (value === 'recent') return SPECIAL_CATEGORIES.recent.label

  // Default handling for regular categories
  return getCategoryByValue(value).label
}

export const getCategoryIcon = (value: string): ReactNode => {
  return getCategoryByValue(value).icon
}

export const getCategoryColor = (value: string): string => {
  return getCategoryByValue(value).color
}

export const getCategoryHoverColor = (value: string): string => {
  return getCategoryByValue(value).hoverColor
}

export const getCategoriesByGroup = (group: CategoryGroup): Category[] => {
  return CATEGORY_GROUPS[group].map(getCategoryByValue) as Category[]
}
