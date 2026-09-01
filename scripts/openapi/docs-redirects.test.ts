/**
 * Pins the `/api-reference/` rules in `apps/docs/lib/redirects.ts` against the
 * generated operation pages.
 *
 * Page identity is derived from the specs at build time, so a spec regeneration
 * can silently invalidate the map in two directions: a redirect `source` can
 * start shadowing a page that now exists (the redirect wins and hides it), and a
 * `destination` can stop resolving (the redirect lands on a 404). Neither shows
 * up in a build, a type-check, or any other check — nothing else in the repo
 * reads docs URLs.
 *
 * Both directions use the same slug set, so a rule cannot shadow a hand-authored
 * page (`/api-reference/getting-started`) any more than a generated one.
 *
 * The slug derivation mirrors `fumadocs-openapi`'s auto preset: pages are
 * emitted at `<baseDir>/<slugify(tag)>/<operationId>.mdx` and `(generated)` is
 * a folder group stripped from the URL — so the public URL is
 * `/api-reference/<tag>/<operationId>`.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { OPENAPI_SPEC_FILES } from '../../apps/docs/lib/openapi-specs'
import { DOCS_REDIRECTS } from '../../apps/docs/lib/redirects'

const ROOT = path.resolve(import.meta.dirname, '../..')
const DOCS_DIR = path.join(ROOT, 'apps/docs')
const STATIC_PAGES_DIR = path.join(DOCS_DIR, 'content/docs/api-reference')
const PREFIX = '/api-reference/'

/**
 * `fumadocs-openapi`'s `methodKeys`, which is what decides whether an operation
 * becomes a page. It is deliberately narrower than the OpenAPI method set —
 * `options` and `trace` are not enumerated, so an operation declared under
 * either produces no page and must not count as a resolvable destination here.
 */
const HTTP_METHODS = ['get', 'post', 'patch', 'delete', 'head', 'put'] as const

interface OperationObject {
  operationId?: string
  tags?: string[]
}

/** `fumadocs-openapi`'s default `slugify` for tag folder names. */
function slugify(value: string): string {
  return value.replace(/\s+/g, '-').toLowerCase()
}

function generatedSlugs(): Set<string> {
  const slugs = new Set<string>()
  for (const file of OPENAPI_SPEC_FILES) {
    const spec = JSON.parse(readFileSync(path.join(DOCS_DIR, file), 'utf8')) as {
      paths?: Record<string, Record<string, OperationObject | undefined>>
    }
    for (const pathItem of Object.values(spec.paths ?? {})) {
      for (const method of HTTP_METHODS) {
        const operation = pathItem[method]
        if (!operation?.operationId) continue
        const tags = operation.tags?.length ? operation.tags : ['unknown']
        for (const tag of tags) {
          slugs.add(`${slugify(tag)}/${operation.operationId}`)
        }
      }
    }
  }
  return slugs
}

/** Every slug a `/api-reference/` URL can resolve to: generated plus hand-authored. */
function resolvableSlugs(): Set<string> {
  const slugs = generatedSlugs()
  for (const entry of readdirSync(STATIC_PAGES_DIR)) {
    if (entry.endsWith('.mdx')) slugs.add(path.basename(entry, '.mdx'))
  }
  return slugs
}

const API_REFERENCE_RULES = DOCS_REDIRECTS.filter(
  (rule) => rule.source.startsWith(PREFIX) || rule.destination.startsWith(PREFIX)
)

describe('api-reference redirects', () => {
  it('is a non-empty set of literal paths', () => {
    expect(API_REFERENCE_RULES.length).toBeGreaterThan(0)
    for (const rule of API_REFERENCE_RULES) {
      expect(
        `${rule.source} -> ${rule.destination}`,
        'path params would make the slug checks below vacuous'
      ).not.toMatch(/[:*]/)
    }
  })

  it('never shadows a page that exists', () => {
    const resolvable = resolvableSlugs()
    const shadowed = API_REFERENCE_RULES.map((rule) => rule.source)
      .filter((source) => source.startsWith(PREFIX))
      .filter((source) => resolvable.has(source.slice(PREFIX.length)))
    expect(shadowed).toEqual([])
  })

  it('only points at pages that exist', () => {
    const resolvable = resolvableSlugs()
    const broken = API_REFERENCE_RULES.map((rule) => rule.destination)
      .filter((destination) => destination.startsWith(PREFIX))
      .filter((destination) => !resolvable.has(destination.slice(PREFIX.length)))
    expect(broken).toEqual([])
  })
})
