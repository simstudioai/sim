/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

import { PASSWORD_MASKED_SUBBLOCK_TYPES } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/password-mask'
import { getAllBlocks } from '@/blocks/registry'

/**
 * Fields that hold a credential and must stay concealed in the editor. Listed
 * explicitly so removing the flag to silence the audit below is itself a
 * failure — masking a secret is the point, not passing the check.
 */
const FIELDS_REQUIRING_MASKING: ReadonlyArray<{ block: string; subBlock: string }> = [
  { block: 'pi', subBlock: 'privateKey' },
  { block: 'sftp', subBlock: 'privateKey' },
  { block: 'ssh', subBlock: 'privateKey' },
  { block: 'secrets_manager', subBlock: 'secretValue' },
  { block: 'kalshi', subBlock: 'privateKey' },
  { block: 'sts', subBlock: 'webIdentityToken' },
  { block: 'sts', subBlock: 'samlAssertion' },
  { block: 'browser_use', subBlock: 'variables' },
]

const maskedTypes = new Set<string>(PASSWORD_MASKED_SUBBLOCK_TYPES)

describe('password masking coverage', () => {
  it('only flags password on sub-block types whose renderer masks', () => {
    const unmasked: string[] = []

    for (const block of getAllBlocks()) {
      for (const subBlock of block.subBlocks) {
        if (subBlock.password && !maskedTypes.has(subBlock.type)) {
          unmasked.push(`${block.type}.${subBlock.id} (type: ${subBlock.type})`)
        }
      }
    }

    expect(unmasked).toEqual([])
  })

  it('keeps every known credential field flagged for masking', () => {
    const blocksByType = new Map(getAllBlocks().map((block) => [block.type, block]))

    for (const { block, subBlock } of FIELDS_REQUIRING_MASKING) {
      const config = blocksByType.get(block)
      expect(config, `block ${block} is missing from the registry`).toBeDefined()

      const field = config?.subBlocks.find((candidate) => candidate.id === subBlock)
      expect(field, `${block}.${subBlock} is missing from the block config`).toBeDefined()
      expect(field?.password, `${block}.${subBlock} must be masked`).toBe(true)
      expect(maskedTypes.has(field?.type ?? ''), `${block}.${subBlock} renders in plaintext`).toBe(
        true
      )
    }
  })
})
