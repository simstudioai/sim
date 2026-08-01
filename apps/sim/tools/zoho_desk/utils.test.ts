/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  getZohoDeskErrorMessage,
} from '@/tools/zoho_desk/utils'

describe('zoho desk tool utils', () => {
  describe('getZohoDeskApiBase', () => {
    it('uses the persisted data-center Desk base', () => {
      expect(getZohoDeskApiBase({ apiDomain: 'https://desk.zoho.eu' })).toBe(
        'https://desk.zoho.eu/api/v1'
      )
    })

    it('strips trailing slashes', () => {
      expect(getZohoDeskApiBase({ apiDomain: 'https://desk.zoho.in/' })).toBe(
        'https://desk.zoho.in/api/v1'
      )
    })

    it('falls back to the US host when no api domain is provided', () => {
      expect(getZohoDeskApiBase({})).toBe('https://desk.zoho.com/api/v1')
    })
  })

  describe('buildZohoDeskHeaders', () => {
    it('builds Zoho-oauthtoken auth + orgId headers', () => {
      const headers = buildZohoDeskHeaders({ accessToken: 'abc', orgId: '700123' })
      expect(headers.Authorization).toBe('Zoho-oauthtoken abc')
      expect(headers.orgId).toBe('700123')
      expect(headers['Content-Type']).toBe('application/json')
    })

    it('throws when the access token is missing', () => {
      expect(() => buildZohoDeskHeaders({ accessToken: '', orgId: '1' })).toThrow(/access token/i)
    })

    it('throws when the orgId is missing', () => {
      expect(() => buildZohoDeskHeaders({ accessToken: 'x', orgId: '' })).toThrow(/organization/i)
    })
  })

  describe('getZohoDeskErrorMessage', () => {
    it('prefers the message field', () => {
      expect(getZohoDeskErrorMessage({ message: 'Bad request' }, 'fallback')).toBe('Bad request')
    })

    it('falls back to errorCode then the fallback', () => {
      expect(getZohoDeskErrorMessage({ errorCode: 'INVALID_DATA' }, 'fallback')).toBe('INVALID_DATA')
      expect(getZohoDeskErrorMessage(null, 'fallback')).toBe('fallback')
    })
  })
})
