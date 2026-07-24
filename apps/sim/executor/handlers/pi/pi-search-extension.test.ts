/**
 * @vitest-environment node
 */
import { execFile } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { PI_SEARCH_EXTENSION_SOURCE } from '@/executor/handlers/pi/pi-search-extension'

const execFileAsync = promisify(execFile)
const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('Pi search extension runtime hooks', () => {
  it('sanitizes tool results and provider payloads without throwing fail-open errors', async () => {
    const directory = await mkdtemp(path.join(process.cwd(), '.pi-search-extension-test-'))
    directories.push(directory)
    const extensionPath = path.join(directory, 'extension.mjs')
    const harnessPath = path.join(directory, 'harness.mjs')
    await writeFile(extensionPath, PI_SEARCH_EXTENSION_SOURCE)
    await writeFile(
      harnessPath,
      `
import extension from ${JSON.stringify(extensionPath)}
const handlers = {}
const tools = {}
extension({
  on(name, handler) { handlers[name] = handler },
  registerTool(value) { tools[value.name] = value },
})
const toolResult = handlers.tool_result({
  content: [{ type: 'text', text: 'model-secret and github-secret' }],
  details: { nested: 'model-secret' },
})
const oversized = handlers.tool_result({
  content: [{ type: 'text', text: 'x'.repeat(200001) }],
  details: {},
})
const provider = handlers.before_provider_request({
  payload: { messages: [{ content: 'model-secret and github-secret' }] },
})
const pathBlock = await handlers.tool_call(
  { toolName: 'read', input: { path: '/proc/self/environ' } },
  { cwd: '/tmp' },
)
const bashResult = await tools.bash.execute(
  'bash-1',
  { command: 'printf "$PI_SEARCH_MODEL_SECRET"' },
  undefined,
  undefined,
  { cwd: '/tmp' },
)
console.log(JSON.stringify({
  toolResult,
  oversized,
  provider,
  toolNames: Object.keys(tools),
  pathBlock,
  bashResult,
}))
`
    )

    const capability = 'capability-token'
    const scanSecret = createHmac('sha256', capability)
      .update('pi-search:extension-secret-scan:v1')
      .digest('hex')
    const githubSecret = 'github-secret'
    const githubFingerprint = createHmac('sha256', scanSecret)
      .update(`pi-search:extension-secret-scan:v1:${githubSecret}`)
      .digest('hex')
    const { stdout } = await execFileAsync(process.execPath, [harnessPath], {
      env: {
        ...process.env,
        PI_SEARCH_CAPABILITY: capability,
        PI_SEARCH_MODEL_SECRET: 'model-secret',
        PI_SEARCH_TOOL_UID: String(process.getuid?.() ?? 65534),
        PI_SEARCH_TOOL_GID: String(process.getgid?.() ?? 65534),
        PI_SEARCH_BROKER_BASE_URL: 'https://example.com',
        PI_SEARCH_GITHUB_FINGERPRINTS: JSON.stringify([
          { length: githubSecret.length, digest: githubFingerprint },
        ]),
      },
    })
    const result = JSON.parse(stdout)
    expect(JSON.stringify(result.toolResult)).not.toContain('model-secret')
    expect(JSON.stringify(result.toolResult)).not.toContain('github-secret')
    expect(result.oversized.content[0].text).toContain('withheld')
    expect(JSON.stringify(result.provider)).not.toContain('model-secret')
    expect(JSON.stringify(result.provider)).not.toContain('github-secret')
    expect(result.toolNames).toEqual(['bash', 'exa_search'])
    expect(result.pathBlock.block).toBe(true)
    expect(result.bashResult.content[0].text).toBe('')
  })
})
