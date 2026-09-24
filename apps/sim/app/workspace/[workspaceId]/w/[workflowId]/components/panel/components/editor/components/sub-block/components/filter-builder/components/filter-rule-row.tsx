import { useRef } from 'react'
import {
  Badge,
  Button,
  CollapsibleCard,
  Combobox,
  type ComboboxOption,
  cn,
  Label,
  OverflowText,
  Trash,
} from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import type { FilterRule } from '@/lib/table/query-builder/constants'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { MirroredInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/mirrored-field/mirrored-field'
import { TagDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import {
  getActiveWorkflowSearchHighlight,
  getWorkflowSearchLabelHighlight,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import type { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-input'
import { useActiveSearchTarget } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'

interface FilterRuleRowProps {
  blockId: string
  subBlockId: string
  rule: FilterRule
  index: number
  columns: ComboboxOption[]
  comparisonOptions: ComboboxOption[]
  logicalOptions: ComboboxOption[]
  isReadOnly: boolean
  isPreview: boolean
  disabled: boolean
  onAdd: () => void
  onRemove: (id: string) => void
  onUpdate: (id: string, field: keyof FilterRule, value: string) => void
  onToggleCollapse: (id: string) => void
  inputController: ReturnType<typeof useSubBlockInput>
}

export function FilterRuleRow({
  blockId,
  subBlockId,
  rule,
  index,
  columns,
  comparisonOptions,
  logicalOptions,
  isReadOnly,
  onAdd,
  onRemove,
  onUpdate,
  onToggleCollapse,
  inputController,
}: FilterRuleRowProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const valueInputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const cellKey = `filter-${rule.id}-value`
  const fieldState = inputController.fieldHelpers.getFieldState(cellKey)
  const handlers = inputController.fieldHelpers.createFieldHandlers(
    cellKey,
    rule.value,
    (newValue) => onUpdate(rule.id, 'value', newValue)
  )
  const tagSelectHandler = inputController.fieldHelpers.createTagSelectHandler(
    cellKey,
    rule.value,
    (newValue) => onUpdate(rule.id, 'value', newValue)
  )
  const workflowSearchHighlight = getActiveWorkflowSearchHighlight({
    activeSearchTarget,
    blockId,
    subBlockId,
    valuePath: [index, 'value'],
  })

  const getOperatorLabel = (value: string) => {
    const option = comparisonOptions.find((op) => op.value === value)
    return option?.label || value
  }

  const getColumnLabel = (value: string) => {
    const option = columns.find((col) => col.value === value)
    return option?.label || value
  }

  const getLabelHighlight = (field: 'column' | 'operator' | 'logicalOperator', label: string) =>
    getWorkflowSearchLabelHighlight({
      activeSearchTarget,
      blockId,
      subBlockId,
      valuePath: [index, field],
      label,
    })

  const renderTitle = () => (
    <span className='flex min-w-0 items-center gap-2'>
      <OverflowText
        label={
          rule.collapsed && rule.column ? getColumnLabel(rule.column) : `Condition ${index + 1}`
        }
        focusTarget='nearest-interactive'
      >
        {rule.collapsed && rule.column
          ? formatDisplayText(getColumnLabel(rule.column), {
              workflowSearchHighlight: getLabelHighlight('column', getColumnLabel(rule.column)),
            })
          : `Condition ${index + 1}`}
      </OverflowText>
      {rule.collapsed && rule.column && (
        <Badge variant='type' size='sm'>
          {formatDisplayText(getOperatorLabel(rule.operator), {
            workflowSearchHighlight: getLabelHighlight('operator', getOperatorLabel(rule.operator)),
          })}
        </Badge>
      )}
    </span>
  )

  const renderActions = () => (
    <>
      <Button variant='ghost' onClick={onAdd} disabled={isReadOnly} size='icon'>
        <Plus className='size-[14px]' />
        <span className='sr-only'>Add Condition</span>
      </Button>
      <Button
        variant='ghost-destructive'
        onClick={() => onRemove(rule.id)}
        disabled={isReadOnly}
        size='icon'
      >
        <Trash className='size-[14px]' />
        <span className='sr-only'>Delete Condition</span>
      </Button>
    </>
  )

  const renderValueInput = () => (
    <div className='relative'>
      <MirroredInput
        ref={valueInputRef}
        value={rule.value}
        onChange={handlers.onChange}
        onKeyDown={handlers.onKeyDown}
        onDrop={handlers.onDrop}
        onDragOver={handlers.onDragOver}
        onFocus={handlers.onFocus}
        disabled={isReadOnly}
        autoComplete='off'
        placeholder='Enter value'
        className='allow-scroll w-full overflow-auto'
        overlayRef={overlayRef}
        overlayClassName={cn(
          'absolute inset-0 flex items-center overflow-x-auto bg-transparent px-2 py-1.5 font-sans text-sm',
          !isReadOnly && 'pointer-events-none'
        )}
        overlay={
          <div className='w-full whitespace-pre' style={{ minWidth: 'fit-content' }}>
            {formatDisplayText(
              rule.value,
              accessiblePrefixes
                ? { accessiblePrefixes, workflowSearchHighlight }
                : { highlightAll: true, workflowSearchHighlight }
            )}
          </div>
        }
      />
      {fieldState.showTags && (
        <TagDropdown
          visible={fieldState.showTags}
          onSelect={tagSelectHandler}
          blockId={blockId}
          activeSourceBlockId={fieldState.activeSourceBlockId}
          inputValue={rule.value}
          cursorPosition={fieldState.cursorPosition}
          onClose={() => inputController.fieldHelpers.hideFieldDropdowns(cellKey)}
          inputRef={valueInputRef.current ? { current: valueInputRef.current } : undefined}
        />
      )}
    </div>
  )

  const renderContent = () => (
    <>
      {index > 0 && (
        <div className='flex flex-col gap-1.5'>
          <Label className='text-small'>Logic</Label>
          <Combobox
            options={logicalOptions}
            value={rule.logicalOperator}
            onChange={(v) => onUpdate(rule.id, 'logicalOperator', v as 'and' | 'or')}
            disabled={isReadOnly}
            overlayContent={
              getLabelHighlight('logicalOperator', rule.logicalOperator) ? (
                <span className='truncate text-[var(--text-primary)]'>
                  {formatDisplayText(rule.logicalOperator, {
                    workflowSearchHighlight: getLabelHighlight(
                      'logicalOperator',
                      rule.logicalOperator
                    ),
                  })}
                </span>
              ) : undefined
            }
          />
        </div>
      )}

      <div className='flex flex-col gap-1.5'>
        <Label className='text-small'>Column</Label>
        <Combobox
          options={columns}
          value={rule.column}
          onChange={(v) => onUpdate(rule.id, 'column', v)}
          disabled={isReadOnly}
          placeholder='Select column'
          overlayContent={
            getLabelHighlight('column', getColumnLabel(rule.column)) ? (
              <span className='truncate text-[var(--text-primary)]'>
                {formatDisplayText(getColumnLabel(rule.column), {
                  workflowSearchHighlight: getLabelHighlight('column', getColumnLabel(rule.column)),
                })}
              </span>
            ) : undefined
          }
        />
      </div>

      <div className='flex flex-col gap-1.5'>
        <Label className='text-small'>Operator</Label>
        <Combobox
          options={comparisonOptions}
          value={rule.operator}
          onChange={(v) => onUpdate(rule.id, 'operator', v)}
          disabled={isReadOnly}
          placeholder='Select operator'
          overlayContent={
            getLabelHighlight('operator', getOperatorLabel(rule.operator)) ? (
              <span className='truncate text-[var(--text-primary)]'>
                {formatDisplayText(getOperatorLabel(rule.operator), {
                  workflowSearchHighlight: getLabelHighlight(
                    'operator',
                    getOperatorLabel(rule.operator)
                  ),
                })}
              </span>
            ) : undefined
          }
        />
      </div>

      <div className='flex flex-col gap-1.5'>
        <Label className='text-small'>Value</Label>
        {renderValueInput()}
      </div>
    </>
  )

  return (
    <CollapsibleCard
      data-filter-id={rule.id}
      role='group'
      aria-label={`Condition ${index + 1}`}
      title={renderTitle()}
      actions={renderActions()}
      collapsed={Boolean(rule.collapsed)}
      onToggleCollapse={() => onToggleCollapse(rule.id)}
    >
      {!rule.collapsed && renderContent()}
    </CollapsibleCard>
  )
}
