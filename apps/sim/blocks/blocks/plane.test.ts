/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { PlaneBlock } from '@/blocks/blocks/plane'

const params = (input: Record<string, unknown>) => PlaneBlock.tools.config.params?.(input) ?? {}

describe('PlaneBlock params', () => {
  it('passes fields named after tool params through unchanged, from the canvas or an agent', () => {
    expect(
      params({ operation: 'plane_get_work_item_by_identifier', identifier: 'ENG-42' })
    ).toMatchObject({ identifier: 'ENG-42' })
    expect(params({ operation: 'plane_create_project', identifier: 'ENG' })).toMatchObject({
      identifier: 'ENG',
    })
    expect(
      params({ operation: 'plane_create_project', projectIdentifier: 'OPS', identifier: 'ENG' })
    ).toMatchObject({ identifier: 'OPS' })
    expect(
      params({ operation: 'plane_create_project', projectIdentifier: '', identifier: 'ENG' })
    ).toMatchObject({ identifier: 'ENG' })
    expect(
      params({
        operation: 'plane_get_work_item_by_identifier',
        identifier: 'ENG-1',
        projectIdentifier: 'OPS',
      })
    ).toMatchObject({ identifier: 'ENG-1' })
    expect(
      params({ operation: 'plane_create_link', url: 'https://x.dev', title: 'X' })
    ).toMatchObject({ url: 'https://x.dev', title: 'X' })
    expect(params({ operation: 'plane_create_label', parentId: 'label-1' })).toMatchObject({
      parentId: 'label-1',
    })
  })

  it('turns comma-separated and array ID lists into arrays and numbers into numbers', () => {
    expect(
      params({
        operation: 'plane_update_work_item',
        assigneeIds: 'user-1, user-2',
        labelIds: ['label-1'],
        perPage: '25',
      })
    ).toMatchObject({ assigneeIds: ['user-1', 'user-2'], labelIds: ['label-1'], perPage: 25 })
    expect(
      params({ operation: 'plane_add_work_items_to_cycle', workItemIds: '["a","b"]' })
    ).toMatchObject({ workItemIds: ['a', 'b'] })
  })

  it('requires a file for uploads', () => {
    expect(() => params({ operation: 'plane_upload_attachment' })).toThrow(
      'A file is required to upload an attachment.'
    )
  })
})
