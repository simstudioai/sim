'use client'

import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import { Input } from '@sim/emcn/field/inputs'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { generateShortId } from '@sim/utils/id'
import styles from '@/app/(product)/_components/workspace/tables/table-filter/table-filter.module.css'
import {
  COMPARISON_OPERATORS,
  type ColumnDefinition,
  type FilterRule,
  filterRulesToPredicate,
  getColumnId,
  MULTI_SELECT_FILTER_OPERATORS,
  predicateToFilterRules,
  SINGLE_SELECT_FILTER_OPERATORS,
  type TablePredicate,
  VALUELESS_OPS,
} from '@/platform/lib/data/tables'

const SINGLE_SELECT_COMPARISON_OPERATORS = COMPARISON_OPERATORS.filter((operator) =>
  SINGLE_SELECT_FILTER_OPERATORS.has(operator.value)
)
const MULTI_SELECT_COMPARISON_OPERATORS = COMPARISON_OPERATORS.filter((operator) =>
  MULTI_SELECT_FILTER_OPERATORS.has(operator.value)
)

function selectFilterOperators(column: ColumnDefinition | undefined): Set<string> {
  return column?.multiple ? MULTI_SELECT_FILTER_OPERATORS : SINGLE_SELECT_FILTER_OPERATORS
}

function isCompleteRule(rule: FilterRule): boolean {
  return Boolean(rule.column && (rule.value || VALUELESS_OPS.has(rule.operator)))
}

/**
 * The predicate the complete rules express. An incomplete rule is held back; with
 * `preserveIncompleteBoundaries` it still marks where its OR group starts, so clearing the first
 * rule of a group does not merge that group into the one before it.
 */
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

function createRule(columns: ColumnDefinition[]): FilterRule {
  const first = columns[0]
  return {
    id: generateShortId(),
    logicalOperator: 'and',
    column: first ? getColumnId(first) : '',
    // A multiselect cannot be compared for equality, so it starts at membership.
    operator: first?.type === 'select' && first.multiple ? 'contains' : 'eq',
    value: '',
  }
}

interface TableFilterProps {
  columns: ColumnDefinition[]
  filter: TablePredicate | null
  onChange: (filter: TablePredicate | null) => void
}

/**
 * The table's filter builder, an inline panel above the grid: a "Where" rule followed by AND/OR
 * rules, each a column, an operator for that column's type and a value. Incomplete rules are held
 * back from the applied filter. Every complete edit applies at once, a rule whose
 * operator change left it incomplete keeps applying its previous complete form until the new one
 * is finished, and nothing is applied that matches what is already applied.
 */
export function TableFilter({ columns, filter, onChange }: TableFilterProps) {
  const lastAppliedFilterRef = useRef<string | undefined>(undefined)
  const deferredAppliedRulesRef = useRef<Map<string, FilterRule> | null>(null)
  const deferredAppliedRules = (deferredAppliedRulesRef.current ??= new Map())
  const [rules, setRules] = useState<FilterRule[]>(() => {
    const fromFilter = predicateToFilterRules(filter)
    return fromFilter.length > 0 ? fromFilter : [createRule(columns)]
  })
  const rulesRef = useRef(rules)
  rulesRef.current = rules
  // Seed the "already applied" signature from the rules the panel renders, not the raw prop: a
  // saved tree the flat builder cannot express (deeply nested groups, wire key order) round-trips
  // differently, and seeding from the prop would autosave that lossy form the moment the panel
  // opens. The normalized form persists only once the user really edits a rule.
  lastAppliedFilterRef.current ??= JSON.stringify(toAppliedPredicate(rules, columns))

  const applyRules = useCallback(
    (update: (current: FilterRule[]) => FilterRule[], deferIncompleteRuleId?: string) => {
      const currentRules = rulesRef.current
      const nextRules = update(currentRules)
      rulesRef.current = nextRules
      setRules(nextRules)

      const deferredRule = nextRules.find((rule) => rule.id === deferIncompleteRuleId)
      if (deferredRule && !isCompleteRule(deferredRule)) {
        const previouslyAppliedRule = currentRules.find((rule) => rule.id === deferredRule.id)
        if (
          previouslyAppliedRule &&
          isCompleteRule(previouslyAppliedRule) &&
          !deferredAppliedRules.has(deferredRule.id)
        ) {
          deferredAppliedRules.set(deferredRule.id, previouslyAppliedRule)
        }
      }

      const nextRulesById = new Map(nextRules.map((rule) => [rule.id, rule]))
      for (const [id] of deferredAppliedRules) {
        const nextRule = nextRulesById.get(id)
        if (!nextRule || isCompleteRule(nextRule)) deferredAppliedRules.delete(id)
      }

      const appliedRules = nextRules.map((rule) => {
        const deferred = deferredAppliedRules.get(rule.id)
        return deferred && !isCompleteRule(rule)
          ? { ...deferred, logicalOperator: rule.logicalOperator }
          : rule
      })

      const nextFilter = toAppliedPredicate(appliedRules, columns, true)
      const signature = JSON.stringify(nextFilter)
      if (signature === lastAppliedFilterRef.current) return
      lastAppliedFilterRef.current = signature
      onChange(nextFilter)
    },
    [columns, onChange]
  )

  // `value` is the filter's field key (the column id); `label` is what the reader sees.
  const columnOptions = useMemo(
    () => columns.map((column) => ({ value: getColumnId(column), label: column.name })),
    [columns]
  )
  const columnById = useMemo(
    () => new Map(columns.map((column) => [getColumnId(column), column])),
    [columns]
  )

  const handleAdd = useCallback(() => {
    applyRules((current) => [...current, createRule(columns)])
  }, [applyRules, columns])

  const handleRemove = useCallback(
    (id: string) => {
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
    [applyRules, columns]
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

  // Switching a rule's column across the select boundary changes which values and operators are
  // valid, so the value clears and an unsupported operator falls back; otherwise a stale free-text
  // value or a range operator would apply against a select column and be refused by the server.
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
            // Single and multiple selects take different operators, so a switch between them
            // falls back too, not just a switch to or from a select.
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

  return (
    <div className={styles.filter}>
      <div className={styles.rules}>
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
            onToggleLogical={handleToggleLogical}
          />
        ))}
      </div>
      <div className={styles.actions}>
        <Button variant='quiet' size='compact' icon='I074' onClick={handleAdd}>
          Add filter
        </Button>
      </div>
    </div>
  )
}

interface FilterRuleRowProps {
  rule: FilterRule
  isFirst: boolean
  columns: ReadonlyArray<{ value: string; label: string }>
  columnById: ReadonlyMap<string, ColumnDefinition>
  onUpdate: (id: string, field: keyof FilterRule, value: string) => void
  onColumnChange: (id: string, columnId: string) => void
  onRemove: (id: string) => void
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
  onToggleLogical,
}: FilterRuleRowProps) {
  // A column id no longer in the table (removed since) stays selectable and visible while the rule
  // still filters on it, instead of falling back to the first column.
  const columnOptions =
    rule.column && !columns.some((column) => column.value === rule.column)
      ? [...columns, { value: rule.column, label: rule.column }]
      : columns

  const selectedColumn = columnById.get(rule.column)
  const isSelect = selectedColumn?.type === 'select'
  const typeOperators: ReadonlyArray<{ value: string; label: string }> = !isSelect
    ? COMPARISON_OPERATORS
    : selectedColumn.multiple
      ? MULTI_SELECT_COMPARISON_OPERATORS
      : SINGLE_SELECT_COMPARISON_OPERATORS
  // A saved operator the picker does not offer (a null check written through the API) stays
  // visible as itself, rather than reading as the first operator while it still applies.
  const operatorOptions = typeOperators.some((operator) => operator.value === rule.operator)
    ? typeOperators
    : [...typeOperators, { value: rule.operator, label: rule.operator }]

  // An option id since deleted stays selectable, so the rule still shows what it filters on.
  const selectValueOptions = (selectedColumn?.options ?? []).map((option) => ({
    value: option.id,
    label: option.name,
  }))
  if (isSelect && rule.value && !selectValueOptions.some((option) => option.value === rule.value))
    selectValueOptions.push({ value: rule.value, label: rule.value })

  const otherOperator = rule.logicalOperator === 'and' ? 'or' : 'and'

  return (
    <div className={styles.rule}>
      {isFirst ? (
        <span className={styles.lead} data-type='T060'>
          Where
        </span>
      ) : (
        <span className={styles.logical}>
          <Button
            variant='quiet'
            size='compact'
            aria-label={`Joined by ${rule.logicalOperator}; switch to ${otherOperator}`}
            onClick={() => onToggleLogical(rule.id)}
          >
            {rule.logicalOperator}
          </Button>
        </span>
      )}

      <ChoiceMenu
        label='Column'
        options={columnOptions}
        value={rule.column}
        onValueChange={(value) => onColumnChange(rule.id, value)}
      />

      <ChoiceMenu
        label='Operator'
        options={operatorOptions}
        value={rule.operator}
        onValueChange={(value) => onUpdate(rule.id, 'operator', value)}
      />

      {VALUELESS_OPS.has(rule.operator) ? (
        <span />
      ) : isSelect ? (
        <SearchableSelect
          variant='text'
          label='Value'
          options={selectValueOptions}
          value={rule.value || null}
          onValueChange={(value) => onUpdate(rule.id, 'value', value ?? '')}
          placeholder='Select a value'
          searchLabel='Search options'
        />
      ) : (
        <FilterValueInput
          value={rule.value}
          onCommit={(value) => onUpdate(rule.id, 'value', value)}
        />
      )}

      <IconButton label='Remove filter' icon='I105' onClick={() => onRemove(rule.id)} />
    </div>
  )
})

interface FilterValueInputProps {
  value: string
  onCommit: (value: string) => void
}

/**
 * A locally buffered value field: keystrokes stay in the field until Enter or blur commits them,
 * as a spreadsheet cell does. Every click that leaves the panel (closing it, switching views,
 * navigating away) blurs the field first, so finishing by leaving commits without coordination. An
 * outside reseed, such as a column switch clearing the value, replaces the draft.
 */
function FilterValueInput({ value, onCommit }: FilterValueInputProps) {
  const [draft, setDraft] = useState(value)
  const [prevValue, setPrevValue] = useState(value)
  if (prevValue !== value) {
    setPrevValue(value)
    setDraft(value)
  }

  return (
    <span
      className={styles.value}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && draft !== value) onCommit(draft)
      }}
    >
      <Input
        label='Value'
        value={draft}
        onChange={setDraft}
        onBlur={() => {
          if (draft !== value) onCommit(draft)
        }}
        placeholder='Enter a value'
      />
    </span>
  )
}
