/**
 * @vitest-environment node
 */
import appPackage from '@/package.json'
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it } from 'vitest'
import { GET } from '@/app/api/health/route'

afterEach(() => {
  process.env.APP_VERSION = ''
  process.env.NEXT_PUBLIC_APP_VERSION = ''
  process.env.GIT_SHA = ''
  process.env.VERCEL_GIT_COMMIT_SHA = ''
  process.env.COMMIT_SHA = ''
})

describe('GET /api/health', () => {
  it('returns status with runtime version metadata', async () => {
    process.env.APP_VERSION = 'v1.2.3'
    process.env.GIT_SHA = 'abc123'

    const response = await GET(new NextRequest('http://localhost/api/health'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      timestamp: expect.any(String),
      version: 'v1.2.3',
      commit: 'abc123',
    })
  })

  it('accepts query parameters from health-checking clients', async () => {
    const response = await GET(new NextRequest('http://localhost/api/health?_=123'))

    expect(response.status).toBe(200)
  })

  it('falls back to the package version when runtime metadata is not provided', async () => {
    process.env.APP_VERSION = ''
    process.env.NEXT_PUBLIC_APP_VERSION = ''
    process.env.GIT_SHA = ''
    process.env.VERCEL_GIT_COMMIT_SHA = ''
    process.env.COMMIT_SHA = ''

    const response = await GET(new NextRequest('http://localhost/api/health'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      timestamp: expect.any(String),
      version: appPackage.version,
      commit: null,
    })
  })
})
