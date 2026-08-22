/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { resolveSlackExternalUserSubject } from '@/lib/webhooks/slack-dispatch'

describe('resolveSlackExternalUserSubject', () => {
  it('resolves an Events API user with the provider tenant', () => {
    expect(
      resolveSlackExternalUserSubject({
        team_id: 'T_WORKSPACE',
        event: { type: 'app_mention', user: 'U_PERSON' },
      })
    ).toEqual({
      kind: 'external_user',
      provider: 'slack',
      tenantId: 'T_WORKSPACE',
      subjectId: 'U_PERSON',
    })
  })

  it('uses the actor tenant for Slack Connect interactions', () => {
    expect(
      resolveSlackExternalUserSubject({
        type: 'block_actions',
        team: { id: 'T_INSTALLATION' },
        user: { id: 'U_EXTERNAL', team_id: 'T_EXTERNAL' },
      })
    ).toEqual({
      kind: 'external_user',
      provider: 'slack',
      tenantId: 'T_EXTERNAL',
      subjectId: 'U_EXTERNAL',
    })
  })

  it('does not create a human subject for bot events', () => {
    expect(
      resolveSlackExternalUserSubject({
        team_id: 'T_WORKSPACE',
        event: { type: 'message', user: 'U_BOT', bot_id: 'B_BOT', subtype: 'bot_message' },
      })
    ).toBeUndefined()
  })

  it('fails closed when either stable provider identifier is missing', () => {
    expect(resolveSlackExternalUserSubject({ event: { user: 'U_PERSON' } })).toBeUndefined()
    expect(resolveSlackExternalUserSubject({ team_id: 'T_WORKSPACE', event: {} })).toBeUndefined()
  })
})
