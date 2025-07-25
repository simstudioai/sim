import { useEffect, useState } from 'react'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { useSubBlockValue } from '../hooks/use-sub-block-value'
import { InputFormat } from './starter/input-format'

interface WorkflowInputFormatProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: any
  disabled?: boolean
  isConnecting?: boolean
  config?: any
}

interface Field {
  id: string
  name: string
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array'
  value?: string
  collapsed?: boolean
}

export function WorkflowInputFormat({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  isConnecting = false,
  config,
}: WorkflowInputFormatProps) {
  const [targetWorkflowInputFormat, setTargetWorkflowInputFormat] = useState<Field[] | null>(null)
  const [isLoadingFormat, setIsLoadingFormat] = useState(false)

  // Get the parent block type to determine context
  const parentBlockType = useWorkflowStore((state) => state.blocks[blockId]?.type)

  // Get the selected workflow ID from the workflowId subblock
  const [selectedWorkflowId] = useSubBlockValue<string>(blockId, 'workflowId')

  // Check if we're specifically handling workflow input format
  const isInWorkflowBlock = parentBlockType === 'workflow' && subBlockId === 'workflowInputFormat'

  // Fetch input format from selected workflow
  useEffect(() => {
    if (!isInWorkflowBlock) {
      return
    }

    if (!selectedWorkflowId) {
      setTargetWorkflowInputFormat(null)
      return
    }

    // Reset state immediately when workflow changes
    setTargetWorkflowInputFormat(null)

    const fetchWorkflowInputFormat = async () => {
      setIsLoadingFormat(true)
      try {
        const response = await fetch(`/api/workflows/${selectedWorkflowId}`)
        if (!response.ok) {
          console.error('Failed to fetch workflow:', response.statusText)
          setTargetWorkflowInputFormat(null)
          return
        }

        const workflowData = await response.json()
        const blocks = workflowData.data?.state?.blocks || {}

        // Find the starter block
        const starterBlock = Object.values(blocks).find(
          (block: any) => block.type === 'starter'
        ) as any

        if (starterBlock) {
          const inputFormat = starterBlock.subBlocks?.inputFormat?.value
          if (inputFormat && Array.isArray(inputFormat) && inputFormat.length > 0) {
            // Convert to Field format, ensuring each field has an id and clearing values
            const formattedFields: Field[] = inputFormat.map((field: any, index: number) => ({
              id: field.id || `field-${index}`,
              name: field.name || '',
              type: field.type || 'string',
              value: '', // Clear values - user needs to fill these in
              collapsed: false,
            }))
            setTargetWorkflowInputFormat(formattedFields)
          } else {
            setTargetWorkflowInputFormat([])
          }
        } else {
          setTargetWorkflowInputFormat([])
        }
      } catch (error) {
        console.error('Error fetching workflow input format:', error)
        setTargetWorkflowInputFormat(null)
      } finally {
        setIsLoadingFormat(false)
      }
    }

    fetchWorkflowInputFormat()
  }, [isInWorkflowBlock, selectedWorkflowId])

  // Return null for the entire component (including wrapper) when we should hide
  if (!isInWorkflowBlock) {
    // Not a workflow block - render regular input format
    return (
      <InputFormat
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

  if (!selectedWorkflowId) {
    // No workflow selected - hide entirely
    return null
  }

  if (isLoadingFormat) {
    return (
      <div className='flex items-center justify-center rounded-md border border-input/50 border-dashed py-8'>
        <p className='text-muted-foreground text-sm'>Loading input fields...</p>
      </div>
    )
  }

  if (targetWorkflowInputFormat === null) {
    return (
      <div className='flex items-center justify-center rounded-md border border-input/50 border-dashed py-8'>
        <p className='text-muted-foreground text-sm'>Failed to load workflow input format</p>
      </div>
    )
  }

  if (targetWorkflowInputFormat.length === 0) {
    // No input fields - hide entirely
    return null
  }

  // Use the existing InputFormat component with the target workflow's input format
  return (
    <InputFormat
      blockId={blockId}
      subBlockId={subBlockId}
      isPreview={isPreview}
      previewValue={previewValue}
      disabled={disabled}
      isConnecting={isConnecting}
      config={config}
      targetWorkflowFields={targetWorkflowInputFormat}
    />
  )
}
