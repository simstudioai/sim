'use client'

import { ChipCombobox, ChipDropdown, OverflowText } from '@sim/emcn'
import { type McpOperationPolicy, normalizeMcpOperationPolicy } from '@/lib/mcp/operation-policy'

export interface McpOperationChoice {
  serverId: string
  name: string
  description?: string
  serverName?: string
}

interface McpOperationPolicyEditorProps {
  value: unknown
  onChange: (policy: McpOperationPolicy) => void
  operations: McpOperationChoice[]
  disabled?: boolean
  isLoading?: boolean
  error?: string | null
}

/** Preserves exact saved entries, including deny entries absent from the current catalog. */
export function McpOperationPolicyEditor({
  value,
  onChange,
  operations,
  disabled,
  isLoading,
  error,
}: McpOperationPolicyEditorProps) {
  const policy = normalizeMcpOperationPolicy(value)
  const selected = policy.mode === 'all' ? [] : policy.operations
  const key = (operation: McpOperationChoice) =>
    JSON.stringify([operation.serverId, operation.name])
  const choices = new Map(operations.map((operation) => [key(operation), operation]))
  for (const operation of selected)
    if (!choices.has(key(operation))) choices.set(key(operation), operation)
  return (
    <div className='flex flex-col gap-2'>
      <ChipDropdown
        aria-label='Operations access'
        value={policy.mode}
        disabled={disabled}
        options={[
          { value: 'allow', label: 'Only selected' },
          { value: 'deny', label: 'All except selected' },
          { value: 'all', label: 'All permitted' },
        ]}
        onChange={(mode) => {
          if (mode === 'all') onChange({ mode })
          else if (mode === 'allow' || mode === 'deny') onChange({ mode, operations: selected })
        }}
      />
      {policy.mode !== 'all' && (
        <ChipCombobox
          multiSelect
          multiSelectValues={selected.map(key)}
          disabled={disabled}
          isLoading={isLoading}
          error={error}
          placeholder='Select operations'
          options={[...choices].map(([value, operation]) => ({
            value,
            label: operation.serverName
              ? `${operation.serverName}: ${operation.name}`
              : operation.name,
            ...(operation.description
              ? {
                  suffixElement: (
                    <OverflowText label={operation.description} className='max-w-48 text-caption' />
                  ),
                }
              : {}),
          }))}
          onMultiSelectChange={(values) =>
            onChange({
              mode: policy.mode as 'allow' | 'deny',
              operations: values.map((value) => {
                const operation = choices.get(value)
                if (!operation) throw new Error('Unknown MCP operation selection')
                return { serverId: operation.serverId, name: operation.name }
              }),
            })
          }
        />
      )}
      <p className='text-[var(--text-tertiary)] text-caption'>
        {policy.mode === 'allow'
          ? 'Only these exact operations can run. An empty selection grants no access.'
          : 'Credential and workspace permissions still apply.'}
      </p>
    </div>
  )
}
