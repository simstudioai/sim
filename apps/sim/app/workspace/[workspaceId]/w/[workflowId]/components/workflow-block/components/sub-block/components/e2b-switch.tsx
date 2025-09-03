import { Info } from 'lucide-react'
import { Label, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui'
import { Switch as UISwitch } from '@/components/ui/switch'
import { getEnv, isTruthy } from '@/lib/env'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'

interface E2BSwitchProps {
  blockId: string
  subBlockId: string
  title: string
  value?: boolean
  isPreview?: boolean
  previewValue?: boolean | null
  disabled?: boolean
}

export function E2BSwitch({
  blockId,
  subBlockId,
  title,
  value: propValue,
  isPreview = false,
  previewValue,
  disabled = false,
}: E2BSwitchProps) {
  const e2bEnabled = isTruthy(getEnv('NEXT_PUBLIC_E2B_ENABLED'))
  if (!e2bEnabled) return null

  const [storeValue, setStoreValue] = useSubBlockValue<boolean>(blockId, subBlockId)
  const value = isPreview ? previewValue : propValue !== undefined ? propValue : storeValue

  const handleChange = (checked: boolean) => {
    if (!isPreview && !disabled) setStoreValue(checked)
  }

  return (
    <div className='flex items-center gap-2'>
      <UISwitch
        id={`${blockId}-${subBlockId}`}
        checked={Boolean(value)}
        onCheckedChange={handleChange}
        disabled={isPreview || disabled}
      />
      <Label
        htmlFor={`${blockId}-${subBlockId}`}
        className='cursor-pointer font-normal text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
      >
        {title}
      </Label>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className='h-4 w-4 cursor-pointer text-muted-foreground' />
        </TooltipTrigger>
        <TooltipContent side='top' className='max-w-[320px] select-text whitespace-pre-wrap'>
          Python/Javascript code run in a sandbox environment. Can have slower execution times.
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
