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

  const renderContent = () => (
    <>
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
        <Label className='text-small'>Direction</Label>
        <ChipCombobox
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
      title={
        rule.collapsed && rule.column
          ? formatDisplayText(getColumnLabel(rule.column), {
              workflowSearchHighlight: getLabelHighlight('column', getColumnLabel(rule.column)),
            })
          : `Sort ${index + 1}`
      }
      badge={
        rule.collapsed && rule.column ? (
          <Badge variant='type' size='sm'>
            {formatDisplayText(getDirectionLabel(rule.direction), {
              workflowSearchHighlight: getLabelHighlight(
                'direction',
                getDirectionLabel(rule.direction)
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
            aria-label='Add sort'
          >
            <Plus className='size-[14px]' />
          </Button>
          <Button
            variant='quiet'
            size='icon'
            onClick={() => onRemove(rule.id)}
            disabled={isReadOnly}
            aria-label='Delete sort'
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
