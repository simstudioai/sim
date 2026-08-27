/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { v2ListKnowledgeBasesQuerySchema } from '@/lib/api/contracts/v2/knowledge'
import { v2ListTablesQuerySchema } from '@/lib/api/contracts/v2/tables'
import { v2ListWorkflowsQuerySchema } from '@/lib/api/contracts/v2/workflows'

/**
 * A v2 description is read on two surfaces at once: the API reference, where a
 * filter is `folderPath`, and `sim tables list --help`, where the same filter is
 * `--folder`. Naming either spelling is wrong on the other surface, so the
 * `scope` prose names the concept — "the folder filter" — the way the workflows
 * sibling already does. Asserted on both so the pair cannot drift apart again.
 */
const SCOPE_DESCRIPTIONS = [
  ['tables', v2ListTablesQuerySchema.shape.scope.description],
  ['workflows', v2ListWorkflowsQuerySchema.shape.scope.description],
  ['knowledge', v2ListKnowledgeBasesQuerySchema.shape.scope.description],
] as const

describe('v2 list scope descriptions', () => {
  it.each(SCOPE_DESCRIPTIONS)(
    'name the folder filter transport-neutrally on %s',
    (_, described) => {
      expect(described).toBeTypeOf('string')
      expect(described).toContain('The folder filter resolves against active folders only')
      expect(described).not.toContain('folderPath')
    }
  )
})
