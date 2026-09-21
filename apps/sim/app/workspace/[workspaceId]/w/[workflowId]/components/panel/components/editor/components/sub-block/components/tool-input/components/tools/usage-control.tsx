import { Combobox, Label } from '@sim/emcn'
import type { CanonicalMode } from '@/lib/workflows/subblocks/visibility'
import type { StoredTool } from '@/lib/workflows/tool-input/types'
import { FieldModeToggle } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/field-mode-toggle/field-mode-toggle'
import { ShortInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/short-input'
import type { SubBlockConfig } from '@/blocks/types'

type UsageControlValue = NonNullable<StoredTool['usageControl']>

interface ToolUsageControlProps {
  blockId: string
  aggregateSubBlockId: string
  toolIndex: number
  tool: StoredTool
  mode: CanonicalMode
  supportsForce: boolean
  disabled: boolean
  onFixedChange: (value: UsageControlValue) => void
  onExpressionChange: (value: string) => void
  onModeToggle: () => void
}

const MODE_OPTIONS = [
  { value: 'auto', label: 'Auto', hint: '(model decides)' },
  { value: 'force', label: 'Force', hint: '(always use)' },
  { value: 'none', label: 'None', hint: '(disable tool)' },
] as const satisfies ReadonlyArray<{ value: UsageControlValue; label: string; hint: string }>

const EXPRESSION_CONFIG = {
  id: 'usageControlExpression',
  title: 'Permission Mode',
  type: 'short-input',
} as const satisfies SubBlockConfig

function isUsageControlValue(value: string): value is UsageControlValue {
  return MODE_OPTIONS.some((option) => option.value === value)
}

/**
 * Permission Mode control for one agent tool. Selector mode picks a fixed `usageControl`, and
 * Variable mode edits a `usageControlExpression` that must resolve to auto, force, or none.
 * Both values are kept so toggling modes does not discard the inactive one.
 *
 * Renders the same label row, `Combobox`, and `ShortInput` as every other sub-block field, so
 * the control matches the tool params beneath it.
 */
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
  const toggleLabel = mode === 'advanced' ? 'Switch to selector' : 'Switch to variable'

  return (
    <div className='subblock-content flex w-full min-w-0 flex-col gap-2.5'>
      <div className='flex items-center justify-between gap-1.5 pl-0.5'>
        <Label className='flex items-baseline gap-1.5 whitespace-nowrap'>Permission Mode</Label>
        <div className='flex min-w-0 flex-1 items-center justify-end gap-1.5'>
          <FieldModeToggle
            active={mode === 'advanced'}
            label={toggleLabel}
            onClick={onModeToggle}
            disabled={disabled}
          />
        </div>
      </div>
      {mode === 'advanced' ? (
        <ShortInput
          blockId={blockId}
          subBlockId={aggregateSubBlockId}
          config={EXPRESSION_CONFIG}
          value={tool.usageControlExpression ?? ''}
          onChange={onExpressionChange}
          placeholder='"auto", "force", or "none"'
          disabled={disabled}
          workflowSearchValuePath={[toolIndex, 'usageControlExpression']}
        />
      ) : (
        <Combobox
          options={MODE_OPTIONS.map((option) => {
            const unsupported = option.value === 'force' && !supportsForce
            return {
              value: option.value,
              label: option.label,
              disabled: unsupported,
              suffixElement: (
                <span className='text-[var(--text-tertiary)]'>
                  {unsupported ? '(not supported by model)' : option.hint}
                </span>
              ),
            }
          })}
          value={tool.usageControl ?? 'auto'}
          onChange={(value) => {
            if (isUsageControlValue(value)) onFixedChange(value)
          }}
          editable={false}
          disabled={disabled}
          aria-label='Permission Mode'
        />
      )}
    </div>
  )
}
