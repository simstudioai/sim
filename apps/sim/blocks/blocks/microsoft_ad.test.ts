import { describe, expect, it } from 'vitest'
import { MicrosoftAdBlock } from '@/blocks/blocks/microsoft_ad'

/**
 * The tri-state assertions run against `{ ...inputs, ...buildParams(inputs) }`, the shape the
 * generic tool handler actually forwards. A key the mapper merely omits is *not* dropped by that
 * merge — the raw subBlock string survives — so asserting on the mapper's return alone would
 * pass against the broken code.
 */
describe('MicrosoftAdBlock', () => {
  const buildParams = MicrosoftAdBlock.tools.config.params!

  const subBlock = (id: string) =>
    MicrosoftAdBlock.subBlocks.find((candidate) => candidate.id === id)!

  describe('accountEnabled tri-state', () => {
    it('clears the "No Change" default instead of forwarding an empty string', () => {
      const inputs = { operation: 'update_user', userId: 'user-1', accountEnabled: '' }
      const finalInputs = { ...inputs, ...buildParams(inputs) }

      expect(finalInputs.accountEnabled).toBeUndefined()
    })

    it('coerces the create_user choice to a boolean and clears the update-side value', () => {
      const inputs = {
        operation: 'create_user',
        displayName: 'Ada',
        accountEnabled: '',
        accountEnabledCreate: 'false',
      }
      const finalInputs = { ...inputs, ...buildParams(inputs) }

      expect(finalInputs.accountEnabled).toBe(false)
    })
  })

  describe('top coercion', () => {
    it('never forwards NaN for a non-numeric page size', () => {
      const inputs = { operation: 'list_users', top: 'all' }
      const finalInputs = { ...inputs, ...buildParams(inputs) }

      expect(finalInputs.top).toBeUndefined()
    })
  })

  describe('groupId requirement', () => {
    it('requires a Group ID for list_group_members on the first page', () => {
      const required = subBlock('groupId').required as (values?: Record<string, unknown>) => {
        field: string
        value: string[]
      }

      expect(required({}).value).toContain('list_group_members')
    })

    it('drops the requirement only while continuing from a nextLink', () => {
      const required = subBlock('groupId').required as (values?: Record<string, unknown>) => {
        field: string
        value: string[]
      }
      const { value } = required({ nextLink: 'https://graph.microsoft.com/v1.0/groups/g/members' })

      expect(value).not.toContain('list_group_members')
      expect(value).toEqual(
        expect.arrayContaining([
          'get_group',
          'update_group',
          'delete_group',
          'add_group_member',
          'remove_group_member',
        ])
      )
    })
  })
})
