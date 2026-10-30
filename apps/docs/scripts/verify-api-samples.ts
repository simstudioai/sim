import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { toArray, toRecord } from '@sim/utils/object'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { requestSamples } from '@/lib/content/openapi'
import type { OperationReference } from '@/lib/content/types'
import { OPENAPI_DOCUMENTS_BY_FILE } from '@/lib/openapi-documents'

const logger = createLogger('DocsApiSamples')
const reportPath = process.env.DOCS_SAMPLES_REPORT_PATH
if (!reportPath) throw new Error('DOCS_SAMPLES_REPORT_PATH is required')
const directory = join(dirname(reportPath), 'api-samples')
const syntaxLanguages = new Set(
  (process.env.DOCS_SAMPLES_SYNTAX_LANGUAGES ?? 'javascript,python,bash').split(',')
)
const httpBase = process.env.DOCS_SAMPLES_HTTP_BASE_URL
if (httpBase && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(httpBase).hostname))
  throw new Error('Only loopback documentation may supply sample fixtures')
const languages = ['bash', 'javascript', 'python', 'go', 'java', 'csharp'] as const
if ([...syntaxLanguages].some((language) => !languages.some((supported) => supported === language)))
  throw new Error('Unknown DOCS_SAMPLES_SYNTAX_LANGUAGES value')
const results: Array<{
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: string
}> = []
const fixtures: Array<{ name: string; operationId: string; files: Record<string, string> }> = []

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

async function check(name: string, action: () => Promise<void>) {
  const started = performance.now()
  try {
    await action()
    results.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
  } catch (error) {
    results.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: getErrorMessage(error),
    })
  }
}

async function readSampleMarkdown(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  assert(reader, 'Sample document has no body')
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > 1024 * 1024) {
        await reader.cancel()
        throw new Error('Sample document exceeded 1MiB')
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString('utf8')
}

function operation(operationId: string): OperationReference {
  for (const [specFile, document] of Object.entries(OPENAPI_DOCUMENTS_BY_FILE)) {
    for (const [path, rawPath] of Object.entries(toRecord(document.paths))) {
      const item = toRecord(rawPath)
      for (const [method, raw] of Object.entries(item)) {
        const found = toRecord(raw)
        if (found.operationId === operationId)
          return {
            specFile,
            path,
            method: method.toUpperCase(),
            operationId,
            operation: {
              ...found,
              parameters: [...toArray(item.parameters), ...toArray(found.parameters)],
            },
          }
      }
    }
  }
  throw new Error(`Missing sample operation ${operationId}`)
}

const quoted = 'space / "quote" \\ slash\nline & café'
const quotedReference = operation('createWorkflowV2')
quotedReference.path = '/api/v2/fixtures/{id}'
quotedReference.operation.parameters = [
  { name: 'id', in: 'path', required: true, example: quoted },
  { name: 'query', in: 'query', required: true, example: quoted },
]
quotedReference.operation.requestBody = {
  content: { 'application/json': { example: { text: quoted, enabled: true, empty: null } } },
}
const cases = [
  { name: 'json', reference: operation('createWorkflowV2') },
  { name: 'binary', reference: operation('downloadFile') },
  { name: 'multipart', reference: operation('uploadKnowledgeDocument') },
  { name: 'streaming', reference: operation('executeWorkflowV2') },
  { name: 'quoted', reference: quotedReference },
]
let activeCase = ''
let holdStream = false
let finishStream: (() => void) | undefined
const captured: Array<{ method?: string; url: string; body: string; contentType: string }> = []
const binary = new Uint8Array([0, 255, 254, 65, 128, 10])
const eventStream = 'data: {"ok":true}\n\n'
const server = createServer(async (request, response) => {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > 1024 * 1024) {
      response.writeHead(413).end()
      return
    }
    chunks.push(buffer)
  }
  captured.push({
    method: request.method,
    url: request.url ?? '/',
    body: Buffer.concat(chunks).toString(),
    contentType: request.headers['content-type'] ?? '',
  })
  response.setHeader(
    'Content-Type',
    activeCase === 'binary'
      ? 'application/octet-stream'
      : activeCase === 'streaming'
        ? 'text/event-stream'
        : 'application/json'
  )
  if (activeCase === 'streaming' && holdStream) {
    finishStream = () => response.end(eventStream)
    response.write(eventStream)
    return
  }
  response.end(
    activeCase === 'binary' ? binary : activeCase === 'streaming' ? eventStream : '{"ok":true}'
  )
})
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  document: unknown
) => Promise<unknown>

try {
  await mkdir(directory, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert(address && typeof address !== 'string', 'Missing loopback fixture address')
  for (const scenario of cases) {
    let samples = requestSamples(scenario.reference)
    if (httpBase && scenario.name !== 'quoted') {
      const tag = String(toArray(scenario.reference.operation.tags)[0])
        .replace(/\s+/g, '-')
        .toLowerCase()
      const response = await fetch(
        new URL(`/api-reference/${tag}/${scenario.reference.operationId}.md`, httpBase),
        { signal: AbortSignal.timeout(15000) }
      )
      assert(response.ok, `Sample Markdown returned ${response.status}`)
      const text = await readSampleMarkdown(response)
      samples = unified()
        .use(remarkParse)
        .parse(text)
        .children.flatMap((node) =>
          node.type === 'code' && languages.some((language) => language === node.lang)
            ? [{ label: node.lang ?? '', language: node.lang ?? '', code: node.value }]
            : []
        )
    }
    const files: Record<string, string> = {}
    await check(
      `${scenario.name}: all previously supported language examples are available`,
      async () => {
        for (const language of languages)
          assert(
            samples.some((sample) => sample.language === language),
            `Missing ${language} example`
          )
      }
    )
    for (const language of languages) {
      const sample = samples.find((sample) => sample.language === language)
      if (!sample) continue
      const folder = join(directory, scenario.name, language)
      await mkdir(folder, { recursive: true })
      const filename = {
        bash: 'request.sh',
        javascript: 'request.mjs',
        python: 'request.py',
        go: 'main.go',
        java: 'Example.java',
        csharp: 'Program.cs',
      }[language]
      const file = join(folder, filename)
      files[language] = file
      await writeFile(file, `${sample.code}\n`)
      if (language === 'csharp')
        await writeFile(
          join(folder, 'Example.csproj'),
          '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>\n'
        )
      if (!syntaxLanguages.has(language)) continue
      await check(`${scenario.name}: ${language} syntax`, async () => {
        if (language === 'javascript') {
          new AsyncFunction('fetch', 'document', sample.code)
          return
        }
        const command = {
          bash: ['bash', '-n', file],
          python: ['python3', '-m', 'py_compile', file],
          go: ['go', 'test', file],
          java: ['javac', file],
          csharp: [
            'dotnet',
            'build',
            join(folder, 'Example.csproj'),
            '--nologo',
            '--verbosity',
            'quiet',
          ],
        }[language]
        const result = spawnSync(command[0], command.slice(1), {
          encoding: 'utf8',
          timeout: 60000,
          maxBuffer: 1024 * 1024,
        })
        assert(
          result.status === 0,
          `${language} compilation failed: ${result.error?.message ?? (result.stderr || result.stdout)}`
        )
      })
      if (
        (scenario.name === 'streaming' || scenario.name === 'binary') &&
        (language === 'go' || language === 'java' || language === 'csharp')
      ) {
        await check(`${scenario.name}: ${language} live response bytes`, async () => {
          const runtimeFolder = join(folder, 'runtime')
          await mkdir(runtimeFolder, { recursive: true })
          const runtimeFile = join(runtimeFolder, filename)
          await writeFile(
            runtimeFile,
            sample.code.replaceAll('https://www.sim.ai', `http://127.0.0.1:${address.port}`)
          )
          if (language === 'csharp')
            await writeFile(
              join(runtimeFolder, 'Example.csproj'),
              '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>\n'
            )
          const compile = {
            go: ['go', 'build', '-o', join(runtimeFolder, 'example'), runtimeFile],
            java: ['javac', runtimeFile],
            csharp: [
              'dotnet',
              'build',
              join(runtimeFolder, 'Example.csproj'),
              '--nologo',
              '--verbosity',
              'quiet',
            ],
          }[language]
          const compiled = spawnSync(compile[0], compile.slice(1), {
            encoding: 'utf8',
            timeout: 60000,
            maxBuffer: 1024 * 1024,
          })
          assert(
            compiled.status === 0,
            `${language} runtime fixture failed to compile: ${compiled.error?.message ?? (compiled.stderr || compiled.stdout)}`
          )
          const command = {
            go: [join(runtimeFolder, 'example')],
            java: ['java', '-cp', runtimeFolder, 'Example'],
            csharp: ['dotnet', join(runtimeFolder, 'bin/Debug/net8.0/Example.dll')],
          }[language]
          activeCase = scenario.name
          holdStream = scenario.name === 'streaming'
          const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' })
          const reader = child.stdout.getReader()
          const deadline = setTimeout(() => child.kill(), 10000)
          const stderr = new Response(child.stderr).text()
          const chunks: Uint8Array[] = []
          let bytes = 0
          let earlyOutput = false
          try {
            while (true) {
              const next = await reader.read()
              if (next.done) break
              const chunk = next.value
              chunks.push(chunk)
              bytes += chunk.byteLength
              assert(bytes <= 65536, 'Native sample output exceeded 64KiB')
              if (holdStream && !earlyOutput && Buffer.concat(chunks).includes(eventStream)) {
                assert(finishStream, 'Output arrived before the fixture request')
                earlyOutput = true
                finishStream()
                finishStream = undefined
              }
            }
            const status = await child.exited
            assert(!holdStream || earlyOutput, 'No event reached stdout before stream completion')
            assert(status === 0, `${language} exited ${status}: ${await stderr}`)
            const expected = holdStream ? Buffer.from(eventStream.repeat(2)) : Buffer.from(binary)
            assert(Buffer.concat(chunks).equals(expected), 'Native response bytes changed')
          } finally {
            clearTimeout(deadline)
            reader.releaseLock()
            finishStream?.()
            finishStream = undefined
            holdStream = false
            child.kill()
            await child.exited
            await stderr
          }
        })
      }
    }
    fixtures.push({ name: scenario.name, operationId: scenario.reference.operationId, files })
    await check(
      `${scenario.name}: JavaScript request preserves bytes through real loopback HTTP`,
      async () => {
        activeCase = scenario.name
        captured.length = 0
        const sample = samples.find((sample) => sample.language === 'javascript')
        assert(sample, 'Missing JavaScript request')
        const fetcher = (input: RequestInfo | URL, init?: RequestInit) => {
          const destination = new URL(
            typeof input === 'string' || input instanceof URL ? input : input.url
          )
          assert(destination.origin === 'https://www.sim.ai', 'Unexpected sample request origin')
          return fetch(
            `http://127.0.0.1:${address.port}${destination.pathname}${destination.search}`,
            { ...init, signal: AbortSignal.timeout(5000) }
          )
        }
        const result = await new AsyncFunction(
          'fetch',
          'document',
          `${sample.code}\nreturn result;`
        )(fetcher, {
          querySelector: () => ({
            files: [new File(['fixture file'], 'document.pdf', { type: 'application/pdf' })],
          }),
        })
        const received = captured.at(-1)
        assert(received, 'No request reached the HTTP fixture')
        assert(received.method === scenario.reference.method, 'Request method changed')
        if (scenario.name === 'binary')
          assert(
            result instanceof ArrayBuffer && Buffer.from(result).equals(Buffer.from(binary)),
            'Binary response bytes changed'
          )
        else if (scenario.name === 'streaming')
          assert(
            result instanceof ReadableStream && (await new Response(result).text()) === eventStream,
            'Streaming response was not retained'
          )
        else assert(toRecord(result).ok === true, 'JSON response was not decoded')
        if (scenario.name === 'quoted') {
          const url = new URL(received.url, 'http://fixture')
          assert(
            decodeURIComponent(url.pathname.split('/').at(-1) ?? '') === quoted &&
              url.searchParams.get('query') === quoted,
            'Path or query escaping changed'
          )
          assert(JSON.parse(received.body).text === quoted, 'JSON request body changed')
        }
        if (scenario.name === 'multipart')
          assert(
            received.contentType.startsWith('multipart/form-data; boundary=') &&
              received.body.includes('fixture file'),
            'Multipart boundary or file bytes missing'
          )
      }
    )
  }
} catch (error) {
  results.push({
    name: 'Sample fixture lifecycle',
    status: 'failed',
    durationMs: 0,
    error: getErrorMessage(error),
  })
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(
    reportPath,
    `${JSON.stringify({ source: httpBase ?? 'current generator', syntaxLanguages: [...syntaxLanguages], notSyntaxVerified: languages.filter((language) => !syntaxLanguages.has(language)), fixtures, results }, null, 2)}\n`
  )
}
const failed = results.filter((result) => result.status === 'failed')
logger.info('API example verification complete', {
  checks: results.length,
  failed: failed.length,
  reportPath,
})
if (failed.length) process.exitCode = 1
