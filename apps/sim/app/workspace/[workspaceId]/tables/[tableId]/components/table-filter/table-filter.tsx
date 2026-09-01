'use client'

import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { Button, ChipDropdown, ChipInput, cn } from '@sim/emcn'
import { Plus, X } from '@sim/emcn/icons'
import { generateShortId } from '@sim/utils/id'
import type { ColumnDefinition, FilterRule, TablePredicate } from '@/lib/table'
import { getColumnId } from '@/lib/table/column-keys'
import {
  COMPARISON_OPERATORS,
  MULTI_SELECT_FILTER_OPERATORS,
  SINGLE_SELECT_FILTER_OPERATORS,
} from '@/lib/table/query-builder/constants'
import {
  filterRulesToPredicate,
  predicateToFilterRules,
  VALUELESS_OPS,
} from '@/lib/table/query-builder/converters'

const SINGLE_SELECT_COMPARISON_OPERATORS = COMPARISON_OPERATORS.filter((o) =>
  SINGLE_SELECT_FILTER_OPERATORS.has(o.value)
)
const MULTI_SELECT_COMPARISON_OPERATORS = COMPARISON_OPERATORS.filter((o) =>
  MULTI_SELECT_FILTER_OPERATORS.has(o.value)
)

function selectFilterOperators(column: ColumnDefinition | undefined): Set<string> {
  return column?.multiple ? MULTI_SELECT_FILTER_OPERATORS : SINGLE_SELECT_FILTER_OPERATORS
}

function toAppliedPredicate(
  rules: FilterRule[],
  columns: ColumnDefinition[],
  preserveIncompleteBoundaries = false
): TablePredicate | null {
  const validRules = preserveIncompleteBoundaries
    ? rules.map((rule) => (isCompleteRule(rule) ? rule : { ...rule, column: '' }))
    : rules.filter(isCompleteRule)
  return filterRulesToPredicate(validRules, columns)
}

function isCompleteRule(rule: FilterRule): boolean {
  return Boolean(rule.column && (rule.value || VALUELESS_OPS.has(rule.operator)))
}

interface TableFilterProps {
  columns: ColumnDefinition[]
  filter: TablePredicate | null
  autoApply?: boolean
  onChange: (filter: TablePredicate | null) => void
  onClose?: () => void
}

export function TableFilter({
  columns,
  filter,
  autoApply = false,
  onChange,
  onClose,
}: TableFilterProps) {
  const lastAppliedFilterRef = useRef<string | undefined>(undefined)
  const deferredAppliedRulesRef = useRef<Map<string, FilterRule>>(new Map())
  const [rules, setRules] = useState<FilterRule[]>(() => {
    const fromFilter = predicateToFilterRules(filter)
    return fromFilter.length > 0 ? fromFilter : [createRule(columns)]
  })
  const rulesRef = useRef(rules)
  rulesRef.current = rules
  // Seed the "already applied" signature from the rules the panel actually
  // renders, not the raw prop: a saved tree the flat builder cannot express
  // (deeply nested groups, wire key order) round-trips differently, and seeding
  // from the prop would fire an unedited autosave of that lossy form the
  // moment the panel opens. The normalized form persists only once the user
  // really edits a rule.
  lastAppliedFilterRef.current ??= JSON.stringify(toAppliedPredicate(rules, columns))

  const applyRules = useCallback(
    (update: (current: FilterRule[]) => FilterRule[], deferIncompleteRuleId?: string) => {
      const currentRules = rulesRef.current
      const nextRules = update(currentRules)
      rulesRef.current = nextRules
      setRules(nextRules)
      if (!autoApply) return

      const deferredRule = nextRules.find((rule) => rule.id === deferIncompleteRuleId)
      if (deferredRule && !isCompleteRule(deferredRule)) {
        const previouslyAppliedRule = currentRules.find((rule) => rule.id === deferredRule.id)
        if (previouslyAppliedRule && isCompleteRule(previouslyAppliedRule)) {
          const deferredRules = deferredAppliedRulesRef.current
          if (!deferredRules.has(deferredRule.id)) {
            deferredRules.set(deferredRule.id, previouslyAppliedRule)
          }
        }
      }

      const nextRulesById = new Map(nextRules.map((rule) => [rule.id, rule]))
      for (const [id] of deferredAppliedRulesRef.current) {
        const nextRule = nextRulesById.get(id)
        if (!nextRule || isCompleteRule(nextRule)) {
          deferredAppliedRulesRef.current.delete(id)
        }
      }

      const appliedRules = nextRules.map((rule) => {
        const deferredRule = deferredAppliedRulesRef.current.get(rule.id)
        return deferredRule && !isCompleteRule(rule)
          ? { ...deferredRule, logicalOperator: rule.logicalOperator }
          : rule
      })

      const nextFilter = toAppliedPredicate(appliedRules, columns, true)
      const signature = JSON.stringify(nextFilter)
      if (signature === lastAppliedFilterRef.current) return
      lastAppliedFilterRef.current = signature
      onChange(nextFilter)
    },
    [autoApply, columns, onChange]
  )

  // `value` is the filter field key (column id); `label` is what the user sees.
  const columnOptions = useMemo(
    () => columns.map((col) => ({ value: getColumnId(col), label: col.name })),
    [columns]
  )

  const columnById = useMemo(
    () => new Map(columns.map((col) => [getColumnId(col), col])),
    [columns]
  )

  const handleAdd = useCallback(() => {
    applyRules((current) => [...current, createRule(columns)])
  }, [applyRules, columns])

  const handleRemove = useCallback(
    (id: string) => {
      if (!autoApply) {
        const nextRules = rulesRef.current.filter((rule) => rule.id !== id)
        if (nextRules.length > 0) {
          rulesRef.current = nextRules
          setRules(nextRules)
          return
        }
        const resetRules = [createRule(columns)]
        rulesRef.current = resetRules
        setRules(resetRules)
        onChange(null)
        onClose?.()
        return
      }
      applyRules((current) => {
        const removedIndex = current.findIndex((rule) => rule.id === id)
        const removedRule = current[removedIndex]
        const next = current.filter((rule) => rule.id !== id)
        if (removedRule?.logicalOperator === 'or' && removedIndex < next.length) {
          next[removedIndex] = { ...next[removedIndex], logicalOperator: 'or' }
        }
        return next.length > 0 ? next : [createRule(columns)]
      })
    },
    [applyRules, autoApply, columns, onChange, onClose]
  )

  const handleUpdate = useCallback(
    (id: string, field: keyof FilterRule, value: string) => {
      applyRules(
        (current) => current.map((rule) => (rule.id === id ? { ...rule, [field]: value } : rule)),
        field === 'operator' ? id : undefined
      )
    },
    [applyRules]
  )

  const handleToggleLogical = useCallback(
    (id: string) => {
      applyRules((current) =>
        current.map((rule) =>
          rule.id === id
            ? { ...rule, logicalOperator: rule.logicalOperator === 'and' ? 'or' : 'and' }
            : rule
        )
      )
    },
    [applyRules]
  )

  // Switching a rule's column across the select boundary changes what values and
  // operators are valid, so clear the value and coerce an unsupported operator
  // back to `eq` — otherwise a stale free-text value or a range operator would
  // apply against a select column and be rejected server-side.
  const handleColumnChange = useCallback(
    (id: string, columnId: string) => {
      applyRules(
        (current) =>
          current.map((rule) => {
            if (rule.id !== id) return rule
            const previous = columnById.get(rule.column)
            const next = columnById.get(columnId)
            const wasSelect = previous?.type === 'select'
            const isSelect = next?.type === 'select'
            if (!wasSelect && !isSelect) return { ...rule, column: columnId }
            // Single- and multi-select take different operators, so a switch
            // between them has to fall back too, not just select ↔ non-select.
            const allowed = selectFilterOperators(next)
            const fallback = next?.multiple ? 'contains' : 'eq'
            const operator = isSelect && !allowed.has(rule.operator) ? fallback : rule.operator
            return { ...rule, column: columnId, operator, value: '' }
          }),
        id
      )
    },
    [applyRules, columnById]
  )

  const handleApply = useCallback(() => {
    onChange(toAppliedPredicate(rulesRef.current, columns))
  }, [columns, onChange])

  const handleClear = () => {
    const resetRules = [createRule(columns)]
    rulesRef.current = resetRules
    setRules(resetRules)
    onChange(null)
  }

  return (
    <div className='border-[var(--border)] border-b bg-[var(--bg)] px-4 py-2'>
      <div className='flex flex-col gap-1'>
        {rules.map((rule, index) => (
          <FilterRuleRow
            key={rule.id}
            rule={rule}
            isFirst={index === 0}
            columns={columnOptions}
            columnById={columnById}
            onUpdate={handleUpdate}
            onColumnChange={handleColumnChange}
            onRemove={handleRemove}
            autoApply={autoApply}
            onApply={handleApply}
            onToggleLogical={handleToggleLogical}
          />
        ))}

        <div className={cn('mt-1 flex items-center', !autoApply && 'justify-between')}>
          <Button
            variant='ghost'
            size='sm'
            onClick={handleAdd}
            className='px-2 py-1 text-[var(--text-secondary)] text-xs'
          >
            <Plus className='mr-1 size-[10px]' />
            Add filter
          </Button>
          {!autoApply && (
            <div className='flex items-center gap-1.5'>
              {filter !== null && (
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={handleClear}
                  className='px-2 py-1 text-[var(--text-secondary)] text-xs'
                >
                  Clear filters
                </Button>
              )}
              <Button variant='default' size='sm' onClick={handleApply} className='text-xs'>
                Apply filter
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface FilterRuleRowProps {
  rule: FilterRule
  isFirst: boolean
  columns: Array<{ value: string; label: string }>
  columnById: ReadonlyMap<string, ColumnDefinition>
  onUpdate: (id: string, field: keyof FilterRule, value: string) => void
  onColumnChange: (id: string, columnId: string) => void
  onRemove: (id: string) => void
  autoApply: boolean
  onApply: () => void
  onToggleLogical: (id: string) => void
}

const FilterRuleRow = memo(function FilterRuleRow({
  rule,
  isFirst,
  columns,
  columnById,
  onUpdate,
  onColumnChange,
  onRemove,
  autoApply,
  onApply,
  onToggleLogical,
}: FilterRuleRowProps) {
  // Keep a stale column id selectable/visible (e.g. after the column was
  // removed) instead of falling back to the placeholder while the rule still
  // filters on it.
  const columnOptions =
    rule.column && !columns.some((col) => col.value === rule.column)
      ? [...columns, { value: rule.column, label: rule.column }]
      : columns

  const selectedColumn = columnById.get(rule.column)
  const isSelect = selectedColumn?.type === 'select'
  const operatorOptions = !isSelect
    ? COMPARISON_OPERATORS
    : selectedColumn?.multiple
      ? MULTI_SELECT_COMPARISON_OPERATORS
      : SINGLE_SELECT_COMPARISON_OPERATORS

  // A stale id (option since deleted) stays selectable so the rule still shows.
  const selectValueOptions = isSelect
    ? (() => {
        const opts = (selectedColumn.options ?? []).map((o) => ({ value: o.id, label: o.name }))
        return rule.value && !opts.some((o) => o.value === rule.value)
          ? [...opts, { value: rule.value, label: rule.value }]
          : opts
      })()
    : []

  return (
    <div className='flex items-center gap-1.5'>
      {isFirst ? (
        <span className='w-[42px] shrink-0 text-right text-[var(--text-muted)] text-xs'>Where</span>
      ) : (
        <button
          onClick={() => onToggleLogical(rule.id)}
          className='w-[42px] shrink-0 rounded-full py-0.5 text-right text-[10px] text-[var(--text-muted)] uppercase tracking-wide transition-colors hover:text-[var(--text-secondary)]'
        >
          {rule.logicalOperator}
        </button>
      )}

      <ChipDropdown
        options={columnOptions}
        value={rule.column}
        onChange={(value) => onColumnChange(rule.id, value)}
        placeholder='Column'
        align='start'
        matchTriggerWidth={false}
        className='min-w-[100px]'
      />

      <ChipDropdown
        options={operatorOptions}
        value={rule.operator}
        onChange={(value) => onUpdate(rule.id, 'operator', value)}
        placeholder='Operator'
        align='start'
        matchTriggerWidth={false}
        className='min-w-[90px]'
      />

      {VALUELESS_OPS.has(rule.operator) ? (
        <div className='h-[30px] flex-1' />
      ) : isSelect ? (
        <ChipDropdown
          options={selectValueOptions}
          value={rule.value}
          onChange={(value) => onUpdate(rule.id, 'value', value)}
          placeholder='Select a value'
          align='start'
          matchTriggerWidth={false}
          className='min-w-[100px] flex-1'
        />
      ) : autoApply ? (
        <FilterValueInput
          value={rule.value}
          onCommit={(value) => onUpdate(rule.id, 'value', value)}
        />
      ) : (
        <ChipInput
          value={rule.value}
          onChange={(event) => onUpdate(rule.id, 'value', event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onApply()
          }}
          placeholder='Enter a value'
          className='flex-1'
        />
      )}

      <Button
        variant='ghost'
        size='sm'
        onClick={() => onRemove(rule.id)}
        className='!p-1 size-7 shrink-0'
        aria-label='Remove filter'
      >
        <X className='size-[12px]' />
      </Button>
    </div>
  )
})

interface FilterValueInputProps {
  value: string
  onCommit: (value: string) => void
}

/**
 * Locally buffered value field: keystrokes stay in the field until Enter or
 * blur commits them — the spreadsheet-cell contract. Every click-driven exit
 * from the panel (closing it, switching views, navigating away) blurs the
 * field first, so finishing-by-leaving commits without any imperative
 * coordination. An external reseed (column switch clearing the value, a view
 * replacement remount) adopts the incoming value over the draft.
 */
function FilterValueInput({ value, onCommit }: FilterValueInputProps) {
  const [draft, setDraft] = useState(value)
  const [prevValue, setPrevValue] = useState(value)
  if (prevValue !== value) {
    setPrevValue(value)
    setDraft(value)
  }

  return (
    <ChipInput
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && draft !== value) onCommit(draft)
      }}
      placeholder='Enter a value'
      className='flex-1'
    />
  )
}

function createRule(columns: ColumnDefinition[]): FilterRule {
  const first = columns[0]
  return {
    id: generateShortId(),
    logicalOperator: 'and',
    column: first ? getColumnId(first) : '',
    // A multi-select can't be compared for equality — default it to membership.
    operator: first?.type === 'select' && first.multiple ? 'contains' : 'eq',
    value: '',
  }
}
