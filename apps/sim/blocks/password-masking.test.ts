/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  { block: 'oracledb', subBlock: 'password' },
  { block: 'oracledb', subBlock: 'walletContent' },
  { block: 'oracledb', subBlock: 'walletPassword' },
]

const maskedTypes = new Set<string>(PASSWORD_MASKED_SUBBLOCK_TYPES)

const SUB_BLOCK_COMPONENTS_DIR = join(
  import.meta.dirname,
  '..',
  'app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components'
)

/**
 * The renderer file backing each masking sub-block type, relative to the
 * sub-block components directory. The exhaustive `Record` is the compile-time
 * gate: adding a type to `PASSWORD_MASKED_SUBBLOCK_TYPES` fails type-check until
 * its renderer is registered here and therefore audited below.
 */
const RENDERER_SOURCES: Record<(typeof PASSWORD_MASKED_SUBBLOCK_TYPES)[number], string> = {
  'short-input': 'short-input/short-input.tsx',
  'long-input': 'long-input/long-input.tsx',
  code: 'code/code.tsx',
  table: 'table/table.tsx',
}

/**
 * The exact form every renderer must use to decide masking: a `shouldMask`
 * binding whose entire right-hand side is a call to the shared policy helper.
 * Anything else — an extra conjunct, a locally recomputed predicate, an inlined
 * `password && !isFocused` — fails to match.
 */
const SHARED_MASK_DECISION = /const shouldMask = shouldMaskSecretValue\(\{[^})]*\}\)\n/

/**
 * The whole `shouldMask` statement, however many lines it spans: the declaring
 * line plus every continuation line, stopping at the next statement or comment.
 * A single-line scan would miss a conjunct wrapped onto its own line.
 */
const MASK_STATEMENT = /const shouldMask\b[^\n]*(?:\n(?!\s*(?:const |return |\/\*|\*)).*)*/g

/**
 * Signals a renderer must never mix into its masking decision. Workflow search
 * deliberately does not reveal a secret, so no search-derived value may reach
 * `shouldMask`.
 */
const FORBIDDEN_MASK_INPUTS = [
  'isSearchHighlighted',
  'getValidWorkflowSearchRange',
  'workflowSearchHighlight',
  'activeSearchTarget',
]

function readRendererSource(relativePath: string): string {
  return readFileSync(join(SUB_BLOCK_COMPONENTS_DIR, relativePath), 'utf8')
}

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

describe('password reveal policy', () => {
  it.each(PASSWORD_MASKED_SUBBLOCK_TYPES)(
    'derives the %s mask decision from the shared policy helper',
    (type) => {
      const source = readRendererSource(RENDERER_SOURCES[type])

      expect(
        source.includes('shouldMaskSecretValue') && source.includes("components/password-mask'"),
        `${type} must import shouldMaskSecretValue from the password-mask module`
      ).toBe(true)

      const decisions = source.match(new RegExp(SHARED_MASK_DECISION, 'g')) ?? []
      expect(decisions, `${type} must declare exactly one shared shouldMask decision`).toHaveLength(
        1
      )
    }
  )

  it.each(PASSWORD_MASKED_SUBBLOCK_TYPES)(
    'keeps workflow-search signals away from the %s mask decision',
    (type) => {
      const source = readRendererSource(RENDERER_SOURCES[type])
      const statements = source.match(MASK_STATEMENT) ?? []

      expect(statements.length, `${type} never declares shouldMask`).toBeGreaterThan(0)

      const leaked = statements.filter((statement) =>
        FORBIDDEN_MASK_INPUTS.some((signal) => statement.includes(signal))
      )
      expect(leaked, `${type} lets a workflow-search signal unmask a secret`).toEqual([])
    }
  )
})
