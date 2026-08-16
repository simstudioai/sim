/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OktaBlock } from '@/blocks/blocks/okta'
import { oktaGetLogsTool } from '@/tools/okta/get_logs'
import { oktaGetUserTool } from '@/tools/okta/get_user'
import { oktaUpdateGroupTool } from '@/tools/okta/update_group'
import { oktaUpdateUserTool } from '@/tools/okta/update_user'
import { mergeOktaGroupProfile } from '@/tools/okta/utils'

const AUTH = { apiKey: 'token', domain: 'dev-123456.okta.com' }

/** Narrows a declarative `body` builder's union return to a plain object. */
function builtBody(build: () => unknown): Record<string, unknown> {
  return build() as Record<string, unknown>
}

/**
 * Mirrors `generic-handler.ts`, which spreads the mapper's result over the raw
 * serialized inputs. A key the mapper omits keeps its raw subBlock value, so a
 * guard is only real if it survives this merge.
 */
function mergedBlockParams(inputs: Record<string, unknown>): Record<string, unknown> {
  const mapper = OktaBlock.tools.config?.params
  if (!mapper) throw new Error('Okta block defines no params mapper')
  return { ...inputs, ...mapper(inputs) }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('okta update_group profile merge', () => {
  it('keeps the stored description when the caller omits it', () => {
    const merged = mergeOktaGroupProfile(
      { name: 'Engineering', description: 'All engineers' },
      { name: 'Engineering EMEA' }
    )

    expect(merged.name).toBe('Engineering EMEA')
    expect(merged.description).toBe('All engineers')
  })

  it('keeps org-defined custom profile attributes across the replace', () => {
    const merged = mergeOktaGroupProfile(
      { name: 'Engineering', description: 'All engineers', costCenter: 'CC-42' },
      { name: 'Engineering', description: 'Updated' }
    )

    expect(merged.costCenter).toBe('CC-42')
    expect(merged.description).toBe('Updated')
  })

  it('still applies an explicitly supplied empty description', () => {
    const merged = mergeOktaGroupProfile(
      { name: 'Engineering', description: 'All engineers' },
      { name: 'Engineering', description: '' }
    )

    expect(merged.description).toBe('')
  })

  it('reads the group before replacing it and PUTs the merged profile', async () => {
    const stored = {
      id: '00g1',
      created: '2026-01-01T00:00:00.000Z',
      lastUpdated: '2026-01-01T00:00:00.000Z',
      lastMembershipUpdated: null,
      type: 'OKTA_GROUP',
      profile: { name: 'Engineering', description: 'All engineers', costCenter: 'CC-42' },
    }

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(stored), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...stored,
            profile: { ...stored.profile, name: 'Engineering EMEA' },
          }),
          { status: 200 }
        )
      )

    const result = await oktaUpdateGroupTool.directExecution!({
      ...AUTH,
      groupId: '00g1',
      name: 'Engineering EMEA',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [readUrl, readInit] = fetchMock.mock.calls[0]
    expect(String(readUrl)).toBe('https://dev-123456.okta.com/api/v1/groups/00g1')
    expect(readInit?.method ?? 'GET').toBe('GET')

    const [, writeInit] = fetchMock.mock.calls[1]
    expect(writeInit?.method).toBe('PUT')
    expect(JSON.parse(String(writeInit?.body))).toEqual({
      profile: { name: 'Engineering EMEA', description: 'All engineers', costCenter: 'CC-42' },
    })
    expect(result.output.description).toBe('All engineers')
  })
})

describe('okta update_user partial merge', () => {
  it('drops blank profile fields so a partial update cannot erase stored values', () => {
    const body = builtBody(() =>
      oktaUpdateUserTool.request.body!({
        ...AUTH,
        userId: '00u1',
        firstName: 'Ada',
        lastName: '',
        email: '',
        title: 'Engineer',
      })
    )

    expect(body).toEqual({ profile: { firstName: 'Ada', title: 'Engineer' } })
  })

  it('still drops blanks when the block layer is bypassed by an LLM tool call', () => {
    const body = builtBody(() =>
      oktaUpdateUserTool.request.body!({
        ...AUTH,
        userId: '00u1',
        firstName: '',
        lastName: '',
      })
    )

    expect(body).toEqual({ profile: {} })
  })
})

describe('okta get_logs query building', () => {
  it('sends limit=0 rather than treating it as absent', () => {
    const url = oktaGetLogsTool.request.url({ ...AUTH, limit: 0 })
    expect(url).toContain('limit=0')
  })

  it('omits limit entirely when it was not supplied', () => {
    const url = oktaGetLogsTool.request.url({ ...AUTH })
    expect(url).not.toContain('limit=')
  })
})

describe('okta block params mapping', () => {
  it('maps the group-rule keyword field onto the shared search wire param', () => {
    const merged = mergedBlockParams({
      operation: 'okta_list_group_rules',
      ...AUTH,
      ruleSearch: 'contractors',
    })

    expect(merged.search).toBe('contractors')
  })

  it('leaves the expression search field mapped for the operations that take one', () => {
    const merged = mergedBlockParams({
      operation: 'okta_list_users',
      ...AUTH,
      search: 'profile.department eq "Engineering"',
    })

    expect(merged.search).toBe('profile.department eq "Engineering"')
  })

  it('drops blank profile fields before they reach a partial update', () => {
    const merged = mergedBlockParams({
      operation: 'okta_update_user',
      ...AUTH,
      userId: '00u1',
      firstName: 'Ada',
      lastName: '',
    })

    expect(merged.firstName).toBe('Ada')
    expect(merged.lastName).toBeUndefined()
  })

  it('reads the send-email toggle that belongs to the selected operation', () => {
    expect(
      mergedBlockParams({ operation: 'okta_activate_user', ...AUTH, sendEmail: false }).sendEmail
    ).toBe(false)
    expect(
      mergedBlockParams({
        operation: 'okta_deactivate_user',
        ...AUTH,
        sendDeactivationEmail: true,
      }).sendEmail
    ).toBe(true)
  })

  it('ignores a stale advanced toggle left over from another operation', () => {
    // `shouldSerializeSubBlock` skips `condition` for advanced fields, so both
    // switches can reach the mapper at once.
    const merged = mergedBlockParams({
      operation: 'okta_deactivate_user',
      ...AUTH,
      sendEmail: true,
      sendDeactivationEmail: false,
    })

    expect(merged.sendEmail).toBe(false)
  })

  it('drops a non-numeric limit instead of forwarding the raw string', () => {
    const merged = mergedBlockParams({
      operation: 'okta_list_users',
      ...AUTH,
      limit: 'lots',
    })

    expect(merged.limit).toBeUndefined()
  })
})

describe('okta block output contract', () => {
  it('keeps the get_user activation timestamp on its published output name', () => {
    // Renaming it would break saved `<Okta.activated>` references, so the tool
    // keeps the name and declares the real type.
    expect(oktaGetUserTool.outputs?.activated).toMatchObject({ type: 'string' })
  })

  it('declares every subBlock the params mapper reads', () => {
    const subBlockIds = new Set(OktaBlock.subBlocks.map((subBlock) => subBlock.id))
    expect(subBlockIds.has('ruleSearch')).toBe(true)
    expect(OktaBlock.inputs.ruleSearch).toBeDefined()
  })

  it('has no duplicate subBlock ids, which would silently seed the wrong default', () => {
    const ids = OktaBlock.subBlocks.map((subBlock) => subBlock.id)
    expect(ids.length).toBe(new Set(ids).size)
  })
})
