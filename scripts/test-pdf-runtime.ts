import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'

/**
 * Builds the actual shared PDF parser into a small Next standalone server, then
 * runs that artifact without the repository in the production Linux Bun image.
 * Requires Docker; uses only a generated PDF and no service credentials.
 */
const repositoryRoot = path.resolve(import.meta.dirname, '..')
const appRoot = path.join(repositoryRoot, 'apps/sim')
const appPackage: { dependencies: Record<string, string> } = JSON.parse(
  await readFile(path.join(appRoot, 'package.json'), 'utf8')
)
const appConfig = (await import(path.join(appRoot, 'next.config.ts'))).default
const appDockerfile = await readFile(path.join(repositoryRoot, 'docker/app.Dockerfile'), 'utf8')
const runtimeImage = appDockerfile.match(/^FROM (oven\/bun:[^ ]+) AS base$/m)?.[1]
assert.ok(runtimeImage, 'The smoke test must use the production Bun image')
assert.ok(Bun.which('docker'), 'Docker is required for the Linux PDF runtime smoke test')
assert.ok(appConfig.serverExternalPackages.includes('@napi-rs/canvas'))
assert.ok(appConfig.serverExternalPackages.includes('pdfjs-dist'))
assert.ok(appDockerfile.includes('/app/node_modules/@napi-rs ./node_modules/@napi-rs'))

const scratch = await mkdtemp(path.join(tmpdir(), 'sim-pdf-runtime-'))
const fixture = await mkdtemp(path.join(repositoryRoot, '.pdf-runtime-'))
const containerName = path.basename(scratch)

async function run(command: string[], cwd: string, env?: Record<string, string>) {
  const child = Bun.spawn(command, {
    cwd,
    env: env ?? process.env,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const timer = setTimeout(() => child.kill('SIGKILL'), 180_000)
  try {
    assert.equal(await child.exited, 0, `${command[0]} failed`)
  } finally {
    clearTimeout(timer)
  }
}

try {
  await mkdir(path.join(fixture, 'app/api/pdf'), { recursive: true })
  await symlink(path.join(repositoryRoot, 'node_modules'), path.join(fixture, 'node_modules'))
  await writeFile(
    path.join(fixture, 'package.json'),
    JSON.stringify({
      name: 'sim-pdf-runtime-smoke',
      private: true,
      dependencies: Object.fromEntries(
        ['next', 'react', 'react-dom', 'pdfjs-dist', '@napi-rs/canvas'].map((name) => [
          name,
          appPackage.dependencies[name],
        ])
      ),
    })
  )
  await writeFile(
    path.join(fixture, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'esnext',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        paths: { '@/*': [path.join(path.relative(fixture, appRoot), '*')] },
      },
    })
  )
  await writeFile(
    path.join(fixture, 'next.config.mjs'),
    `export default ${JSON.stringify({
      output: 'standalone',
      outputFileTracingRoot: repositoryRoot,
      turbopack: { root: repositoryRoot },
      serverExternalPackages: appConfig.serverExternalPackages,
      typescript: { ignoreBuildErrors: true },
      experimental: { cpus: 1 },
    })}`
  )
  await writeFile(
    path.join(fixture, 'app/layout.tsx'),
    'export default function Layout({children}) { return <html><body>{children}</body></html> }'
  )
  await writeFile(
    path.join(fixture, 'app/api/pdf/route.ts'),
    `
import { PdfParser } from '@/lib/file-parsers/pdf-parser'
import { countMistralPdfPages } from '@/lib/internal/mistral/page-count'
export async function POST(request: Request) {
  const data = Buffer.from(await request.arrayBuffer())
  const parser = new PdfParser()
  const [preview, complete, pageCount] = await Promise.all([
    parser.parseBuffer(data),
    parser.parseBuffer(data, { pdfTextMode: 'complete' }),
    countMistralPdfPages(data),
  ])
  return Response.json({
    pageCount,
    preview: { pages: preview.metadata?.pageCount, truncated: preview.metadata?.truncated, completeText: preview.content.includes('Final smoke page') },
    complete: { pages: complete.metadata?.pageCount, truncated: complete.metadata?.truncated, completeText: complete.content.includes('Final smoke page') },
  })
}`
  )
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (const text of ['PDF runtime smoke', 'Middle smoke page', 'Final smoke page']) {
    pdf.addPage().drawText(text, { font, x: 40, y: 500 })
  }
  await writeFile(path.join(scratch, 'fixture.pdf'), await pdf.save())
  const buildEnv = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    NEXT_TELEMETRY_DISABLED: '1',
    NODE_ENV: 'production',
    NODE_OPTIONS: '--max-old-space-size=2048',
  }
  await run(
    [
      process.execPath,
      '--bun',
      path.join(repositoryRoot, 'node_modules/next/dist/bin/next'),
      'build',
      fixture,
    ],
    fixture,
    buildEnv
  )
  await cp(path.join(fixture, '.next/standalone'), path.join(scratch, 'standalone'), {
    recursive: true,
    verbatimSymlinks: true,
  })
  await writeFile(
    path.join(scratch, 'package.json'),
    JSON.stringify({
      private: true,
      dependencies: { '@napi-rs/canvas': appPackage.dependencies['@napi-rs/canvas'] },
    })
  )
  const serverPath = `/runtime/standalone/${path.basename(fixture)}/server.js`
  await writeFile(
    path.join(scratch, 'verify.ts'),
    `
import assert from 'node:assert/strict'
import { cp } from 'node:fs/promises'
await cp('/runtime/node_modules/@napi-rs', '/runtime/standalone/node_modules/@napi-rs', { recursive: true })
const server = Bun.spawn(['bun', ${JSON.stringify(serverPath)}], {
  env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: '3187', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
  stdout: 'inherit', stderr: 'inherit',
})
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await fetch('http://127.0.0.1:3187'); break } catch { await Bun.sleep(100) }
  }
  const expected = { pageCount: 3, preview: { pages: 3, truncated: false, completeText: true }, complete: { pages: 3, truncated: false, completeText: true } }
  for (let wave = 0; wave < 2; wave++) {
    await Promise.all(Array.from({ length: 3 }, async () => {
      const response = await fetch('http://127.0.0.1:3187/api/pdf', { method: 'POST', body: Bun.file('/runtime/fixture.pdf') })
      assert.equal(response.status, 200, await response.clone().text())
      assert.deepEqual(await response.json(), expected)
    }))
  }
  process.stdout.write('Linux Bun standalone: 6 requests, 18 PDF operations passed (preview, complete KB text, Mistral page count).\\n')
} finally { server.kill(); await server.exited }
`
  )
  await run(
    [
      'docker',
      'run',
      '--rm',
      '--name',
      `${containerName}-install`,
      '--memory',
      '512m',
      '--cpus',
      '1',
      '-v',
      `${scratch}:/runtime`,
      '-w',
      '/runtime',
      runtimeImage,
      'bun',
      'install',
      '--ignore-scripts',
      '--production',
    ],
    scratch
  )
  await run(
    [
      'docker',
      'run',
      '--rm',
      '--name',
      containerName,
      '--network',
      'none',
      '--memory',
      '768m',
      '--cpus',
      '2',
      '-v',
      `${scratch}:/runtime`,
      '-w',
      '/runtime',
      runtimeImage,
      'bun',
      'verify.ts',
    ],
    scratch
  )
} finally {
  for (const name of [containerName, `${containerName}-install`]) {
    const cleanup = Bun.spawn(['docker', 'rm', '-f', name], { stdout: 'ignore', stderr: 'ignore' })
    await cleanup.exited
  }
  await rm(fixture, { recursive: true, force: true })
  await rm(scratch, { recursive: true, force: true })
}
