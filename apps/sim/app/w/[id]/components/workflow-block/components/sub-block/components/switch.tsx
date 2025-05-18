import { useEffect } from 'react'
import { Label } from '@/components/ui/label'
import { Switch as UISwitch } from '@/components/ui/switch'
import { useSubBlockValue } from '../hooks/use-sub-block-value'


interface SwitchProps {
  blockId: string
  subBlockId: string
  title: string
  isPreview?: boolean
  value?: boolean
}

export function Switch({ 
  blockId, 
  subBlockId, 
  title, 
  isPreview = false,
  value: propValue 
}: SwitchProps) {
  const [value, setValue] = useSubBlockValue(blockId, subBlockId, false, isPreview, propValue)

  return (
    <div className='flex flex-col gap-2'>
      <Label className='font-medium text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'>
        {title}
      </Label>
      <UISwitch checked={Boolean(value)} onCheckedChange={(checked) => setValue(checked)} />
    </div>
  )
}
