import { openapiSource } from 'fumadocs-openapi/server'
import { openapi } from '@/lib/openapi'

/** Generates the virtual API-reference pages consumed by the docs source loader. */
export function createApiReferenceSource() {
  return openapiSource(openapi, {
    baseDir: 'en/api-reference/(generated)',
    groupBy: 'tag',
  })
}
