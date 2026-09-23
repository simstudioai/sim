import {
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { resolveSearchLevel, type SearchLevel } from '@/app/o/[organizationId]/home/search-params'

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
  const liveSearch = useDeploymentShape().features.liveEnterpriseSearch === true
  const selected = resolveSearchLevel(value, liveSearch)
  const levels = liveSearch
    ? SEARCH_LEVELS.filter((level) => level.value !== 'adaptive').map((level) =>
        level.value === 'fast'
          ? { ...level, label: 'Auto', description: 'Fast, everyday answers' }
          : level
      )
    : SEARCH_LEVELS
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Chip aria-label='Search level'>
          {levels.find((level) => level.value === selected)?.label}
        </Chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent side='top' align='end'>
        {levels.map((level) => (
          <DropdownMenuItem
            key={level.value}
            role='menuitemradio'
            aria-checked={selected === level.value}
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
