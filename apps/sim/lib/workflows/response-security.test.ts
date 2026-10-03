import { describe, expect, it } from 'vitest'
import { createHttpResponseFromBlock } from '@/lib/workflows/utils'

describe('workflow HTTP response safety', () => {
  it.each([
    { 'Content-Type': 'text/html' },
    { 'content-type': 'text/html' },
    { 'CoNtEnT-TyPe': 'image/svg+xml' },
    { 'Content-Type': 'application/json', 'content-type': 'text/html' },
  ])('keeps untrusted markup as JSON with headers %j', async (headers) => {
    const data = { message: '<script>alert(document.domain)</script>' }
    const response = await createHttpResponseFromBlock({
      output: {
        data,
        status: 201,
        headers: {
          ...headers,
          'X-Content-Type-Options': 'invalid',
          'X-API-Version': '1.0',
          'Cache-Control': 'no-cache',
          'Retry-After': '30',
        },
      },
    })

    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.status).toBe(201)
    expect(response.headers.get('x-api-version')).toBe('1.0')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(response.headers.get('retry-after')).toBe('30')
    expect(await response.json()).toEqual(data)
  })

  it('does not let workflow output set cookies, browser policies, redirects, or transport headers', async () => {
    const response = await createHttpResponseFromBlock({
      output: {
        data: { message: 'complete' },
        status: 200,
        headers: {
          'SeT-CoOkIe': 'session=untrusted; Path=/',
          'Set-Cookie2': 'session=untrusted',
          'Content-Disposition': 'inline',
          'Content-Security-Policy': "default-src * 'unsafe-inline'",
          'Content-Security-Policy-Report-Only': 'report-uri /untrusted',
          'X-Frame-Options': 'ALLOWALL',
          'X-XSS-Protection': '0',
          'X-Download-Options': 'untrusted',
          'X-DNS-Prefetch-Control': 'on',
          'X-Permitted-Cross-Domain-Policies': 'all',
          'X-UA-Compatible': 'IE=7',
          'X-WebKit-CSP': "default-src * 'unsafe-inline'",
          'X-Content-Security-Policy': "default-src * 'unsafe-inline'",
          'Accept-CH': 'Sec-CH-UA-Model',
          'Accept-CH-Lifetime': '86400',
          'Critical-CH': 'Sec-CH-UA-Model',
          'Public-Key-Pins': 'max-age=0',
          'Public-Key-Pins-Report-Only': 'max-age=0; report-uri="/untrusted"',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': 'true',
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'Clear-Site-Data': '"*"',
          'Permissions-Policy': 'camera=*',
          'Document-Policy': 'force-load-at-top',
          'Referrer-Policy': 'unsafe-url',
          'Strict-Transport-Security': 'max-age=0',
          'Origin-Agent-Cluster': '?0',
          Location: '/untrusted',
          Refresh: '0; url=/untrusted',
          Link: '</untrusted>; rel=preload; as=script',
          'Report-To': '{"group":"untrusted"}',
          'Reporting-Endpoints': 'default="/untrusted"',
          NEL: '{"report_to":"untrusted","max_age":3600}',
          'Content-Length': '1',
          'Content-Encoding': 'gzip',
          'Transfer-Encoding': 'chunked',
          Connection: 'close',
          'X-Middleware-Rewrite': '/untrusted',
          'X-Accel-Redirect': '/untrusted',
          'X-Sendfile': '/untrusted',
        },
      },
    })

    expect(Object.fromEntries(response.headers)).toEqual({
      'content-type': 'application/json',
      'x-content-type-options': 'nosniff',
    })
    expect(await response.json()).toEqual({ message: 'complete' })
  })
})
