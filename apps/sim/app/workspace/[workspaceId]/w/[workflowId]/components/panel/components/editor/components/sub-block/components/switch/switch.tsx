import { BooleanControl } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/boolean-control'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'

interface SwitchProps {
  blockId: string
  subBlockId: string
  title: string
  value?: boolean
  isPreview?: boolean
  previewValue?: boolean | null
  disabled?: boolean
}

export function Switch({
  blockId,
  subBlockId,
  title,
  value: propValue,
  isPreview = false,
  previewValue,
  disabled = false,
}: SwitchProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<boolean>(blockId, subBlockId)

  const value = isPreview ? previewValue : (storeValue ?? propValue)

  const handleChange = (nextValue: boolean) => {
    if (!isPreview && !disabled) {
      setStoreValue(nextValue)
    }
  }

  return (
    <BooleanControl
      value={Boolean(value)}
      onChange={handleChange}
      label={title}
      disabled={isPreview || disabled}
    />
  )
}
