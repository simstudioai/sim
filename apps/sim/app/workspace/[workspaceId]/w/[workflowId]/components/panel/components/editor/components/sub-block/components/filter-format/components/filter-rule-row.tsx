import { X } from 'lucide-react'
import { Button, Combobox, type ComboboxOption, Input } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { FilterRule } from '@/lib/table/query-builder/constants'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { SubBlockInputController } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/sub-block-input-controller'
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
  onRemove: (id: string) => void
  onUpdate: (id: string, field: keyof FilterRule, value: string) => void
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
  isPreview,
  disabled,
  onRemove,
  onUpdate,
}: FilterRuleRowProps) {
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  return (
    <div className='flex items-center gap-[6px]'>
      <Button
        variant='ghost'
        size='sm'
        onClick={() => onRemove(rule.id)}
        disabled={isReadOnly}
        className='h-[24px] w-[24px] shrink-0 p-0 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
      >
        <X className='h-[12px] w-[12px]' />
      </Button>

      <div className='w-[80px] shrink-0'>
        {index === 0 ? (
          <Combobox
            size='sm'
            options={[{ value: 'where', label: 'where' }]}
            value='where'
            disabled
          />
        ) : (
          <Combobox
            size='sm'
            options={logicalOptions}
            value={rule.logicalOperator}
            onChange={(v) => onUpdate(rule.id, 'logicalOperator', v as 'and' | 'or')}
            disabled={isReadOnly}
          />
        )}
      </div>

      <div className='w-[100px] shrink-0'>
        <Combobox
          size='sm'
          options={columns}
          value={rule.column}
          onChange={(v) => onUpdate(rule.id, 'column', v)}
          placeholder='Column'
          disabled={isReadOnly}
        />
      </div>

      <div className='w-[110px] shrink-0'>
        <Combobox
          size='sm'
          options={comparisonOptions}
          value={rule.operator}
          onChange={(v) => onUpdate(rule.id, 'operator', v)}
          disabled={isReadOnly}
        />
      </div>

      <div className='relative min-w-[80px] flex-1'>
        <SubBlockInputController
          blockId={blockId}
          subBlockId={`${subBlockId}_filter_${rule.id}`}
          config={{ id: `filter_value_${rule.id}`, type: 'short-input' }}
          value={rule.value}
          onChange={(newValue) => onUpdate(rule.id, 'value', newValue)}
          isPreview={isPreview}
          disabled={disabled}
        >
          {({ ref, value: ctrlValue, onChange, onKeyDown, onDrop, onDragOver }) => {
            const formattedText = formatDisplayText(ctrlValue, {
              accessiblePrefixes,
              highlightAll: !accessiblePrefixes,
            })

            return (
              <div className='relative'>
                <Input
                  ref={ref as React.RefObject<HTMLInputElement>}
                  className='h-[28px] w-full overflow-auto text-[12px] text-transparent caret-foreground [-ms-overflow-style:none] [scrollbar-width:none] placeholder:text-muted-foreground/50 [&::-webkit-scrollbar]:hidden'
                  value={ctrlValue}
                  onChange={onChange as (e: React.ChangeEvent<HTMLInputElement>) => void}
                  onKeyDown={onKeyDown as (e: React.KeyboardEvent<HTMLInputElement>) => void}
                  onDrop={onDrop as (e: React.DragEvent<HTMLInputElement>) => void}
                  onDragOver={onDragOver as (e: React.DragEvent<HTMLInputElement>) => void}
                  placeholder='Value'
                  disabled={isReadOnly}
                  autoComplete='off'
                />
                <div
                  className={cn(
                    'pointer-events-none absolute inset-0 flex items-center overflow-x-auto bg-transparent px-[8px] py-[6px] font-medium font-sans text-[12px] text-foreground [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
                    (isPreview || disabled) && 'opacity-50'
                  )}
                >
                  <div className='min-w-fit whitespace-pre'>{formattedText}</div>
                </div>
              </div>
            )
          }}
        </SubBlockInputController>
      </div>
    </div>
  )
}
