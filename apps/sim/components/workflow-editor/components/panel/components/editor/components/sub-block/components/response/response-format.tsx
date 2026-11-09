import { ResponseFormat as SharedResponseFormat } from '@/components/workflow-editor/components/panel/components/editor/components/sub-block/components/starter/input-format'

interface ResponseFormatProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: any
  disabled?: boolean
  config?: any
}

export function ResponseFormat({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  config,
}: ResponseFormatProps) {
  return (
    <SharedResponseFormat
      blockId={blockId}
      subBlockId={subBlockId}
      isPreview={isPreview}
      previewValue={previewValue}
      disabled={disabled}
      config={config}
    />
  )
}
