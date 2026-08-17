/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OktaBlock } from '@/blocks/blocks/okta'
import { oktaActivateUserTool } from '@/tools/okta/activate_user'
import { oktaAssignUserRoleTool } from '@/tools/okta/assign_user_role'
import { oktaClearUserSessionsTool } from '@/tools/okta/clear_user_sessions'
import { oktaCreateUserTool } from '@/tools/okta/create_user'
import { oktaDeactivateUserTool } from '@/tools/okta/deactivate_user'
import { oktaDeleteGroupRuleTool } from '@/tools/okta/delete_group_rule'
import { oktaDeleteUserTool } from '@/tools/okta/delete_user'
import { oktaEnrollFactorTool } from '@/tools/okta/enroll_factor'
import { oktaGetLogsTool } from '@/tools/okta/get_logs'
import { oktaGetUserTool } from '@/tools/okta/get_user'
import { oktaListAppsTool } from '@/tools/okta/list_apps'
import { oktaRemoveUserFromAppTool } from '@/tools/okta/remove_user_from_app'
import { oktaResetFactorTool } from '@/tools/okta/reset_factor'
import { oktaResetPasswordTool } from '@/tools/okta/reset_password'
import { oktaUpdateGroupTool } from '@/tools/okta/update_group'
import { oktaUpdateUserTool } from '@/tools/okta/update_user'
import { mergeOktaGroupProfile } from '@/tools/okta/utils'

const AUTH = { apiKey: 'token', domain: 'dev-123456.okta.com' }

/**
 * Calls a declarative `url` builder with the untyped shape a tool really
 * receives. An LLM tool call, a `<Block.output>` reference, and an
 * API-triggered run all deliver every value as text, which the typed params
 * interface does not model.
 */
function builtUrl(build: (params: never) => string, params: Record<string, unknown>): string {
  return build(params as never)
}

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

  it('keeps the stored name when the caller supplies a blank one', () => {
    // `name` is `user-or-llm`, and a model routinely emits `""` for a field it
    // has nothing to say about. The group profile declares no required
    // attributes, so Okta would persist the blank over the stored name.
    const merged = mergeOktaGroupProfile(
      { name: 'Engineering', description: 'All engineers' },
      { name: '', description: 'Updated' }
    )

    expect(merged.name).toBe('Engineering')
    expect(merged.description).toBe('Updated')
  })

  it('does not require a name, matching the description it advertises', () => {
    expect(oktaUpdateGroupTool.params.name.required).toBe(false)
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

describe('okta lifecycle sendEmail coercion', () => {
  // An LLM tool call, a `<Block.output>` reference, and an API-triggered run all
  // deliver a boolean as text, so a strict `=== true` check silently sent
  // `sendEmail=false` and the deactivation email never went out.
  it('honours a stringified sendEmail on deactivate_user', () => {
    expect(
      builtUrl(oktaDeactivateUserTool.request.url, { ...AUTH, userId: '00u1', sendEmail: 'true' })
    ).toContain('sendEmail=true')
  })

  it('honours a stringified sendEmail on delete_user', () => {
    expect(
      builtUrl(oktaDeleteUserTool.request.url, { ...AUTH, userId: '00u1', sendEmail: 'true' })
    ).toContain('sendEmail=true')
  })

  it('still defaults to not sending when the flag is absent or false', () => {
    expect(builtUrl(oktaDeactivateUserTool.request.url, { ...AUTH, userId: '00u1' })).toContain(
      'sendEmail=false'
    )
    expect(
      builtUrl(oktaDeleteUserTool.request.url, { ...AUTH, userId: '00u1', sendEmail: 'false' })
    ).toContain('sendEmail=false')
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

  /**
   * Okta documents `since` and `after` as mutually exclusive, and a scheduled
   * poll that persists the cursor normally also has a start time configured —
   * so the resume request would otherwise be one Okta rejects.
   */
  it('drops since when a cursor is supplied', () => {
    const url = builtUrl(oktaGetLogsTool.request.url, {
      ...AUTH,
      since: '2026-08-01T00:00:00.000Z',
      after: 'CURSOR123',
    })

    expect(url).toContain('after=CURSOR123')
    expect(url).not.toContain('since=')
  })

  it('still sends since when no cursor is supplied', () => {
    const url = builtUrl(oktaGetLogsTool.request.url, {
      ...AUTH,
      since: '2026-08-01T00:00:00.000Z',
    })

    expect(url).toContain('since=2026-08-01T00%3A00%3A00.000Z')
    expect(url).not.toContain('after=')
  })
})

describe('okta get_logs pagination termination', () => {
  const NEXT_LINK = '<https://dev-123456.okta.com/api/v1/logs?after=cursor1>; rel="next"'

  function logsResponse(events: unknown[]): Response {
    return new Response(JSON.stringify(events), { status: 200, headers: { Link: NEXT_LINK } })
  }

  async function outputOf(response: Response) {
    const result = (await oktaGetLogsTool.transformResponse!(response, undefined as never)) as {
      output: { count: number; nextCursor: string | null; hasMore: boolean }
    }
    return result.output
  }

  /**
   * A query without `until` is a polling query, and Okta advertises a next link
   * on every one of those pages "even if there are no new events". The block
   * leaves `since`/`until` blank by default, so the default shape is the polling
   * shape — a loop driven by an unconditioned `hasMore` never terminates.
   */
  it('stops advertising more results once a polling page comes back empty', async () => {
    const output = await outputOf(logsResponse([]))

    expect(output.count).toBe(0)
    expect(output.hasMore).toBe(false)
  })

  /**
   * Terminating the loop must not cost the poll handle. Okta documents the next
   * link on a polling query as the position to persist and re-poll, so a quiet
   * interval that nulled it would restart the next run from `since` and
   * re-deliver events the workflow already processed.
   */
  it('keeps the resume cursor on an empty polling page', async () => {
    const output = await outputOf(logsResponse([]))

    expect(output.nextCursor).toBe('cursor1')
  })

  it('still advertises the cursor while events are coming back', async () => {
    const output = await outputOf(
      logsResponse([{ uuid: 'e1', published: 'p', eventType: 't', severity: 'INFO' }])
    )

    expect(output.count).toBe(1)
    expect(output.hasMore).toBe(true)
    expect(output.nextCursor).toBe('cursor1')
  })

  it('reports the last page of a bounded query with no next link', async () => {
    const output = await outputOf(
      new Response(
        JSON.stringify([{ uuid: 'e1', published: 'p', eventType: 't', severity: 'I' }]),
        {
          status: 200,
        }
      )
    )

    expect(output.hasMore).toBe(false)
    expect(output.nextCursor).toBeNull()
  })
})

describe('okta lifecycle flags are coerced rather than interpolated raw', () => {
  /**
   * `sendEmail` is a query parameter and Okta answers 400 to anything that is
   * not literally `true` or `false`, but an LLM tool call routinely supplies
   * `"yes"` or `1`.
   */
  it.each([
    ['activate_user', oktaActivateUserTool],
    ['reset_password', oktaResetPasswordTool],
  ])('%s never forwards a non-canonical boolean', (_name, tool) => {
    expect(tool.request.url({ ...AUTH, userId: '00u1', sendEmail: 'yes' } as never)).toContain(
      'sendEmail=true'
    )
    expect(tool.request.url({ ...AUTH, userId: '00u1', sendEmail: 'nope' } as never)).toContain(
      'sendEmail=false'
    )
  })

  it.each([
    ['activate_user', oktaActivateUserTool],
    ['reset_password', oktaResetPasswordTool],
  ])('%s keeps sending true when the flag is omitted entirely', (_name, tool) => {
    expect(tool.request.url({ ...AUTH, userId: '00u1' } as never)).toContain('sendEmail=true')
  })

  it.each([
    ['deactivate_user', oktaDeactivateUserTool],
    ['delete_user', oktaDeleteUserTool],
  ])('%s coerces through the same helper and still defaults to false', (_name, tool) => {
    expect(tool.request.url({ ...AUTH, userId: '00u1' } as never)).toContain('sendEmail=false')
    expect(tool.request.url({ ...AUTH, userId: '00u1', sendEmail: 'yes' } as never)).toContain(
      'sendEmail=true'
    )
  })
})

describe('okta query-string flags are coerced rather than interpolated raw', () => {
  /**
   * Every one of these is `visibility: 'user-or-llm'` and typed `boolean` in
   * Okta's spec, so a direct or agent tool call can deliver `"yes"` for any of
   * them. Omission must still leave the parameter off entirely so Okta applies
   * its own documented default.
   */
  const CASES: Array<{
    name: string
    build: (params: Record<string, unknown>) => string
    param: string
    base: Record<string, unknown>
  }> = [
    {
      name: 'remove_user_from_app.sendEmail',
      build: (params) => builtUrl(oktaRemoveUserFromAppTool.request.url, params),
      param: 'sendEmail',
      base: { ...AUTH, appId: '0oa1', userId: '00u1' },
    },
    {
      name: 'enroll_factor.activate',
      build: (params) => builtUrl(oktaEnrollFactorTool.request.url, params),
      param: 'activate',
      base: { ...AUTH, userId: '00u1', factorType: 'sms', provider: 'OKTA' },
    },
    {
      name: 'reset_factor.removeRecoveryEnrollment',
      build: (params) => builtUrl(oktaResetFactorTool.request.url, params),
      param: 'removeRecoveryEnrollment',
      base: { ...AUTH, userId: '00u1', factorId: 'fac1' },
    },
    {
      name: 'delete_group_rule.removeUsers',
      build: (params) => builtUrl(oktaDeleteGroupRuleTool.request.url, params),
      param: 'removeUsers',
      base: { ...AUTH, groupRuleId: '0pr1' },
    },
    {
      name: 'clear_user_sessions.oauthTokens',
      build: (params) => builtUrl(oktaClearUserSessionsTool.request.url, params),
      param: 'oauthTokens',
      base: { ...AUTH, userId: '00u1' },
    },
    {
      name: 'clear_user_sessions.forgetDevices',
      build: (params) => builtUrl(oktaClearUserSessionsTool.request.url, params),
      param: 'forgetDevices',
      base: { ...AUTH, userId: '00u1' },
    },
    {
      name: 'list_apps.includeNonDeleted',
      build: (params) => builtUrl(oktaListAppsTool.request.url, params),
      param: 'includeNonDeleted',
      base: { ...AUTH },
    },
    {
      name: 'assign_user_role.disableNotifications',
      build: (params) => builtUrl(oktaAssignUserRoleTool.request.url, params),
      param: 'disableNotifications',
      base: { ...AUTH, userId: '00u1', roleType: 'USER_ADMIN' },
    },
  ]

  it.each(CASES)('$name coerces a stringy truthy to true', ({ build, param, base }) => {
    expect(build({ ...base, [param]: 'yes' })).toContain(`${param}=true`)
  })

  it.each(CASES)('$name coerces a stringy falsy to false', ({ build, param, base }) => {
    expect(build({ ...base, [param]: 'false' })).toContain(`${param}=false`)
  })

  it.each(CASES)('$name omits the param when undefined', ({ build, param, base }) => {
    expect(build(base)).not.toContain(`${param}=`)
  })

  /**
   * `create_user.activate` is the one flag Okta itself defaults to `true`, so
   * omission must keep sending `true` rather than fall through the coercion.
   */
  it('create_user.activate coerces a stringy value and still defaults to true', () => {
    const base = { ...AUTH, firstName: 'A', lastName: 'B', email: 'a@b.com' }

    expect(builtUrl(oktaCreateUserTool.request.url, base)).toContain('activate=true')
    expect(builtUrl(oktaCreateUserTool.request.url, { ...base, activate: 'yes' })).toContain(
      'activate=true'
    )
    expect(builtUrl(oktaCreateUserTool.request.url, { ...base, activate: 'false' })).toContain(
      'activate=false'
    )
  })
})

describe('okta update_group declarative fallback', () => {
  /**
   * `PUT /api/v1/groups/{groupId}` replaces an extensible profile wholesale, so
   * a body built without first reading the stored profile would erase the
   * description on a rename plus every org-defined custom attribute. Unreachable
   * today, but it must fail loudly rather than truncate silently.
   */
  it('refuses to build a body instead of sending a truncated profile', () => {
    expect(() =>
      oktaUpdateGroupTool.request.body!({ ...AUTH, groupId: '00g1', name: 'Engineering EMEA' })
    ).toThrow(/direct execution/i)
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

  it('reads the activate toggle that belongs to the selected operation', () => {
    // Okta's `activate` default is inverted between these two operations, so a
    // single shared switch handed each of them the other one's answer.
    expect(
      mergedBlockParams({
        operation: 'okta_create_user',
        ...AUTH,
        activate: false,
        activateFactor: true,
      }).activate
    ).toBe(false)
    expect(
      mergedBlockParams({
        operation: 'okta_enroll_factor',
        ...AUTH,
        activate: true,
        activateFactor: false,
      }).activate
    ).toBe(false)
  })

  it('leaves enroll_factor unactivated when only a stale create-user toggle is present', () => {
    const merged = mergedBlockParams({
      operation: 'okta_enroll_factor',
      ...AUTH,
      userId: '00u1',
      activate: true,
    })

    expect(merged.activate).toBeUndefined()
  })

  it('sends only the cursor minted by the selected operation', () => {
    const merged = mergedBlockParams({
      operation: 'okta_list_groups',
      ...AUTH,
      after: 'cursor-from-list-users',
      groupsAfter: 'cursor-from-list-groups',
    })

    expect(merged.after).toBe('cursor-from-list-groups')
  })

  it('drops a stale cursor left behind by another list operation', () => {
    const merged = mergedBlockParams({
      operation: 'okta_list_groups',
      ...AUTH,
      after: 'cursor-from-list-users',
    })

    expect(merged.after).toBeUndefined()
  })

  it('drops any cursor on an operation that does not paginate', () => {
    const merged = mergedBlockParams({
      operation: 'okta_get_user',
      ...AUTH,
      userId: '00u1',
      after: 'cursor-from-list-users',
    })

    expect(merged.after).toBeUndefined()
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

  it('declares activated as the timestamp string the user reads emit', () => {
    // `get_user` and `list_users` publish Okta's activation timestamp here, so a
    // boolean declaration mistyped every saved `<Okta.activated>` reference.
    expect(OktaBlock.outputs.activated).toMatchObject({ type: 'string' })
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
