import { Button } from '@/components/ui/button'
import { ReactNode } from 'react'

interface FilterButtonProps {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
  className?: string
}

export function FilterButton({ active, onClick, icon, label, className }: FilterButtonProps) {
  return (
    <Button
      variant={active ? 'default' : 'ghost'}
      size="sm"
      onClick={onClick}
      className={`flex items-center gap-1.5 h-9 px-3 ${className || ''}`}
    >
      {icon}
      <span>{label}</span>
    </Button>
  )
} 