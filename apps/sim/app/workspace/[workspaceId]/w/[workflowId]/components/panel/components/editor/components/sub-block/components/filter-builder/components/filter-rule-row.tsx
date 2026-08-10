import { useRef } from 'react'
import {
  Badge,
  Button,
  ChipCombobox,
  CollapsibleCard,
  type ComboboxOption,
  Label,
  Trash,
} from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import type { FilterRule } from '@/lib/table/query-builder/constants'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { ReferenceTextInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/reference-text-control'
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

  const syncOverlayScroll = (scrollLeft: number) => {
    if (overlayRef.current) overlayRef.current.scrollLeft = scrollLeft
  }

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

  const renderValueInput = () => (
    <div className='relative'>
      <ReferenceTextInput
        ref={valueInputRef}
        overlayRef={overlayRef}
        overlayContent={
          <div className='min-w-fit whitespace-pre'>
            {formatDisplayText(
              rule.value,
              accessiblePrefixes
                ? { accessiblePrefixes, workflowSearchHighlight }
                : { highlightAll: true, workflowSearchHighlight }
            )}
          </div>
        }
        interactiveOverlay={isReadOnly}
        inputClassName='allow-scroll'
        value={rule.value}
        onChange={handlers.onChange}
        onKeyDown={handlers.onKeyDown}
        onDrop={handlers.onDrop}
        onDragOver={handlers.onDragOver}
        onFocus={handlers.onFocus}
        onScroll={(e) => syncOverlayScroll(e.currentTarget.scrollLeft)}
        onPaste={() =>
          setTimeout(() => {
            if (valueInputRef.current) {
              syncOverlayScroll(valueInputRef.current.scrollLeft)
            }
          }, 0)
        }
        disabled={isReadOnly}
        autoComplete='off'
        placeholder='Enter value'
        className='w-full'
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
          <ChipCombobox
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
        <ChipCombobox
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
        <ChipCombobox
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
      title={
        rule.collapsed && rule.column
          ? formatDisplayText(getColumnLabel(rule.column), {
              workflowSearchHighlight: getLabelHighlight('column', getColumnLabel(rule.column)),
            })
          : `Condition ${index + 1}`
      }
      badge={
        rule.collapsed && rule.column ? (
          <Badge variant='type' size='sm'>
            {formatDisplayText(getOperatorLabel(rule.operator), {
              workflowSearchHighlight: getLabelHighlight(
                'operator',
                getOperatorLabel(rule.operator)
              ),
            })}
          </Badge>
        ) : undefined
      }
      actions={
        <>
          <Button
            variant='quiet'
            size='icon'
            onClick={onAdd}
            disabled={isReadOnly}
            aria-label='Add condition'
          >
            <Plus className='size-[14px]' />
          </Button>
          <Button
            variant='quiet'
            size='icon'
            onClick={() => onRemove(rule.id)}
            disabled={isReadOnly}
            aria-label='Delete condition'
          >
            <Trash className='size-[14px] text-[var(--text-error)]' />
          </Button>
        </>
      }
      collapsed={rule.collapsed ?? false}
      onToggleCollapse={() => onToggleCollapse(rule.id)}
    >
      {renderContent()}
    </CollapsibleCard>
  )
}
