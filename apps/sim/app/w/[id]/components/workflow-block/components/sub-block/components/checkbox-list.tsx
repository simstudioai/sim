import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useSubBlockValue } from '../hooks/use-sub-block-value'

interface CheckboxListProps {
  blockId: string
  subBlockId: string
  title: string
  options: { label: string; id: string }[]
  layout?: 'full' | 'half'
}

export function CheckboxList({ blockId, subBlockId, title, options, layout }: CheckboxListProps) {
  return (
    <div className={cn('grid gap-4', layout === 'half' ? 'grid-cols-2' : 'grid-cols-1', 'pt-1')}>
      {options.map((option) => {
        const [value, setValue] = useSubBlockValue(blockId, option.id)
        return (
          <div key={option.id} className="flex items-center space-x-2">
            <Checkbox
              id={`${blockId}-${option.id}`}
              checked={Boolean(value)}
              onCheckedChange={(checked) => setValue(checked as boolean)}
            />
            <Label
              htmlFor={`${blockId}-${option.id}`}
              className="text-sm font-normal leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
            >
              {option.label}
            </Label>
          </div>
        )
      })}
    </div>
  )
}
