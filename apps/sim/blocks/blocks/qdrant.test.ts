/**
 * @vitest-environment node
 *
 * The block's skill `content` is prompt text an LLM reads and acts on, so it is
 * held to the same contract as `outputs`: it may only promise fields the tool
 * actually returns. Qdrant's upsert endpoint returns an `UpdateResult`
 * (`operation_id`, `status`) and no count of the points written.
 */
import { describe, expect, it } from 'vitest'
import { QdrantBlockMeta } from '@/blocks/blocks/qdrant'
import { UPSERT_RESULT_OUTPUT_PROPERTIES } from '@/tools/qdrant/types'

const upsertSkill = QdrantBlockMeta.skills.find((skill) => skill.name === 'upsert-points')

describe('QdrantBlockMeta upsert-points skill', () => {
  it('is registered', () => {
    expect(upsertSkill).toBeDefined()
  })

  it('does not instruct the model to read an upserted count the API never returns', () => {
    expect(Object.keys(UPSERT_RESULT_OUTPUT_PROPERTIES)).toEqual(['operation_id', 'status'])
    expect(upsertSkill?.content).not.toMatch(/upserted count/i)
    expect(upsertSkill?.content).not.toMatch(/how many points were upserted/i)
  })

  it('points the model at the fields the upsert response does carry', () => {
    expect(upsertSkill?.content).toMatch(/operation_id/)
    expect(upsertSkill?.content).toMatch(/status/)
  })
})
