import {
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@sim/emcn'
import type { SearchLevel } from '@/app/o/[organizationId]/home/search-params'

const SEARCH_LEVELS = [
  { value: 'fast', label: 'Fast', description: 'Faster and cheaper' },
  { value: 'adaptive', label: 'Auto', description: 'Balanced speed and depth' },
  { value: 'max', label: 'Max', description: 'Thorough research and verification' },
] as const satisfies ReadonlyArray<{
  value: SearchLevel
  label: string
  description: string
}>

interface SearchLevelSelectorProps {
  value: SearchLevel
  onChange: (level: SearchLevel) => void
}

export function SearchLevelSelector({ value, onChange }: SearchLevelSelectorProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Chip aria-label='Search level'>
          {SEARCH_LEVELS.find((level) => level.value === value)?.label}
        </Chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent side='top' align='end'>
        {SEARCH_LEVELS.map((level) => (
          <DropdownMenuItem
            key={level.value}
            role='menuitemradio'
            aria-checked={value === level.value}
            title={level.description}
            onSelect={() => onChange(level.value)}
          >
            {level.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
