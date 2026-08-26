/**
 * @vitest-environment node
 *
 * Guards the `ref` parameter in the *query* zone of the contents tools.
 *
 * There is no traversal risk here — `?ref=` sits after the path — but raw
 * interpolation still loses the caller's intent silently. `ref = 'main#x'`
 * makes `#x` a URL fragment, which `fetch` never sends: GitHub answers for the
 * default branch and the tool returns a *different file* with
 * `success: true`. A `+` decodes to a space and a `&` injects an unrelated
 * query parameter. `get_readme` already encodes; these two did not.
 */
import { describe, expect, it } from 'vitest'
import { getFileContentTool } from '@/tools/github/get_file_content'
import { getReadmeTool } from '@/tools/github/get_readme'
import { getTreeTool } from '@/tools/github/get_tree'
import type { ToolConfig } from '@/tools/types'

const BASE = { owner: 'octo-cat', repo: 'hello-world', path: 'src/index.ts', apiKey: 'k' }

const TOOLS = [
  ['github_get_file_content', getFileContentTool],
  ['github_get_tree', getTreeTool],
  ['github_get_readme', getReadmeTool],
] as const satisfies ReadonlyArray<readonly [string, ToolConfig<any, any>]>

const urlFor = (tool: ToolConfig<any, any>, ref?: string) =>
  new URL((tool.request!.url as (p: any) => string)({ ...BASE, ...(ref ? { ref } : {}) }))

describe.each(TOOLS)('%s ref query encoding', (_id, tool) => {
  it.each([
    ['main#x', 'main#x'],
    ['release+1', 'release+1'],
    ['main&per_page=100', 'main&per_page=100'],
    ['feature/foo', 'feature/foo'],
    ['refs/tags/v1.2.3', 'refs/tags/v1.2.3'],
  ])('sends %j to the server verbatim', (ref, expected) => {
    const url = urlFor(tool, ref)

    expect(url.searchParams.get('ref')).toBe(expected)
    expect(url.hash).toBe('')
    expect([...url.searchParams.keys()]).toEqual(['ref'])
  })

  it('omits ref entirely when not supplied', () => {
    expect(urlFor(tool).searchParams.has('ref')).toBe(false)
  })
})
