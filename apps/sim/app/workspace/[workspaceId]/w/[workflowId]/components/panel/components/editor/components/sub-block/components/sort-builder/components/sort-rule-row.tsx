import {
  Badge,
  Button,
  CollapsibleCard,
  Combobox,
  type ComboboxOption,
  Label,
  OverflowText,
  Trash,
} from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import type { SortRule } from '@/lib/table/query-builder/constants'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { getWorkflowSearchLabelHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useActiveSearchTarget } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'

interface SortRuleRowProps {
  rule: SortRule
  index: number
  columns: ComboboxOption[]
  directionOptions: ComboboxOption[]
  isReadOnly: boolean
  blockId: string
  subBlockId: string
  onAdd: () => void
  onRemove: (id: string) => void
  onUpdate: (id: string, field: keyof SortRule, value: string) => void
  onToggleCollapse: (id: string) => void
}

export function SortRuleRow({
  rule,
  index,
  columns,
  directionOptions,
  isReadOnly,
  blockId,
  subBlockId,
  onAdd,
  onRemove,
  onUpdate,
  onToggleCollapse,
}: SortRuleRowProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const getDirectionLabel = (value: string) => {
    const option = directionOptions.find((dir) => dir.value === value)
    return option?.label || value
  }

  const getColumnLabel = (value: string) => {
    const option = columns.find((col) => col.value === value)
    return option?.label || value
  }

  const getLabelHighlight = (field: 'column' | 'direction', label: string) =>
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
        label={rule.collapsed && rule.column ? getColumnLabel(rule.column) : `Sort ${index + 1}`}
        focusTarget='nearest-interactive'
      >
        {rule.collapsed && rule.column
          ? formatDisplayText(getColumnLabel(rule.column), {
              workflowSearchHighlight: getLabelHighlight('column', getColumnLabel(rule.column)),
            })
          : `Sort ${index + 1}`}
      </OverflowText>
      {rule.collapsed && rule.column && (
        <Badge variant='type' size='sm'>
          {formatDisplayText(getDirectionLabel(rule.direction), {
            workflowSearchHighlight: getLabelHighlight(
              'direction',
              getDirectionLabel(rule.direction)
            ),
          })}
        </Badge>
      )}
    </span>
  )

  const renderActions = () => (
    <>
      <Button variant='ghost' onClick={onAdd} disabled={isReadOnly} size='bare'>
        <Plus className='size-[14px]' />
        <span className='sr-only'>Add Sort</span>
      </Button>
      <Button
        variant='ghost-destructive'
        onClick={() => onRemove(rule.id)}
        disabled={isReadOnly}
        size='bare'
      >
        <Trash className='size-[14px]' />
        <span className='sr-only'>Delete Sort</span>
      </Button>
    </>
  )

  const renderContent = () => (
    <>
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
        <Label className='text-small'>Direction</Label>
        <Combobox
          options={directionOptions}
          value={rule.direction}
          onChange={(v) => onUpdate(rule.id, 'direction', v as 'asc' | 'desc')}
          disabled={isReadOnly}
          placeholder='Select direction'
          overlayContent={
            getLabelHighlight('direction', getDirectionLabel(rule.direction)) ? (
              <span className='truncate text-[var(--text-primary)]'>
                {formatDisplayText(getDirectionLabel(rule.direction), {
                  workflowSearchHighlight: getLabelHighlight(
                    'direction',
                    getDirectionLabel(rule.direction)
                  ),
                })}
              </span>
            ) : undefined
          }
        />
      </div>
    </>
  )

  return (
    <CollapsibleCard
      data-sort-id={rule.id}
      role='group'
      aria-label={`Sort ${index + 1}`}
      title={renderTitle()}
      actions={renderActions()}
      collapsed={Boolean(rule.collapsed)}
      onToggleCollapse={() => onToggleCollapse(rule.id)}
    >
      {!rule.collapsed && renderContent()}
    </CollapsibleCard>
  )
}
