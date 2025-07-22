import { ResponseFormat as SharedResponseFormat } from '../starter/input-format'

export interface JSONProperty {
  id: string
  key: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  value?: any
  collapsed?: boolean
}

interface ResponseFormatProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: any
  disabled?: boolean
  isConnecting?: boolean
  config?: any
}

export function ResponseFormat({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  isConnecting = false,
  config,
}: ResponseFormatProps) {
  return (
    <SharedResponseFormat
      blockId={blockId}
      subBlockId={subBlockId}
      isPreview={isPreview}
      previewValue={previewValue}
      disabled={disabled}
      isConnecting={isConnecting}
      config={config}
    />
  )
}
