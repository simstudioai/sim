import { OutputSelect } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/chat/components/output-select/output-select'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const EMPTY_OUTPUTS: string[] = []

interface WorkflowOutputSelectorProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: string[] | null
  disabled?: boolean
  placeholder?: string
}

export function WorkflowOutputSelector({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  placeholder,
}: WorkflowOutputSelectorProps) {
  const workflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const [storedValue, setStoredValue] = useSubBlockValue<string[]>(blockId, subBlockId)
  const selectedOutputs = isPreview
    ? (previewValue ?? EMPTY_OUTPUTS)
    : (storedValue ?? EMPTY_OUTPUTS)

  return (
    <OutputSelect
      workflowId={workflowId}
      selectedOutputs={selectedOutputs}
      onOutputSelect={setStoredValue}
      disabled={disabled || isPreview}
      placeholder={placeholder}
      size='md'
      className='w-full'
    />
  )
}
