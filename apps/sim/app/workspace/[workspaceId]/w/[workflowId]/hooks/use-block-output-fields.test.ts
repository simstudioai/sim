/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { createFieldFromOutput } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-block-output-fields'

describe('createFieldFromOutput', () => {
  it.each([
    ['untyped elements', { type: 'any' }],
    ['primitive elements', { type: 'string' }],
  ])('offers no child fields for an array of %s', (_, items) => {
    const field = createFieldFromOutput('rows', { type: 'array', items })
    expect(field.children).toBeUndefined()
  })

  it('offers the declared fields of object elements', () => {
    const field = createFieldFromOutput('rows', {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' } } },
    })
    expect(field.children?.map((child) => child.name)).toEqual(['id'])
  })
})
