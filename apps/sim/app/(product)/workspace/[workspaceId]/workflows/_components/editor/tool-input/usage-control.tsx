'use client'

import { Button } from '@sim/emcn/button'
import { Select } from '@sim/emcn/picker/select'
import { ActionField } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/field-label-row/field-label-row'
import { ShortInput } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/short-input/short-input'
import type { SubBlockConfig } from '@/platform/lib/data/workflow-editor'
import type { CanonicalMode, StoredTool } from '@/platform/lib/data/workflow-editor/tool-input'

type UsageControlValue = NonNullable<StoredTool['usageControl']>

const EXPRESSION_CONFIG = {
  id: 'usageControlExpression',
  title: 'Permission Mode',
  type: 'short-input',
} as const satisfies SubBlockConfig

const MODE_OPTIONS = [
  { value: 'auto', label: 'Auto', hint: 'model decides' },
  { value: 'force', label: 'Force', hint: 'always use' },
  { value: 'none', label: 'None', hint: 'disable tool' },
] as const satisfies ReadonlyArray<{ value: UsageControlValue; label: string; hint: string }>

interface ToolUsageControlProps {
  blockId: string
  /** The aggregate tool-input sub-block, which the expression field searches and references within. */
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

/**
 * Permission Mode for one agent tool. Selector mode picks a fixed `usageControl`; Variable mode
 * edits a `usageControlExpression` that must resolve to auto, force or none. Both values persist,
 * so swapping modes discards neither.
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
  const advanced = mode === 'advanced'
  return (
    <ActionField
      label='Permission Mode'
      actions={
        <Button
          variant='quiet'
          size='compact'
          aria-label={advanced ? 'Switch to selector' : 'Switch to variable'}
          disabled={disabled}
          onClick={onModeToggle}
        >
          {advanced ? 'Selector' : 'Variable'}
        </Button>
      }
    >
      {advanced ? (
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
        <Select<UsageControlValue>
          label='Permission Mode'
          value={tool.usageControl ?? 'auto'}
          onValueChange={onFixedChange}
          disabled={disabled}
          options={MODE_OPTIONS.map((option) => {
            const unsupported = option.value === 'force' && !supportsForce
            return {
              value: option.value,
              label: `${option.label} (${unsupported ? 'not supported by model' : option.hint})`,
              disabled: unsupported,
            }
          })}
        />
      )}
    </ActionField>
  )
}
