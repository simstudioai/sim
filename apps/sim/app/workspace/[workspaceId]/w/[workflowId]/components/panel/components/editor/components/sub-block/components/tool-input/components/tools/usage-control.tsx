import { Combobox, Label } from '@sim/emcn'
import type { CanonicalMode } from '@/lib/workflows/subblocks/visibility'
import type { StoredTool } from '@/lib/workflows/tool-input/types'
import { CanonicalModeToggle } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/canonical-mode-toggle'
import { ShortInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/short-input'

interface ToolUsageControlProps {
  blockId: string
  aggregateSubBlockId: string
  toolIndex: number
  tool: StoredTool
  mode: CanonicalMode
  supportsForce: boolean
  disabled: boolean
  onFixedChange: (value: NonNullable<StoredTool['usageControl']>) => void
  onExpressionChange: (value: string) => void
  onModeToggle: () => void
}

const MODE_OPTIONS = [
  {
    value: 'auto',
    label: 'Auto',
    suffixElement: <span className='text-[var(--text-tertiary)]'>(model decides)</span>,
  },
  {
    value: 'force',
    label: 'Force',
    suffixElement: <span className='text-[var(--text-tertiary)]'>(always use)</span>,
  },
  {
    value: 'none',
    label: 'None',
    suffixElement: <span className='text-[var(--text-tertiary)]'>(disable tool)</span>,
  },
] as const

export function ToolUsageControl({
  blockId,
  aggregateSubBlockId,
  toolIndex,
  tool,
  mode,
  supportsForce,
  disabled,
  onFixedChange,
  onExpressionChange,
  onModeToggle,
}: ToolUsageControlProps) {
  return (
    <div className='subblock-content flex w-full min-w-0 flex-col gap-2.5'>
      <div className='flex items-center justify-between gap-1.5 pl-0.5'>
        <Label>Permission Mode</Label>
        <CanonicalModeToggle mode={mode} disabled={disabled} onToggle={onModeToggle} />
      </div>
      {mode === 'advanced' ? (
        <ShortInput
          blockId={blockId}
          subBlockId={aggregateSubBlockId}
          config={{
            id: 'usageControlExpression',
            title: 'Permission Mode',
            type: 'short-input',
          }}
          value={tool.usageControlExpression ?? ''}
          onChange={onExpressionChange}
          placeholder='"auto", "force", or "none"'
          disabled={disabled}
          workflowSearchValuePath={[toolIndex, 'usageControlExpression']}
        />
      ) : (
        <Combobox
          options={MODE_OPTIONS.map((option) => ({
            ...option,
            disabled: option.value === 'force' && !supportsForce,
            suffixElement:
              option.value === 'force' && !supportsForce ? (
                <span className='text-[var(--text-tertiary)]'>(not supported by model)</span>
              ) : (
                option.suffixElement
              ),
            onSelect: () => onFixedChange(option.value),
          }))}
          value={tool.usageControl ?? 'auto'}
          disabled={disabled}
          aria-label='Permission Mode'
        />
      )}
    </div>
  )
}
