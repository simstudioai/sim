import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const revalidate = false

/**
 * Serves the raw OpenAPI spec (apps/docs/openapi.json) publicly so external
 * consumers — notably the Mothership search agent's docs/api-reference/ VFS —
 * can build per-tag views from the same spec that renders the API Reference.
 */
export async function GET() {
  try {
    const spec = await readFile(join(process.cwd(), 'openapi.json'), 'utf-8')
    return new Response(spec, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
    })
  } catch (error) {
    console.error('Error serving openapi.json:', error)
    return new Response('OpenAPI spec unavailable', { status: 500 })
  }
}
