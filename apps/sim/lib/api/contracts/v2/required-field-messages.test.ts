/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { v2KnowledgeSearchBodySchema } from '@/lib/api/contracts/v2/knowledge'
import { v2CreateSkillBodySchema } from '@/lib/api/contracts/v2/skills'
import { v2CreateWorkflowBodySchema } from '@/lib/api/contracts/v2/workflows'

const workspaceId = '7a6cce2b-78b8-40bc-b8d3-0a2a6dfd9023'
const knowledgeBaseIds = ['ae814592-a730-4ad6-8741-b51e48843300']

function messageAt(
  result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } },
  field: string
) {
  return result.error?.issues.find((issue) => issue.path[0] === field)?.message
}

/**
 * A required field that is *omitted* and one that is *wrong-typed* are different
 * mistakes. Both used to answer with wording that pointed at the other: the
 * create bodies leaked Zod's default "expected string, received undefined" for an
 * omitted field, and the shared string primitives answered "… is required" for a
 * value that had in fact been supplied.
 */
describe('v2 create bodies name a missing required field', () => {
  it('POST /v2/workflows names an omitted name and types a wrong-typed one', () => {
    const missing = v2CreateWorkflowBodySchema.safeParse({ workspaceId })
    expect(messageAt(missing, 'name')).toBe('name is required')

    const wrongType = v2CreateWorkflowBodySchema.safeParse({ workspaceId, name: 123 })
    expect(messageAt(wrongType, 'name')).toBe('Invalid input: expected string, received number')

    const empty = v2CreateWorkflowBodySchema.safeParse({ workspaceId, name: '   ' })
    expect(messageAt(empty, 'name')).toBe('name is required')
  })

  it('POST /v2/workflows still names an omitted workspaceId', () => {
    const result = v2CreateWorkflowBodySchema.safeParse({ name: 'Triage' })
    expect(messageAt(result, 'workspaceId')).toBe('Workspace ID is required')
  })

  it('POST /v2/skills names each omitted required field', () => {
    const result = v2CreateSkillBodySchema.safeParse({ workspaceId })

    expect(messageAt(result, 'name')).toBe('Skill name is required')
    expect(messageAt(result, 'description')).toBe('Description is required')
    expect(messageAt(result, 'content')).toBe('Content is required')
  })

  it('POST /v2/skills types a wrong-typed field instead of calling it missing', () => {
    const result = v2CreateSkillBodySchema.safeParse({
      workspaceId,
      name: 'my-skill',
      description: 123,
      content: 'Body',
    })

    expect(messageAt(result, 'description')).toBe('Invalid input: expected string, received number')
  })

  it('POST /v2/skills keeps the bounds the shared field schemas carry', () => {
    const badName = v2CreateSkillBodySchema.safeParse({
      workspaceId,
      name: 'Not Kebab',
      description: 'A summary',
      content: 'Body',
    })
    expect(messageAt(badName, 'name')).toBe('Name must be kebab-case (e.g. my-skill)')

    const longContent = v2CreateSkillBodySchema.safeParse({
      workspaceId,
      name: 'my-skill',
      description: 'A summary',
      content: 'a'.repeat(50_001),
    })
    expect(messageAt(longContent, 'content')).toBe('Content is too large')

    expect(
      v2CreateSkillBodySchema.safeParse({
        workspaceId,
        name: 'my-skill',
        description: 'A summary',
        content: 'Body',
      }).success
    ).toBe(true)
  })
})

/**
 * `topK` is the one search field whose range violations answered with Zod's
 * default phrasing while every sibling — `limit`, `rerankerInputCount`,
 * `tagFilters`, `query` — named itself.
 */
describe('v2 knowledge search topK messages name the field', () => {
  it('names topK when it exceeds the maximum', () => {
    const result = v2KnowledgeSearchBodySchema.safeParse({
      workspaceId,
      knowledgeBaseIds,
      query: 'hello',
      topK: 101,
    })

    expect(messageAt(result, 'topK')).toBe('topK cannot exceed 100')
  })

  it('names topK when it is below the minimum', () => {
    const result = v2KnowledgeSearchBodySchema.safeParse({
      workspaceId,
      knowledgeBaseIds,
      query: 'hello',
      topK: 0,
    })

    expect(messageAt(result, 'topK')).toBe('topK must be at least 1')
  })

  it('keeps admitting a fractional topK for the use case to reject, and defaults to 10', () => {
    const fractional = v2KnowledgeSearchBodySchema.safeParse({
      workspaceId,
      knowledgeBaseIds,
      query: 'hello',
      topK: 2.5,
    })
    expect(fractional.success).toBe(true)

    const defaulted = v2KnowledgeSearchBodySchema.safeParse({
      workspaceId,
      knowledgeBaseIds,
      query: 'hello',
    })
    expect(defaulted.success && defaulted.data.topK).toBe(10)
  })
})

/**
 * The "query or tagFilters" rule arrived from v1 as a bare `.refine`, which
 * reports at path `[]` — a message no client could attach to a field.
 */
describe('v2 knowledge search reports the missing-input rule on a field', () => {
  it('attaches the failure to query', () => {
    const result = v2KnowledgeSearchBodySchema.safeParse({ workspaceId, knowledgeBaseIds })

    expect(result.success).toBe(false)
    expect(result.error?.issues).toHaveLength(1)
    expect(result.error?.issues[0]?.path).toEqual(['query'])
    expect(result.error?.issues[0]?.message).toBe('Either query or tagFilters must be provided')
  })

  it('still accepts a tag-only search and a query-only search', () => {
    expect(
      v2KnowledgeSearchBodySchema.safeParse({
        workspaceId,
        knowledgeBaseIds,
        tagFilters: [{ tagName: 'From', operator: 'contains', value: 'brex' }],
      }).success
    ).toBe(true)

    expect(
      v2KnowledgeSearchBodySchema.safeParse({ workspaceId, knowledgeBaseIds, query: 'hello' })
        .success
    ).toBe(true)
  })

  it('rejects a whitespace-only query with no tag filters, as v1 did', () => {
    const result = v2KnowledgeSearchBodySchema.safeParse({
      workspaceId,
      knowledgeBaseIds,
      query: '   ',
    })

    expect(result.success).toBe(false)
    expect(messageAt(result, 'query')).toBe('Either query or tagFilters must be provided')
  })
})
