import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { createDelegatedPrincipal } from '@sim/testing/factories/principal.factory'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { setEnv } from '@sim/testing/mocks/env.mock'
import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import {
  mothershipAgentUrlMock,
  mothershipAgentUrlMockFns,
} from '@sim/testing/mocks/mothership-agent-url.mock'
import {
  mothershipAsyncRunsMock,
  mothershipAsyncRunsMockFns,
} from '@sim/testing/mocks/mothership-async-runs.mock'
import {
  mothershipGoFetchMock,
  mothershipGoFetchMockFns,
} from '@sim/testing/mocks/mothership-go-fetch.mock'
import {
  mothershipWorkspaceTargetMock,
  mothershipWorkspaceTargetMockFns,
} from '@sim/testing/mocks/mothership-workspace-target.mock'
import { redisConfigMockFns } from '@sim/testing/mocks/redis-config.mock'
import {
  remoteSandboxProviderMock,
  remoteSandboxProviderMockFns,
} from '@sim/testing/mocks/remote-sandbox-provider.mock'
import { toolsMock, toolsMockFns } from '@sim/testing/mocks/tools.mock'
import { generateShortId } from '@sim/utils/id'
import Redis from 'ioredis'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ mount: vi.fn(), find: vi.fn(), write: vi.fn() }))
vi.mock('@/tools', () => toolsMock)
vi.mock('@/lib/mothership/application/workspace-target', () => mothershipWorkspaceTargetMock)
vi.mock('@/lib/mothership/tools/secret-mount-materializer.server', () => ({
  materializeCopilotCodeSecrets: io.mount,
  CopilotCodeSecretAccessError: class extends Error {},
}))
vi.mock('@/lib/secrets/usage/record', () => ({ recordSecretUsage: vi.fn() }))
vi.mock('@/lib/execution/remote-sandbox/provider', () => remoteSandboxProviderMock)
vi.mock('@/lib/execution/remote-sandbox/resolve', () => ({
  resolveWorkspaceSandbox: async () => null,
  provisionRuntimeDependencies: async () => {},
  repairMissingSandboxImage: async () => null,
  RUNTIME_INSTALL_TIMEOUT_MS: 60_000,
}))
vi.mock('@/lib/mothership/async-runs/repository', () => mothershipAsyncRunsMock)
vi.mock('@/lib/mothership/request/go/fetch', () => mothershipGoFetchMock)
vi.mock('@/lib/mothership/server/agent-url', () => mothershipAgentUrlMock)
vi.mock('@/lib/workspace-files/application/delegated-principal', () => ({
  rebindWorkspaceFileDelegatedPrincipal: ({ principal }: { principal: unknown }) => principal,
}))
vi.mock('@/lib/mothership/vfs/resource-writer', () => ({
  validateWorkspaceFileWriteTarget: async () => ({ vfsPath: 'files/review.txt' }),
  writeWorkspaceFileByPath: io.write,
}))

import { functionExecuteBodySchema } from '@/lib/api/contracts'
import * as inProcessTransport from '@/lib/api/server/routes/in-process-transport'
import { encryptSecret } from '@/lib/core/security/encryption'
import { importDurableSecretProvenance } from '@/lib/execution/durable-secret-provenance'
import {
  PRIVATE_TOOL_METADATA_REQUEST_HEADER,
  RESOLVED_SECRET_NAMES_FIELD,
  RESOLVED_SECRET_NAMES_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import {
  initializeSessionFileProvenance,
  isSessionFileProvenanceClean,
  readSessionSecretProvenance,
  recordSessionFileInput,
} from '@/lib/execution/remote-sandbox/session-file-provenance'
import type { SandboxHandle } from '@/lib/execution/remote-sandbox/types'
import { executeFunctionRequest } from '@/lib/function-execution/execute-request'
import { readCliInputFile } from '@/lib/mothership/agent-cli/run-cli'
import { createWorkbenchFileProvenance } from '@/lib/mothership/agent-cli/workbench-file-provenance'
import { inspectToolResultForCopilot } from '@/lib/mothership/request/tools/resolved-secret-result'
import type { ToolExecutionContext } from '@/lib/mothership/tool-executor/types'
import { executeFunctionExecute } from '@/lib/mothership/tools/handlers/function-execute'
import { executeRunCode } from '@/lib/mothership/tools/handlers/run-code'
import { proxySandboxResourceRequest } from '@/lib/mothership/tools/sandbox-resource-transport'
import {
  readSandboxResourceScope,
  withSandboxResourceScope,
} from '@/lib/mothership/tools/sandbox-resources'
import { buildMothershipSandboxSession } from '@/lib/mothership/tools/sandbox-session'
import { chatSandboxSessionKey } from '@/lib/mothership/tools/sandbox-session-key'
import { reportTableRowDelivery } from '@/lib/table/application/row-delivery-observer'
import { reportWorkspaceFileDelivery } from '@/lib/workspace-files/application/file-delivery-observer'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { buildFunctionExecuteBody, functionExecuteTool } from '@/tools/function/execute'
import type { CodeExecutionInput } from '@/tools/function/types'

const socket = process.env.MSHIP_TEST_REDIS_SOCKET
if (!socket) throw new Error('MSHIP_TEST_REDIS_SOCKET must identify a disposable local Redis')
const redis = new Redis({ path: socket, retryStrategy: () => null, maxRetriesPerRequest: 1 })
const execute = promisify(execFile)
const canary = 'SYNTHETIC_REVIEW_SECRET_9b78e6dc'
const scope = { userId: 'review-actor', workspaceId: 'review-workspace' }
const roots: string[] = []
let root: string
let chatId: string
let machine: SandboxHandle
let catalog: Array<{ name: string; plaintext: string; encryptedValue: string }>
let parent: ResolvedSecretTraceRegistry

function workerPath(path: string) {
  return path.startsWith('/') ? join(root, path.slice(1)) : join(root, 'home/user', path)
}

async function runWorkerProcess(
  executable: string,
  args: string[],
  options: Parameters<SandboxHandle['runCommand']>[1]
) {
  const envs = Object.fromEntries(
    Object.entries(options.envs ?? {}).map(([key, value]) => [
      key,
      value
        .replaceAll('/home/user', workerPath('/home/user'))
        .replaceAll('/tmp/sim/', `${workerPath('/tmp/sim')}/`)
        .replaceAll('/tmp/.sim-private-input-', workerPath('/tmp/.sim-private-input-')),
    ])
  )
  try {
    const output = await execute(executable, args, {
      cwd: workerPath('/home/user'),
      env: { PATH: '/usr/bin:/bin:/opt/homebrew/bin', ...envs },
      timeout: options.timeoutMs,
      maxBuffer: options.maxOutputBytes,
    })
    return { ...output, exitCode: 0 }
  } catch (error) {
    const failure = error as { stdout: string; stderr: string; code: number }
    return { stdout: failure.stdout, stderr: failure.stderr, exitCode: failure.code }
  }
}

function localWorker(): SandboxHandle {
  return {
    sandboxId: `local-${generateShortId(12)}`,
    async runCode(code, options) {
      const result = await runWorkerProcess(process.execPath, ['-e', code], options)
      return {
        text: '',
        stdout: result.stdout,
        stderr: result.stderr,
        ...(result.exitCode ? { error: { name: 'RuntimeError', value: result.stderr } } : {}),
      }
    },
    runCommand: (command, options) => runWorkerProcess('/bin/bash', ['-c', command], options),
    extendLifetime: async () => {},
    getFileSize: async (path) => (await stat(workerPath(path))).size,
    readFile: async (path) => readFile(workerPath(path), 'utf8'),
    async readFileWithLimit(path, options) {
      const bytes = await readFile(workerPath(path))
      if (bytes.length > options.maxBytes) throw new Error('Local worker byte cap')
      return { content: bytes.toString(options.encoding), byteLength: bytes.length }
    },
    async writeFile(path, content) {
      await mkdir(dirname(workerPath(path)), { recursive: true })
      await writeFile(
        workerPath(path),
        typeof content === 'string' ? content : Buffer.from(content)
      )
    },
    removeFile: async (path) => rm(workerPath(path), { force: true }),
    async listFiles(path) {
      const entries = await readdir(workerPath(path), { withFileTypes: true })
      return Promise.all(
        entries.map(async (entry) => ({
          path: `${path}/${entry.name}`,
          relativePath: entry.name,
          kind: entry.isDirectory() ? ('directory' as const) : ('file' as const),
          size: (await stat(workerPath(`${path}/${entry.name}`))).size,
        }))
      )
    },
    kill: async () => {},
  }
}

beforeEach(async () => {
  redisConfigMockFns.mockGetRedisClient.mockReturnValue(redis)
  redisConfigMockFns.mockAcquireLock.mockImplementation(
    async (key: string, owner: string, ttl: number) =>
      (await redis.set(key, owner, 'EX', ttl, 'NX')) === 'OK'
  )
  redisConfigMockFns.mockExtendLock.mockImplementation(
    async (key: string, owner: string, ttl: number) =>
      (await redis.eval(
        "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('EXPIRE',KEYS[1],ARGV[2]) else return 0 end",
        1,
        key,
        owner,
        ttl
      )) === 1
  )
  redisConfigMockFns.mockReleaseLock.mockImplementation(async (key: string, owner: string) => {
    await redis.eval(
      "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
      1,
      key,
      owner
    )
  })
  remoteSandboxProviderMockFns.mockResolveProvider.mockReturnValue({
    id: 'e2b',
    dependencyStrategy: 'prebuilt',
    resolveLifetimeMs: (ms: number) => ms,
    findSessionSandbox: io.find,
    create: async () => {
      throw new Error('Only the existing disposable worker may be used')
    },
  })
  setEnv({
    ENCRYPTION_KEY: 'a'.repeat(64),
    MOTHERSHIP_SIM_TRANSPORT: 'direct',
    MOTHERSHIP_SANDBOX_CLI_ENDPOINT: 'https://callback.test',
  })
  mothershipAsyncRunsMockFns.mockIsActiveSandboxResourceOwner.mockResolvedValue(true)
  mothershipAgentUrlMockFns.mockGetMothershipBaseURL.mockResolvedValue('https://worker.test')
  mothershipGoFetchMockFns.mockFetchGo.mockImplementation(async () =>
    Response.json({ version: 1, entrypoint: 'fixture-bootstrap' })
  )
  envFlagsMock.isMothershipSandboxEnabled = true
  envFlagsMock.isRemoteSandboxEnabled = true
  root = await mkdtemp('/private/tmp/sim-workbench-test-')
  roots.push(root)
  await mkdir(workerPath('/home/user'), { recursive: true })
  chatId = `review-${generateShortId(12)}`
  machine = localWorker()
  io.find.mockResolvedValue(machine)
  const encryptedValue = (await encryptSecret(canary)).encrypted
  catalog = [{ name: 'TOKEN', plaintext: canary, encryptedValue }]
  parent = new ResolvedSecretTraceRegistry(catalog, scope)
  io.mount.mockResolvedValue({ envVars: { TOKEN: canary }, catalogEntries: catalog })
  await initializeSessionFileProvenance(chatSandboxSessionKey(chatId), {
    providerId: 'e2b',
    sandboxId: machine.sandboxId,
  })
  io.write.mockImplementation(async () => ({
    file: { id: 'review-file', name: 'review.txt', size: canary.length, type: 'text/plain' },
    vfsPath: 'files/review.txt',
  }))
  toolsMockFns.mockExecuteTool.mockImplementation(
    async (
      _id,
      params: CodeExecutionInput,
      options: { resolvedSecretTraceRegistry: ResolvedSecretTraceRegistry }
    ) => {
      const finishActivation = options.resolvedSecretTraceRegistry.beginPendingActivation()
      try {
        const headers = new Headers({
          [PRIVATE_TOOL_METADATA_REQUEST_HEADER]: RESOLVED_SECRET_NAMES_METADATA_V1,
        })
        const response = await executeFunctionRequest(
          { headers, signal: AbortSignal.timeout(15_000) },
          functionExecuteBodySchema.parse(buildFunctionExecuteBody(params)),
          {
            attributedUserId: scope.userId,
            principal: createDelegatedPrincipal({
              subjectUserId: scope.userId,
              workspaceId: scope.workspaceId,
            }),
            sandboxProfile: 'mothership',
            resolvedSecretTraceRegistry: options.resolvedSecretTraceRegistry,
          }
        )
        const payload = await response.json()
        for (const name of payload[RESOLVED_SECRET_NAMES_FIELD] ?? []) {
          expect(
            options.resolvedSecretTraceRegistry.recordResolved(name, params.envVars![name], {
              propagated: true,
            })
          ).toBe(true)
        }
        return await functionExecuteTool.transformResponse!(Response.json(payload))
      } finally {
        finishActivation()
      }
    }
  )
})

afterAll(async () => {
  redis.disconnect()
  for (const path of roots) await rm(path, { recursive: true, force: true })
})

function context(): ToolExecutionContext {
  return {
    ...scope,
    workflowId: '',
    chatId,
    resolvedSecretTraceRegistry: parent.forkForInputPaths([]),
  }
}

async function run(
  code: string,
  secrets: string[] = [],
  language: 'shell' | 'javascript' = 'shell'
) {
  const current = context()
  const raw = await inResourceScope(() => executeRunCode({ code, language, secrets }, current))
  const projected = inspectToolResultForCopilot(
    raw,
    current.resolvedSecretTraceRegistry,
    'run_code'
  )
  if (projected.safe) parent.mergeToolCallRegistry(current.resolvedSecretTraceRegistry!)
  return { raw, projected }
}

function inResourceScope<T>(action: () => Promise<T>) {
  return withSandboxResourceScope(
    {
      ...scope,
      chatId,
      runId: 'fixture-run',
      toolCallId: 'fixture-call',
      ownerToken: 'fixture-owner',
    },
    AbortSignal.timeout(15_000),
    undefined,
    action
  )
}

async function sandboxApi(path: string, handler: () => Promise<Response>, method = 'GET') {
  mothershipWorkspaceTargetMockFns.mockResolveInvocationWorkspace.mockResolvedValue(scope)
  vi.spyOn(inProcessTransport, 'matchV2Route').mockReturnValue({
    pattern: path,
    params: { fileId: 'fixture', tableId: 'fixture' },
    literals: 3,
    load: async () => ({ GET: handler, POST: handler }),
  })
  return inResourceScope(async () => {
    const session = await buildMothershipSandboxSession({
      ...scope,
      sessionKey: chatSandboxSessionKey(chatId),
    })
    const endpoint = session.envs!.SIM_ENDPOINT
    return proxySandboxResourceRequest(
      new Request(`${endpoint}${path}`, {
        method,
        headers: { 'x-api-key': session.envs!.SIM_API_KEY },
      }),
      endpoint.split('/').at(-1)!
    )
  })
}

describe('generated workbench file provenance', () => {
  const identity = () => ({ providerId: 'e2b' as const, sandboxId: machine.sandboxId })
  const observer = () =>
    createWorkbenchFileProvenance({
      ...scope,
      sessionKey: chatSandboxSessionKey(chatId),
    })
  const consume = async (stream: ReadableStream<Uint8Array>) =>
    Buffer.from(await new Response(stream).arrayBuffer())

  it.each(['receipt.json', 'screenshot.png'])(
    'admits fresh %s bytes from a clean workbench',
    async (path) => {
      const bytes = path.endsWith('.json')
        ? Buffer.from('{"done":true}')
        : Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
      const result = await run(
        `printf '%s' '${bytes.toString('base64')}' | base64 --decode > ${path}`
      )
      expect(result.raw.success).toBe(true)
      expect(result.projected.safe).toBe(true)
      const file = observer()
      const stream = Readable.toWeb(
        createReadStream(workerPath(`/home/user/${path}`))
      ) as ReadableStream<Uint8Array>
      expect(await consume(file.observeUpload(identity(), stream))).toEqual(bytes)
      expect(file.uploadProvenance()).toEqual({ status: 'exact', entries: [] })
    }
  )

  it.each(['unrecorded', 'unregistered'] as const)(
    'allows %s downloaded bytes without losing earlier named secret protection',
    async (classification) => {
      await run('printf "%s" "$TOKEN" > saved.txt', ['TOKEN'])
      const file = observer()
      const stream = new Blob(['ordinary user input']).stream()
      if (classification === 'unrecorded') file.trackDownload(stream, { status: 'unrecorded' })
      await machine.writeFile(
        '/home/user/input.txt',
        await consume(file.observeDownload(identity(), stream))
      )
      const result = await run('cat input.txt saved.txt')
      expect(result.projected.safe).toBe(true)
      expect(result.projected.result).toMatchObject({
        success: true,
        output: { stdout: 'ordinary user input{{TOKEN}}' },
      })
    }
  )

  it('keeps an expected but missing download classification unavailable', async () => {
    const file = observer()
    const stream = new Blob(['ordinary bytes']).stream()
    file.trackDownload(stream, undefined)
    await consume(file.observeDownload(identity(), stream))
    expect(await readSessionSecretProvenance(chatSandboxSessionKey(chatId), identity())).toEqual({
      status: 'unknown',
    })
  })

  it('does not clear an earlier protection fault when unrecorded bytes arrive', async () => {
    await recordSessionFileInput(chatSandboxSessionKey(chatId), identity(), false)
    const file = observer()
    await consume(file.observeDownload(identity(), new Blob(['ordinary bytes']).stream()))
    expect(await readSessionSecretProvenance(chatSandboxSessionKey(chatId), identity())).toEqual({
      status: 'unknown',
    })
  })

  it.each(['same', 'foreign', 'anonymous'] as const)(
    'carries %s-scope machine secrets into new file redaction',
    async (source) => {
      await recordSessionFileInput(chatSandboxSessionKey(chatId), identity(), {
        status: 'exact',
        entries: [
          {
            name: 'TOKEN',
            encryptedValue: catalog[0].encryptedValue,
            ...(source === 'anonymous'
              ? {}
              : {
                  sourceUserId: source === 'same' ? scope.userId : 'another-user',
                  sourceWorkspaceId: scope.workspaceId,
                }),
          },
        ],
      })
      const file = observer()
      await consume(file.observeUpload(identity(), new Blob([canary]).stream()))
      const provenance = file.uploadProvenance()
      expect(provenance.status).toBe('exact')
      if (provenance.status !== 'exact') throw new Error('Expected verified provenance')
      const registry = new ResolvedSecretTraceRegistry([], scope)
      expect(await importDurableSecretProvenance(registry, provenance)).toBe(true)
      expect(projectResolvedSecretModelContent(canary, registry)).toMatchObject({
        safe: true,
        value: source === 'same' ? '{{TOKEN}}' : '[REDACTED_SECRET]',
      })
    }
  )

  it('never treats failed history decryption as an empty protected-secret set', async () => {
    await recordSessionFileInput(chatSandboxSessionKey(chatId), identity(), {
      status: 'exact',
      entries: [{ encryptedValue: 'invalid-ciphertext', sourceUserId: scope.userId }],
    })
    const file = observer()
    await consume(file.observeUpload(identity(), new Blob(['ordinary file']).stream()))
    expect(file.uploadProvenance()).toEqual({ status: 'unknown' })
  })

  it('applies the shared short-value exemption to generated opaque bytes and CLI input', async () => {
    const short = '1234567'
    const encryptedValue = (await encryptSecret(short)).encrypted
    await recordSessionFileInput(chatSandboxSessionKey(chatId), identity(), {
      status: 'exact',
      entries: [
        {
          name: 'SHORT_TOKEN',
          encryptedValue,
          sourceUserId: scope.userId,
          sourceWorkspaceId: scope.workspaceId,
        },
      ],
    })
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    await machine.writeFile('/home/user/image.png', bytes)
    expect(await readCliInputFile(chatSandboxSessionKey(chatId), 'image.png')).toEqual(bytes)
    const file = observer()
    await consume(file.observeUpload(identity(), new Blob([bytes]).stream()))
    expect(file.uploadProvenance()).toEqual({ status: 'exact', entries: [] })
  })

  it('includes secrets admitted while upload bytes are still streaming', async () => {
    const began = createDeferred<void>()
    const finish = createDeferred<void>()
    const file = observer()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(Buffer.from(canary))
        began.resolve()
        await finish.promise
        controller.close()
      },
    })
    const consumed = consume(file.observeUpload(identity(), stream))
    await began.promise
    await recordSessionFileInput(chatSandboxSessionKey(chatId), identity(), {
      status: 'exact',
      entries: [
        {
          name: 'TOKEN',
          encryptedValue: catalog[0].encryptedValue,
          sourceUserId: scope.userId,
          sourceWorkspaceId: scope.workspaceId,
        },
      ],
    })
    finish.resolve()
    await consumed
    expect(file.uploadProvenance()).toMatchObject({ status: 'exact', entries: [{ name: 'TOKEN' }] })
  })
})

describe('sandbox API provenance admission', () => {
  it('keeps ordinary API mutations usable for later code output and generated CLI input', async () => {
    const response = await sandboxApi(
      '/api/v2/custom-tools',
      async () => Response.json({ data: { id: 'fixture-tool', title: 'fixture' } }),
      'POST'
    )
    expect(response.status).toBe(200)
    const result = await run('printf "[]" > operations.json; printf "ready"')
    expect(result.projected.safe).toBe(true)
    expect(result.projected.result).toMatchObject({ success: true, output: { stdout: 'ready' } })
    expect(
      (await readCliInputFile(chatSandboxSessionKey(chatId), 'operations.json')).toString()
    ).toBe('[]')
  })

  it('retains earlier secret protection after an API response without provenance', async () => {
    await run('printf "%s" "$TOKEN" > saved.txt', ['TOKEN'])
    await sandboxApi('/api/v2/custom-tools', async () => Response.json({ data: [] }))
    const result = await run('cat saved.txt')
    expect(result.projected.safe).toBe(true)
    expect(result.projected.result).toMatchObject({
      success: true,
      output: { stdout: '{{TOKEN}}' },
    })
    await expect(readCliInputFile(chatSandboxSessionKey(chatId), 'saved.txt')).rejects.toThrow(
      'protected workbench values'
    )
  })

  it.each(['file', 'table'] as const)(
    'imports explicit %s delivery evidence before later output',
    async (source) => {
      const response = await sandboxApi(
        `/api/v2/${source === 'file' ? 'files/fixture' : 'tables/fixture/rows'}`,
        async () => {
          if (source === 'file') {
            await reportWorkspaceFileDelivery({
              status: 'exact',
              entries: [
                {
                  name: 'TOKEN',
                  encryptedValue: catalog[0].encryptedValue,
                  sourceUserId: scope.userId,
                  sourceWorkspaceId: scope.workspaceId,
                },
              ],
            })
          } else {
            await reportTableRowDelivery(
              {
                version: 1,
                complete: true,
                scope,
                entries: [{ name: 'TOKEN', encryptedValue: catalog[0].encryptedValue }],
              },
              [{ value: canary }]
            )
          }
          return new Response(canary)
        }
      )
      await machine.writeFile('/home/user/delivered.txt', await response.text())
      const result = await run('cat delivered.txt')
      expect(result.projected.safe).toBe(true)
      expect(result.projected.result).toMatchObject({
        success: true,
        output: { stdout: '{{TOKEN}}' },
      })
    }
  )

  it('accepts explicitly unrecorded file delivery and retains earlier secret history', async () => {
    await run('printf "%s" "$TOKEN" > saved.txt', ['TOKEN'])
    const response = await sandboxApi('/api/v2/files/fixture/download', async () => {
      await reportWorkspaceFileDelivery({ status: 'unrecorded' })
      return new Response('ordinary user input')
    })
    await machine.writeFile('/home/user/input.txt', await response.text())
    const result = await run('cat input.txt saved.txt')
    expect(result.projected.safe).toBe(true)
    expect(result.projected.result).toMatchObject({
      success: true,
      output: { stdout: 'ordinary user input{{TOKEN}}' },
    })
  })

  it('preserves mutation completion and withholds its body when provenance storage fails', async () => {
    const mutationPath = join(root, 'mutation.json')
    const response = await sandboxApi(
      '/api/v2/tables/fixture/rows',
      async () => {
        await writeFile(mutationPath, JSON.stringify({ committed: true, completed: false }))
        const evalCommand = redis.eval.bind(redis)
        vi.spyOn(redis, 'eval').mockImplementation((...args) => {
          if (String(args[2]).startsWith('mothership:workbench-provenance:v2:')) {
            return Promise.reject(new Error('Synthetic provenance storage failure'))
          }
          return evalCommand(...args)
        })
        await reportTableRowDelivery(
          {
            version: 1,
            complete: true,
            scope,
            entries: [{ name: 'TOKEN', encryptedValue: catalog[0].encryptedValue }],
          },
          [{ value: canary }]
        )
        await writeFile(mutationPath, JSON.stringify({ committed: true, completed: true }))
        return Response.json({ data: { value: canary } }, { status: 201 })
      },
      'POST'
    )
    expect(JSON.parse(await readFile(mutationPath, 'utf8'))).toEqual({
      committed: true,
      completed: true,
    })
    expect(response.status).toBe(502)
    const body = await response.text()
    expect(body).not.toContain(canary)
    expect(body).toContain('completed with HTTP 201')
    expect(body).toContain('Do not retry a mutation automatically')
  })

  it.each(['file', 'table'] as const)(
    'preserves an explicit unknown %s delivery as unknown',
    async (source) => {
      await sandboxApi(
        `/api/v2/${source === 'file' ? 'files/fixture' : 'tables/fixture/rows'}`,
        async () => {
          if (source === 'file') await reportWorkspaceFileDelivery({ status: 'unknown' })
          else
            await reportTableRowDelivery({ version: 1, complete: false, entries: [] }, [
              { value: 'unknown' },
            ])
          return new Response('unknown')
        }
      )
      const result = await run('printf "ready"')
      expect(result.projected.safe).toBe(false)
      expect(JSON.stringify(result.projected.result)).not.toContain('ready')
    }
  )
})

describe('persistent workbench output confidentiality', () => {
  it.each(['javascript', 'shell'] as const)(
    'redacts session credentials in %s output while preserving routing metadata',
    async (language) => {
      const code =
        language === 'shell'
          ? 'printf "%s" "$SIM_API_KEY" > session-key.txt; printf "%s %s" "$SIM_API_KEY" "$SIM_WORKSPACE"'
          : '(await import("node:fs")).writeFileSync("session-key.txt", process.env.SIM_API_KEY); process.stdout.write(process.env.SIM_API_KEY + " " + process.env.SIM_WORKSPACE)'
      const result = await run(code, [], language)
      expect(result.raw.success).toBe(true)
      const credential = await readFile(workerPath('session-key.txt'), 'utf8')
      expect(credential).toMatch(/^mothership-sandbox:/)
      expect(result.projected.safe).toBe(true)
      expect(JSON.stringify(result.projected.result)).not.toContain(credential)
      expect(JSON.stringify(result.projected.result)).toContain('{{SIM_API_KEY}}')
      expect(JSON.stringify(result.projected.result)).toContain(scope.workspaceId)
      expect(
        await readSessionSecretProvenance(chatSandboxSessionKey(chatId), {
          providerId: 'e2b',
          sandboxId: machine.sandboxId,
        })
      ).toEqual({ status: 'exact', entries: [] })
    }
  )
  it('redacts session credentials when the provider falls back to a one-shot machine', async () => {
    remoteSandboxProviderMockFns.mockResolveProvider.mockReturnValue({
      id: 'e2b',
      dependencyStrategy: 'prebuilt',
      resolveLifetimeMs: (ms: number) => ms,
      create: async () => machine,
    })
    const result = await run('printf "%s" "$SIM_API_KEY" > session-key.txt; cat session-key.txt')
    const credential = await readFile(workerPath('session-key.txt'), 'utf8')
    expect(result.raw.success).toBe(true)
    expect(result.projected.safe).toBe(true)
    expect(JSON.stringify(result.projected.result)).not.toContain(credential)
    expect(JSON.stringify(result.projected.result)).toContain('{{SIM_API_KEY}}')
  })
  it('omits session authentication if its encrypted receipt cannot be created', async () => {
    setEnv({ ENCRYPTION_KEY: '' })
    const result = await run('test -z "$SIM_API_KEY" && printf allowed')
    expect(result.raw.success).toBe(true)
    expect(JSON.stringify(result.projected.result)).toContain('allowed')
  })
  it('keeps large ordinary results readable when callback credentials are absent from them', async () => {
    const result = await run('return Array.from({ length: 100_001 }, () => 0)', [], 'javascript')
    expect(result.raw.success).toBe(true)
    expect(result.raw.output).toHaveProperty('result.length', 100_001)
    expect(result.projected.safe).toBe(true)
  })
  it.each([
    ['array', '[', ']'],
    ['object', '{"nested":', '}'],
  ])(
    'classifies deeply nested %s output without exhausting the call stack',
    async (_kind, open, close) => {
      await inResourceScope(async () => {
        const session = await buildMothershipSandboxSession({
          ...scope,
          sessionKey: chatSandboxSessionKey(chatId),
        })
        const credential = session.envs!.SIM_API_KEY
        const nested = (leaf: string) =>
          JSON.parse(open.repeat(12_000) + JSON.stringify(leaf) + close.repeat(12_000))
        expect(session.outputProvenance!(nested('ordinary output'))).toEqual({
          status: 'exact',
          entries: [],
        })
        expect(session.outputProvenance!(nested(credential))).toMatchObject({
          status: 'exact',
          entries: [{ name: 'SIM_API_KEY' }],
        })
      })
    }
  )
  it('revokes callback authentication before a result reaches the model', async () => {
    const result = await run(
      'printf "%s" "$SIM_API_KEY" > session-key.txt; printf "%s" "$SIM_ENDPOINT" > session-endpoint.txt; printf done'
    )
    const credential = await readFile(workerPath('session-key.txt'), 'utf8')
    const endpoint = await readFile(workerPath('session-endpoint.txt'), 'utf8')
    expect(result.raw.success).toBe(true)
    expect(result.projected.safe).toBe(true)
    expect(await readSandboxResourceScope(endpoint.split('/').at(-1)!, credential)).toBeNull()
  })

  it('allows a mounted empty value without requiring a redaction receipt', async () => {
    const emptyCatalog = [
      { name: 'TOKEN', plaintext: '', encryptedValue: (await encryptSecret('')).encrypted },
    ]
    io.mount.mockResolvedValue({ envVars: { TOKEN: '' }, catalogEntries: emptyCatalog })
    const result = await run('printenv TOKEN >/dev/null && test -z "$TOKEN" && printf allowed', [
      'TOKEN',
    ])
    expect(result.raw.success).toBe(true)
    expect(result.projected.safe).toBe(true)
    expect(JSON.stringify(result.projected.result)).toContain('allowed')
  })
  it('control: same-call secret output is redacted', async () => {
    const result = await run('printf "%s" "$TOKEN"', ['TOKEN'])
    expect(result.raw.success).toBe(true)
    expect(result.projected.safe).toBe(true)
    expect(JSON.stringify(result.projected.result)).not.toContain(canary)
    expect(JSON.stringify(result.projected.result)).toContain('{{TOKEN}}')
  })
  it.each([
    ['stdout', 'cat saved.txt'],
    ['structured result', 'printf "__SIM_RESULT__=\\\"%s\\\"\\n" "$(cat saved.txt)"'],
    ['error and stderr', 'cat saved.txt >&2; exit 1'],
  ])('protects later-call output in %s', async (_name, code) => {
    const first = await run('printf "%s" "$TOKEN" > saved.txt', ['TOKEN'])
    expect(first.raw.success).toBe(true)
    expect(JSON.stringify(first.projected.result)).not.toContain(canary)
    const later = await run(code)
    expect(later.projected.safe).toBe(true)
    expect(JSON.stringify(later.projected.result)).not.toContain(canary)
    expect(JSON.stringify(later.projected.result)).toContain('{{TOKEN}}')
  })
  it('protects later-call output after an earlier result was redacted', async () => {
    const first = await run('printf "%s" "$TOKEN" > saved.txt; cat saved.txt', ['TOKEN'])
    expect(JSON.stringify(first.projected.result)).toContain('{{TOKEN}}')
    expect(parent.getModelEgressSnapshot().matches?.length).toBeGreaterThan(0)
    const later = await run('cat saved.txt')
    expect(later.projected.safe).toBe(true)
    expect(JSON.stringify(later.projected.result)).not.toContain(canary)
    expect(JSON.stringify(later.projected.result)).toContain('{{TOKEN}}')
  })
  it('refuses secret-bearing CLI input', async () => {
    await run('printf "%s" "$TOKEN" > saved.txt', ['TOKEN'])
    await expect(readCliInputFile(chatSandboxSessionKey(chatId), 'saved.txt')).rejects.toThrow()
  })
  it('permits secret-free CLI input after a secret was received', async () => {
    await run('printf clean > clean.txt', ['TOKEN'])
    expect((await readCliInputFile(chatSandboxSessionKey(chatId), 'clean.txt')).toString()).toBe(
      'clean'
    )
  })
  it('cannot disable redaction through model-supplied secret flags', async () => {
    const current = context()
    const raw = await executeRunCode(
      {
        code: 'printf \"%s\" \"$TOKEN\"',
        language: 'shell',
        secrets: ['TOKEN'],
        unredactedSecretNames: ['TOKEN'],
      },
      current
    )
    const projected = inspectToolResultForCopilot(
      raw,
      current.resolvedSecretTraceRegistry,
      'run_code'
    )
    expect(projected.safe).toBe(true)
    expect(JSON.stringify(projected.result)).not.toContain(canary)
  })
  it('withholds output when physical machine history is unknown', async () => {
    await run('printf "%s" "$TOKEN" > saved.txt', ['TOKEN'])
    await recordSessionFileInput(
      chatSandboxSessionKey(chatId),
      { providerId: 'e2b', sandboxId: machine.sandboxId },
      false
    )
    expect(
      await isSessionFileProvenanceClean(chatSandboxSessionKey(chatId), {
        providerId: 'e2b',
        sandboxId: machine.sandboxId,
      })
    ).toBe(false)
    const result = await run('cat saved.txt')
    expect(result.projected.safe).toBe(false)
    expect(JSON.stringify(result.projected.result)).not.toContain(canary)
    expect(result.raw.success).toBe(false)
  })
  it('retains both values of a rotated secret without storing plaintext', async () => {
    await run('printf "%s" "$TOKEN" > first.txt', ['TOKEN'])
    const rotated = 'SYNTHETIC_ROTATED_VALUE_8e13b77f'
    const entry = {
      name: 'TOKEN',
      plaintext: rotated,
      encryptedValue: (await encryptSecret(rotated)).encrypted,
    }
    io.mount.mockResolvedValue({ envVars: { TOKEN: rotated }, catalogEntries: [entry] })
    await run('printf "%s" "$TOKEN" > second.txt', ['TOKEN'])
    const output = await run('cat first.txt second.txt')
    expect(output.projected.safe).toBe(true)
    expect(JSON.stringify(output.projected.result)).not.toContain(canary)
    expect(JSON.stringify(output.projected.result)).not.toContain(rotated)
    const history = await readSessionSecretProvenance(chatSandboxSessionKey(chatId), {
      providerId: 'e2b',
      sandboxId: machine.sandboxId,
    })
    expect(history.status).toBe('exact')
    expect(JSON.stringify(history)).not.toContain(canary)
    expect(JSON.stringify(history)).not.toContain(rotated)
  })
  it('reads history after overlapping code has received a new secret', async () => {
    const started = createDeferred<void>()
    const finish = createDeferred<void>()
    const runCommand = machine.runCommand
    machine.runCommand = async (command, options) => {
      if (command === 'WAIT_FOR_LATER_INPUT') {
        started.resolve()
        await finish.promise
        return { stdout: canary, stderr: '', exitCode: 0 }
      }
      return runCommand(command, options)
    }
    const earlier = run('WAIT_FOR_LATER_INPUT')
    await started.promise
    const later = await run('printf "%s" "$TOKEN" > overlap.txt', ['TOKEN'])
    expect(later.raw.success).toBe(true)
    finish.resolve()
    const output = await earlier
    expect(output.projected.safe).toBe(true)
    expect(JSON.stringify(output.projected.result)).not.toContain(canary)
    expect(JSON.stringify(output.projected.result)).toContain('{{TOKEN}}')
  })
  it('redacts session credentials when an export write fails', async () => {
    io.write.mockRejectedValueOnce(new Error('Write unavailable'))
    const current = context()
    const raw = await inResourceScope(() =>
      executeFunctionExecute(
        {
          code: 'printf "%s" "$SIM_API_KEY" > session-key.txt; cat session-key.txt; printf data > export.txt',
          language: 'shell',
          outputs: {
            files: [{ path: 'files/export.txt', sandboxPath: 'export.txt' }],
          },
        },
        current
      )
    )
    const credential = await readFile(workerPath('session-key.txt'), 'utf8')
    const projected = inspectToolResultForCopilot(
      raw,
      current.resolvedSecretTraceRegistry,
      'function_execute'
    )
    expect(raw.success).toBe(false)
    expect(projected.safe).toBe(true)
    expect(JSON.stringify(projected.result)).not.toContain(credential)
    expect(JSON.stringify(projected.result)).toContain('{{SIM_API_KEY}}')
  })
  it.each([
    '{ nested: [process.env.SIM_API_KEY] }',
    '{ nested: [{ [process.env.SIM_API_KEY]: true }] }',
  ])('redacts session credentials in returned %s', async (value) => {
    const result = await run(
      `(await import("node:fs")).writeFileSync("session-key.txt", process.env.SIM_API_KEY); return ${value}`,
      [],
      'javascript'
    )
    const credential = await readFile(workerPath('session-key.txt'), 'utf8')
    expect(result.raw.success).toBe(true)
    expect(result.projected.safe).toBe(true)
    expect(JSON.stringify(result.projected.result)).not.toContain(credential)
    expect(JSON.stringify(result.projected.result)).toContain('{{SIM_API_KEY}}')
  })
  it('keeps ordinary binary exports usable when only callback authentication is present', async () => {
    const result = await inResourceScope(() =>
      executeFunctionExecute(
        {
          code: "printf '\\211PNG\\000\\001' > image.png",
          language: 'shell',
          outputs: { files: [{ path: 'files/image.png', sandboxPath: 'image.png' }] },
        },
        context()
      )
    )
    expect(result.success).toBe(true)
    const saved = io.write.mock.calls.at(-1)![0]
    expect(saved.buffer).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]))
    expect(saved.secretProvenance).toEqual({ status: 'exact', entries: [] })
  })
  it('retains export lineage for archive inspection and redaction in a fresh workbench', async () => {
    const initial = await run('printf "%s" "$TOKEN" > payload.txt', ['TOKEN'])
    expect(initial.projected.safe).toBe(true)
    const result = await inResourceScope(() =>
      executeFunctionExecute(
        {
          code: `python3 - <<'PYTHON'
import zipfile
with zipfile.ZipFile('bundle.zip', 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    archive.write('payload.txt')
    archive.writestr('operations.json', '[]')
PYTHON`,
          language: 'shell',
          outputs: { files: [{ path: 'files/bundle.zip', sandboxPath: 'bundle.zip' }] },
        },
        context()
      )
    )
    expect(result.success).toBe(true)
    const saved = io.write.mock.calls.at(-1)?.[0]
    if (!saved) throw new Error('Archive export did not persist a file')
    expect(saved.buffer.includes(Buffer.from(canary))).toBe(false)
    expect(saved.secretProvenance).toMatchObject({
      status: 'exact',
      entries: [expect.objectContaining({ name: 'TOKEN', sourceUserId: scope.userId })],
    })
    expect(JSON.stringify(saved.secretProvenance)).not.toContain(canary)

    root = await mkdtemp('/private/tmp/sim-workbench-test-')
    roots.push(root)
    await mkdir(workerPath('/home/user'), { recursive: true })
    chatId = `review-${generateShortId(12)}`
    machine = localWorker()
    io.find.mockResolvedValue(machine)
    parent = new ResolvedSecretTraceRegistry([], scope)
    const identity = { providerId: 'e2b' as const, sandboxId: machine.sandboxId }
    await initializeSessionFileProvenance(chatSandboxSessionKey(chatId), identity)
    const file = createWorkbenchFileProvenance({
      ...scope,
      sessionKey: chatSandboxSessionKey(chatId),
    })
    const stream = new Blob([saved.buffer]).stream()
    file.trackDownload(stream, saved.secretProvenance)
    await machine.writeFile(
      '/home/user/bundle.zip',
      Buffer.from(await new Response(file.observeDownload(identity, stream)).arrayBuffer())
    )
    const listing = await run(`python3 - <<'PYTHON'
import hashlib, zipfile
with open('bundle.zip', 'rb') as source:
    print(hashlib.sha256(source.read()).hexdigest())
with zipfile.ZipFile('bundle.zip') as archive:
    print(','.join(archive.namelist()))
    archive.extractall()
PYTHON`)
    expect(listing.projected.safe).toBe(true)
    expect(listing.projected.result).toMatchObject({
      success: true,
      output: {
        stdout: `${createHash('sha256').update(saved.buffer).digest('hex')}\npayload.txt,operations.json`,
      },
    })
    const readback = await run('cat payload.txt')
    expect(readback.projected.safe).toBe(true)
    expect(readback.projected.result).toMatchObject({
      success: true,
      output: { stdout: '{{TOKEN}}' },
    })
    expect(JSON.stringify(readback.projected.result)).not.toContain(canary)
    const ordinary = await run('printf ready')
    expect(ordinary.projected.result).toMatchObject({
      success: true,
      output: { stdout: 'ready' },
    })
    expect(
      (await readCliInputFile(chatSandboxSessionKey(chatId), 'operations.json')).toString()
    ).toBe('[]')
  })
  it('retains historical secret provenance on a text export', async () => {
    await run('printf "%s" "$TOKEN" > saved.txt', ['TOKEN'])
    const current = context()
    const result = await executeFunctionExecute(
      {
        code: 'true',
        language: 'shell',
        outputs: { files: [{ path: 'files/review.txt', sandboxPath: 'saved.txt' }] },
      },
      current
    )
    expect(result.success).toBe(true)
    expect(io.write).toHaveBeenCalled()
    const saved = io.write.mock.calls.at(-1)![0]
    expect(saved.buffer.toString()).toBe(canary)
    expect(saved.secretProvenance.status).toBe('exact')
    expect(saved.secretProvenance.entries.length).toBeGreaterThan(0)
  })
})
