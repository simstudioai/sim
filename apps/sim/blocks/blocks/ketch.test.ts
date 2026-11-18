import { describe, expect, it } from 'vitest'
import { KetchBlock } from '@/blocks/blocks/ketch'
import { invokeRightTool } from '@/tools/ketch/invoke_right'
import { setConsentTool } from '@/tools/ketch/set_consent'

const buildParams = KetchBlock.tools.config?.params
if (!buildParams) throw new Error('KetchBlock has no params mapper')

describe('KetchBlock', () => {
  /**
   * An agent tool call passes the operation only in `context`; a purposes map the
   * model sends as JSON text must reach the tool as an object, like the canvas sends it.
   */
  it('parses a JSON-text purposes map on an agent tool call', () => {
    const args = {
      organizationCode: 'org',
      propertyCode: 'web',
      environmentCode: 'production',
      identities: { email: 'a@example.com' },
      purposes: '{"analytics":{"allowed":"granted"}}',
    }

    expect({ ...args, ...buildParams(args, { operation: 'set_consent' }) }.purposes).toEqual({
      analytics: { allowed: 'granted' },
    })
  })

  /**
   * Ketch records any `allowed` other than the string "true" as denied, so a granted
   * consent written as "granted" (the value this integration used to document) must be sent as "true".
   */
  it('sends a granted consent as allowed "true"', () => {
    const buildBody = setConsentTool.request.body
    if (!buildBody) throw new Error('set consent has no body builder')
    const body = buildBody({
      organizationCode: 'org',
      propertyCode: 'web',
      environmentCode: 'production',
      identities: { email: 'a@example.com' },
      purposes: {
        analytics: { allowed: 'granted', legalBasisCode: 'consent_optin' },
        marketing: { allowed: 'denied', legalBasisCode: 'consent_optin' },
      },
      collectedAt: 1,
    })
    if (!body || typeof body === 'string' || body instanceof FormData) {
      throw new Error('Expected a JSON body')
    }

    expect(body.purposes).toEqual({
      analytics: { allowed: 'true', legalBasisCode: 'consent_optin' },
      marketing: { allowed: 'false', legalBasisCode: 'consent_optin' },
    })
  })

  it('sends an unrecognized allowed value unchanged', () => {
    const buildBody = setConsentTool.request.body
    if (!buildBody) throw new Error('set consent has no body builder')

    const body = buildBody({
      organizationCode: 'org',
      propertyCode: 'web',
      environmentCode: 'production',
      identities: { email: 'a@example.com' },
      purposes: { analytics: { allowed: 'yes' }, marketing: { allowed: '' } },
    })
    if (!body || typeof body === 'string' || body instanceof FormData) {
      throw new Error('Expected a JSON body')
    }

    expect(body.purposes).toEqual({ analytics: { allowed: 'yes' }, marketing: { allowed: '' } })
  })

  it('surfaces the message of a Ketch error envelope', async () => {
    const transform = invokeRightTool.transformResponse
    if (!transform) throw new Error('invoke right has no response transform')
    const response = new Response(
      JSON.stringify({
        error: {
          code: 'invalid',
          message: 'user is required for unauthenticated right invocations',
          status: 400,
        },
      }),
      { status: 400 }
    )

    const result = await transform(response)

    expect(result.output.message).toBe('user is required for unauthenticated right invocations')
  })
})
