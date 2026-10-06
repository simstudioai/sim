/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { PlaneBlock } from '@/blocks/blocks/plane'

const params = (input: Record<string, unknown>) => PlaneBlock.tools.config.params?.(input) ?? {}

describe('PlaneBlock params', () => {
  it('maps canvas-only field ids onto the tool params they fill', () => {
    expect(
      params({ operation: 'plane_get_work_item_by_identifier', workItemIdentifier: 'ENG-42' })
    ).toMatchObject({ identifier: 'ENG-42' })
    expect(
      params({ operation: 'plane_create_project', name: 'Eng', projectIdentifier: 'ENG' })
    ).toMatchObject({ identifier: 'ENG' })
    expect(
      params({
        operation: 'plane_create_link',
        linkUrl: 'https://github.com/org/repo/pull/1',
        linkTitle: 'PR 1',
      })
    ).toMatchObject({ url: 'https://github.com/org/repo/pull/1', title: 'PR 1' })
  })

  it('keeps values an agent passes under the tool param names', () => {
    expect(
      params({ operation: 'plane_get_work_item_by_identifier', identifier: 'ENG-42' })
    ).toMatchObject({ identifier: 'ENG-42' })
    expect(params({ operation: 'plane_create_project', identifier: 'ENG' })).toMatchObject({
      identifier: 'ENG',
    })
    const link = params({ operation: 'plane_create_link', url: 'https://x.dev', title: 'X' })
    expect(link).toMatchObject({ url: 'https://x.dev', title: 'X' })
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
