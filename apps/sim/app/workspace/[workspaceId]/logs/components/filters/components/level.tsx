import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useFilterStore } from '@/app/workspace/[workspaceId]/logs/stores/store'
import type { LogLevel } from '@/app/workspace/[workspaceId]/logs/stores/types'

export default function Level() {
  const { level, setLevel } = useFilterStore()
  const levels: { value: LogLevel; label: string; color?: string }[] = [
    { value: 'all', label: 'Any status' },
    { value: 'error', label: 'Error', color: 'bg-destructive/100' },
    { value: 'info', label: 'Info', color: 'bg-muted-foreground/100' },
  ]

  const getDisplayLabel = () => {
    const selected = levels.find((l) => l.value === level)
    return selected ? selected.label : 'Any status'
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline' size='sm' className='w-full justify-between font-normal text-sm'>
          {getDisplayLabel()}
          <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-[180px]'>
        {levels.map((levelItem) => (
          <DropdownMenuItem
            key={levelItem.value}
            onSelect={(e) => {
              e.preventDefault()
              setLevel(levelItem.value)
            }}
            className='flex cursor-pointer items-center justify-between p-2 text-sm'
          >
            <div className='flex items-center'>
              {levelItem.color && (
                <div className={`mr-2 h-2 w-2 rounded-full ${levelItem.color}`} />
              )}
              {levelItem.label}
            </div>
            {level === levelItem.value && <Check className='h-4 w-4 text-primary' />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
