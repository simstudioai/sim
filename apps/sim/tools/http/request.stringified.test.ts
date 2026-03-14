import { beforeAll, describe, expect, it } from 'vitest'
import { requestTool } from '@/tools/http/request'
import type { RequestParams } from '@/tools/http/types'

beforeAll(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
})

describe('HTTP Request Tool - Stringified Params Fix', () => {
  it('should handle stringified params from UI storage', () => {
    const stringifiedParams = JSON.stringify([
      { id: 'test-1', cells: { Key: 'id', Value: '311861947611' } },
      { id: 'test-2', cells: { Key: 'language', Value: 'tr' } },
    ])

    const stringifiedHeaders = JSON.stringify([
      { id: 'test-3', cells: { Key: 'Authorization', Value: 'Bearer token' } },
    ])

    const params = {
      url: 'https://api.example.com/tracking',
      method: 'GET' as const,
      params: stringifiedParams,
      headers: stringifiedHeaders,
    }

    const url = (requestTool.request.url as (params: RequestParams) => string)(params)
    expect(url).toBe('https://api.example.com/tracking?id=311861947611&language=tr')

    const headers = (
      requestTool.request.headers as (params: RequestParams) => Record<string, string>
    )(params)
    expect(headers.Authorization).toBe('Bearer token')
  })

  it('should still handle normal array params', () => {
    const params = {
      url: 'https://api.example.com/tracking',
      method: 'GET' as const,
      params: [
        { id: 'test-1', cells: { Key: 'id', Value: '311861947611' } },
        { id: 'test-2', cells: { Key: 'language', Value: 'tr' } },
      ],
      headers: [{ id: 'test-3', cells: { Key: 'Authorization', Value: 'Bearer token' } }],
    }

    const url = (requestTool.request.url as (params: RequestParams) => string)(params)
    expect(url).toBe('https://api.example.com/tracking?id=311861947611&language=tr')

    const headers = (
      requestTool.request.headers as (params: RequestParams) => Record<string, string>
    )(params)
    expect(headers.Authorization).toBe('Bearer token')
  })

  it('should handle null and undefined params gracefully', () => {
    const params = {
      url: 'https://api.example.com/test',
      method: 'GET' as const,
    }

    const url = (requestTool.request.url as (params: RequestParams) => string)(params)
    expect(url).toBe('https://api.example.com/test')

    const headers = (
      requestTool.request.headers as (params: RequestParams) => Record<string, string>
    )(params)
    expect(headers).toBeDefined()
  })

  it('should handle stringified object params and headers', () => {
    const params = {
      url: 'https://api.example.com/oauth/token',
      method: 'POST' as const,
      body: { grant_type: 'client_credentials' },
      params: JSON.stringify({ q: 'test' }),
      headers: JSON.stringify({ 'Content-Type': 'application/x-www-form-urlencoded' }),
    }

    const url = (requestTool.request.url as (input: RequestParams) => string)(params)
    expect(url).toBe('https://api.example.com/oauth/token?q=test')

    const headers = (
      requestTool.request.headers as (input: RequestParams) => Record<string, string>
    )(params)
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded')

    const body = (
      requestTool.request.body as (input: RequestParams) => Record<string, any> | string | FormData
    )(params)
    expect(body).toBe('grant_type=client_credentials')
  })

  it('should handle invalid JSON strings gracefully', () => {
    const params = {
      url: 'https://api.example.com/test',
      method: 'GET' as const,
      params: 'not-valid-json',
      headers: '{broken',
    }

    const url = (requestTool.request.url as (input: RequestParams) => string)(params)
    expect(url).toBe('https://api.example.com/test')

    const headers = (
      requestTool.request.headers as (input: RequestParams) => Record<string, string>
    )(params)
    expect(headers).toBeDefined()
  })
})
