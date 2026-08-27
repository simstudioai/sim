/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { BlockConfig } from '@/blocks/types'

const { blockHolder } = vi.hoisted(() => ({
  blockHolder: { config: undefined as BlockConfig | undefined },
}))

vi.mock('@/blocks', () => ({
  getBlock: (type: string) => (type === 'vercel' ? blockHolder.config : undefined),
}))

vi.mock('@/tools/metadata-outputs', () => ({
  getToolOutputsMetadata: () => undefined,
}))

import { VercelBlock } from '@/blocks/blocks/vercel'
import { getBlockOutputs } from '@/lib/workflows/blocks/block-outputs'

blockHolder.config = VercelBlock as unknown as BlockConfig

/** Resolves the outputs the picker shows for a given Vercel operation. */
function outputsFor(operation: string): Record<string, unknown> {
  return getBlockOutputs('vercel', { operation: { value: operation } })
}

/** Reads the option ids of a dropdown subBlock by id. */
function dropdownOptionIds(subBlockId: string): string[] {
  const subBlock = VercelBlock.subBlocks.find((entry) => entry.id === subBlockId)
  if (!subBlock) throw new Error(`subBlock ${subBlockId} not found`)
  const options = subBlock.options as Array<{ id: string }>
  return options.map((option) => option.id)
}

const STATUS_OPERATIONS = [
  'update_edge_config_items',
  'get_deployment',
  'cancel_deployment',
  'delete_alias',
  'create_check',
  'get_check',
  'update_check',
] as const

describe('vercel block status output', () => {
  it.each(STATUS_OPERATIONS)('surfaces status for %s', (operation) => {
    expect(outputsFor(operation)).toHaveProperty('status')
  })

  it('does not surface status for an operation that never emits it', () => {
    expect(outputsFor('list_projects')).not.toHaveProperty('status')
  })

  it('surfaces a real field for delete_alias, whose only response field is status', () => {
    expect(Object.keys(outputsFor('delete_alias'))).toContain('status')
  })
})

describe('vercel block deployment state outputs', () => {
  it.each(['cancel_deployment', 'delete_deployment'])('surfaces state for %s', (operation) => {
    expect(outputsFor(operation)).toHaveProperty('state')
  })

  it.each(['get_deployment', 'create_deployment'])(
    'surfaces readyState and not the phantom state for %s',
    (operation) => {
      const outputs = outputsFor(operation)
      expect(outputs).toHaveProperty('readyState')
      expect(outputs).not.toHaveProperty('state')
    }
  )

  it('documents every readyState value the spec declares', () => {
    const readyState = VercelBlock.outputs.readyState as { description: string } | undefined
    expect(readyState).toBeDefined()
    for (const value of [
      'BLOCKED',
      'BUILDING',
      'CANCELED',
      'ERROR',
      'INITIALIZING',
      'QUEUED',
      'READY',
    ]) {
      expect(readyState?.description).toContain(value)
    }
  })
})

describe('vercel block dropdowns', () => {
  it('does not offer a framework value the API rejects', () => {
    expect(dropdownOptionIds('framework')).not.toContain('other')
  })

  it('offers every deployment state the list filter accepts', () => {
    const ids = dropdownOptionIds('state')
    for (const value of [
      'BUILDING',
      'ERROR',
      'INITIALIZING',
      'QUEUED',
      'READY',
      'CANCELED',
      'BLOCKED',
    ]) {
      expect(ids).toContain(value)
    }
  })

  it('does not offer DELETED, which is a response-only deployment state', () => {
    expect(dropdownOptionIds('state')).not.toContain('DELETED')
  })
})

const DELETED_OPERATIONS = [
  'delete_project',
  'remove_project_domain',
  'delete_domain',
  'delete_dns_record',
  'delete_env_var',
  'delete_webhook',
  'delete_edge_config',
] as const

describe('vercel block deleted output', () => {
  it.each(DELETED_OPERATIONS)('surfaces deleted for %s', (operation) => {
    expect(outputsFor(operation)).toHaveProperty('deleted')
  })

  it.each(['delete_alias', 'delete_deployment'])(
    'does not surface a phantom deleted for %s',
    (operation) => {
      expect(outputsFor(operation)).not.toHaveProperty('deleted')
    }
  )
})
