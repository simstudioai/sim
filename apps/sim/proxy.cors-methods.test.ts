/**
 * @vitest-environment node
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { resolveApiCorsPolicy } from '@/proxy'

/**
 * The default `/api` CORS policy advertises a hand-written method list, because
 * middleware cannot import the contract tree without dragging Zod into the edge
 * bundle. This sweeps the contracts the list is supposed to describe and fails
 * when the two drift.
 *
 * It exists because they did drift: the list read `GET,POST,OPTIONS,PUT,DELETE`
 * while 17 v2 operations were `PATCH`, so a browser preflight for any of them
 * was rejected — and it advertised `PUT`, which only two operations use, which
 * is what a hand-maintained list looks like after a surface grows past it.
 */

const CONTRACTS_DIR = path.resolve(import.meta.dirname, 'lib/api/contracts')

function contractFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'openapi') continue
      files.push(...contractFiles(full))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(full)
    }
  }
  return files
}

function defaultPolicyMethods(): string[] {
  /** A path matching no specific CORS rule falls through to the default policy. */
  const request = {
    nextUrl: { pathname: '/api/v2/workflows' },
    headers: new Headers(),
  } as unknown as NextRequest
  return resolveApiCorsPolicy(request)
    .methods.split(',')
    .map((method) => method.trim())
}

describe('default /api CORS allow-methods', () => {
  it('advertises every method the contract surface declares', async () => {
    const declared = new Set<string>()
    for (const file of contractFiles(CONTRACTS_DIR)) {
      const mod = (await import(file)) as Record<string, unknown>
      for (const value of Object.values(mod)) {
        const contract = value as { method?: unknown; path?: unknown }
        if (typeof contract?.method !== 'string' || typeof contract?.path !== 'string') continue
        if (!contract.path.startsWith('/api/')) continue
        declared.add(contract.method.toUpperCase())
      }
    }
    const advertised = new Set(defaultPolicyMethods())

    expect(
      declared.size,
      'the contract sweep found no routes, so it proves nothing'
    ).toBeGreaterThan(0)
    expect(
      [...declared].filter((method) => !advertised.has(method)).sort(),
      'Access-Control-Allow-Methods omits a method the API actually serves, so a browser preflight for it is rejected.'
    ).toEqual([])
  }, 60_000)

  it('advertises OPTIONS so a preflight can succeed at all', () => {
    expect(defaultPolicyMethods()).toContain('OPTIONS')
  })

  /** Next answers HEAD from each route's GET handler, so the surface does serve it. */
  it('advertises HEAD', () => {
    expect(defaultPolicyMethods()).toContain('HEAD')
  })
})
