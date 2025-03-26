import { ReactNode } from 'react'
import {
  Atom,
  BotMessageSquare,
  Brain,
  Code,
  Database,
  LineChart,
  MailIcon,
  Store,
} from 'lucide-react'

export interface Category {
  value: string
  label: string
  icon: ReactNode
  color: string
}

export const CATEGORIES: Category[] = [
  {
    value: 'data',
    label: 'Data Analysis',
    icon: <Database className="h-4 w-4 mr-2" />,
    color: '#0ea5e9', // sky-500
  },
  {
    value: 'marketing',
    label: 'Marketing',
    icon: <MailIcon className="h-4 w-4 mr-2" />,
    color: '#f43f5e', // rose-500
  },
  {
    value: 'sales',
    label: 'Sales',
    icon: <Store className="h-4 w-4 mr-2" />,
    color: '#10b981', // emerald-500
  },
  {
    value: 'customer_service',
    label: 'Customer Service',
    icon: <BotMessageSquare className="h-4 w-4 mr-2" />,
    color: '#8b5cf6', // violet-500
  },
  {
    value: 'research',
    label: 'Research',
    icon: <Atom className="h-4 w-4 mr-2" />,
    color: '#f59e0b', // amber-500
  },
  {
    value: 'finance',
    label: 'Finance',
    icon: <LineChart className="h-4 w-4 mr-2" />,
    color: '#14b8a6', // teal-500
  },
  {
    value: 'programming',
    label: 'Programming',
    icon: <Code className="h-4 w-4 mr-2" />,
    color: '#6366f1', // indigo-500
  },
  {
    value: 'other',
    label: 'Other',
    icon: <Brain className="h-4 w-4 mr-2" />,
    color: '#7F2FFF', // Brand purple
  },
]

// Helper functions to get category information
export const getCategoryByValue = (value: string): Category => {
  return CATEGORIES.find((cat) => cat.value === value) || CATEGORIES[CATEGORIES.length - 1]
}

export const getCategoryLabel = (value: string): string => {
  return getCategoryByValue(value).label
}

export const getCategoryIcon = (value: string): ReactNode => {
  return getCategoryByValue(value).icon
}

export const getCategoryColor = (value: string): string => {
  return getCategoryByValue(value).color
}
