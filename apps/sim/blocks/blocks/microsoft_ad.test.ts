/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { SCOPE_DESCRIPTIONS } from '@/lib/oauth/utils'
import { MicrosoftAdBlock } from '@/blocks/blocks/microsoft_ad'
import * as microsoftAdTools from '@/tools/microsoft_ad'

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

    it('is the serialized default, so the empty case is the common case', () => {
      const accountEnabled = subBlock('accountEnabled')

      expect(accountEnabled.value?.()).toBe('')
      expect(accountEnabled.mode).toBeUndefined()
    })

    it('coerces an explicit update_user choice to a boolean', () => {
      const enabled = { operation: 'update_user', userId: 'user-1', accountEnabled: 'true' }
      const disabled = { operation: 'update_user', userId: 'user-1', accountEnabled: 'false' }

      expect({ ...enabled, ...buildParams(enabled) }.accountEnabled).toBe(true)
      expect({ ...disabled, ...buildParams(disabled) }.accountEnabled).toBe(false)
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

  describe('visibility tri-state', () => {
    it('clears the "No Change" default instead of forwarding an empty string', () => {
      const inputs = { operation: 'update_group', groupId: 'group-1', visibility: '' }
      const finalInputs = { ...inputs, ...buildParams(inputs) }

      expect(finalInputs.visibility).toBeUndefined()
    })

    it('passes an explicit visibility through on both operations', () => {
      const update = { operation: 'update_group', groupId: 'group-1', visibility: 'Public' }
      const create = {
        operation: 'create_group',
        visibility: '',
        visibilityCreate: 'HiddenMembership',
      }

      expect({ ...update, ...buildParams(update) }.visibility).toBe('Public')
      expect({ ...create, ...buildParams(create) }.visibility).toBe('HiddenMembership')
    })
  })

  describe('top coercion', () => {
    it('never forwards NaN for a non-numeric page size', () => {
      const inputs = { operation: 'list_users', top: 'all' }
      const finalInputs = { ...inputs, ...buildParams(inputs) }

      expect(finalInputs.top).toBeUndefined()
    })

    it('coerces a numeric page size', () => {
      const inputs = { operation: 'list_users', top: '100' }

      expect({ ...inputs, ...buildParams(inputs) }.top).toBe(100)
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

  /**
   * `User.ReadWrite.All` is listed on every `/users` read this block performs — list, get,
   * licenseDetails, registeredDevices, and ownedDevices — so `User.Read.All` was pure consent
   * noise.
   *
   * `Directory.Read.All` was required by exactly one call, `GET /subscribedSkus`, whose
   * permission table names `LicenseAssignment.Read.All` as least privileged and
   * `Directory.Read.All` only as a higher-privileged alternative — and does **not** list
   * `LicenseAssignment.ReadWrite.All`, so the write scope this block already holds does not
   * cover the read. Every other call is covered by a narrower scope in the list:
   * directory roles by `RoleManagement.ReadWrite.Directory`, group members by
   * `Group.ReadWrite.All`/`GroupMember.ReadWrite.All`, devices by `Device.Read.All`, audits by
   * `AuditLog.Read.All`, service principals by `Application.Read.All`, user app-role
   * assignments by `AppRoleAssignment.ReadWrite.All`, and CA policies by `Policy.Read.All`.
   *
   * `GroupMember.ReadWrite.All` is deliberately retained: `POST /groups/{id}/members/$ref`
   * accepts it and nothing else in this list for a user member.
   * @see https://learn.microsoft.com/en-us/graph/api/subscribedsku-list
   * @see https://learn.microsoft.com/en-us/graph/api/group-post-members
   */
  describe('requested OAuth scopes', () => {
    const requiredScopes =
      MicrosoftAdBlock.subBlocks.find((candidate) => candidate.id === 'credential')
        ?.requiredScopes ?? []

    it('does not request User.Read.All, which User.ReadWrite.All subsumes', () => {
      expect(requiredScopes).toContain('User.ReadWrite.All')
      expect(requiredScopes).not.toContain('User.Read.All')
    })

    it('requests the least-privileged scope for subscribedSkus, not Directory.Read.All', () => {
      expect(requiredScopes).toContain('LicenseAssignment.Read.All')
      expect(requiredScopes).not.toContain('Directory.Read.All')
    })

    it('keeps the scopes no retained scope covers', () => {
      expect(requiredScopes).toEqual(expect.arrayContaining(['GroupMember.ReadWrite.All']))
    })

    it('describes every scope it requests', () => {
      const undescribed = requiredScopes.filter((scope) => !SCOPE_DESCRIPTIONS[scope])
      expect(undescribed).toEqual([])
    })
  })

  /**
   * `getBlockOutputs` derives the referenceable schema from `blockConfig.outputs`, so a single
   * `response` entry made the tag dropdown offer `<microsoft_ad.response>` — which corresponds to
   * nothing, since every tool puts its fields at the top level of `output` — and left the real
   * outputs unreferenceable downstream.
   */
  describe('declared outputs', () => {
    const toolOutputKeys = new Set(
      Object.values(microsoftAdTools).flatMap((tool) => Object.keys(tool.outputs ?? {}))
    )
    const blockOutputKeys = new Set(Object.keys(MicrosoftAdBlock.outputs))

    it('declares every key its tools emit', () => {
      expect([...toolOutputKeys].filter((key) => !blockOutputKeys.has(key)).sort()).toEqual([])
    })

    it('declares nothing no tool emits', () => {
      expect([...blockOutputKeys].filter((key) => !toolOutputKeys.has(key)).sort()).toEqual([])
    })
  })
})
