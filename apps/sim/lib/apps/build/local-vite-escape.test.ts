import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getLocalToolchainPaths } from '@/lib/apps/build/local-toolchain'
import { platformViteConfig, prepareTrustedSourceTree } from '@/lib/apps/build/prepare-source'

function runVite(workRoot: string, viteCli: string, tmpDir: string): Promise<{
  code: number | null
  stderr: string
  stdout: string
}> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [viteCli, 'build', '--config', 'vite.config.mjs'], {
      cwd: workRoot,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: tmpDir,
        TMP: tmpDir,
        TEMP: tmpDir,
        XDG_CACHE_HOME: join(workRoot, '.cache'),
        NODE_ENV: 'production',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    let stdout = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.on('close', (code) => resolvePromise({ code, stderr, stdout }))
    child.on('error', (error) => resolvePromise({ code: 1, stderr: error.message, stdout: '' }))
  })
}

const sampleAction = {
  actionId: 'main',
  workflowId: 'wf',
  deploymentVersionId: 'dv',
  inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
  outputAllowlist: [] as [],
  executionPolicy: 'sync' as const,
  schemaHash: 'x',
}

describe('local Vite import escape integration', () => {
  it(
    'fails the build when user source imports a host file via relative ?raw',
    async () => {
      const prepared = prepareTrustedSourceTree({
        revisionFiles: {
          'src/App.tsx': `import secrets from '../../../../package.json?raw'
export function App() { return <pre>{String(secrets)}</pre> }
`,
        },
        actions: [sampleAction],
      })
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) return

      const toolchain = getLocalToolchainPaths()
      const workRoot = await mkdtemp(join(tmpdir(), 'sim-vite-escape-'))
      const tmpDir = join(workRoot, '.tmp')
      await mkdir(tmpDir, { recursive: true })

      for (const [path, content] of Object.entries(prepared.files)) {
        const full = join(workRoot, path)
        await mkdir(dirname(full), { recursive: true })
        await writeFile(full, content, 'utf8')
      }

      const appSdkDir = join(workRoot, 'vendor/app-sdk')
      await mkdir(appSdkDir, { recursive: true })
      await cp(toolchain.appSdkSrc, appSdkDir, { recursive: true })
      await writeFile(
        join(workRoot, 'vite.config.mjs'),
        platformViteConfig({
          projectRoot: workRoot,
          appSdkEntry: join(appSdkDir, 'index.ts'),
          appSdkDir,
          reactDir: toolchain.reactDir,
          reactDomDir: toolchain.reactDomDir,
          schedulerDir: toolchain.schedulerDir,
          viteEntry: toolchain.viteEntry,
          viteReactPlugin: toolchain.viteReactPlugin,
        }),
        'utf8'
      )

      try {
        const { code, stderr, stdout } = await runVite(workRoot, toolchain.viteCli, tmpDir)
        expect(code).not.toBe(0)
        expect(`${stderr}\n${stdout}`).toMatch(/escapes build sandbox|Disallowed import/i)
      } finally {
        await rm(workRoot, { recursive: true, force: true }).catch(() => undefined)
      }
    },
    90_000
  )
})

describe('local Vite success path', () => {
  it(
    'builds the default template to index.html + js + css',
    async () => {
      if (!process.env.APPS_ARTIFACT_ROOT) {
        // Persist requires an explicit root; success path still validates dist shape in-process.
      }
      const prepared = prepareTrustedSourceTree({
        revisionFiles: {},
        actions: [sampleAction],
      })
      expect(prepared.ok).toBe(true)
      if (!prepared.ok) return

      const toolchain = getLocalToolchainPaths()
      const workRoot = await mkdtemp(join(tmpdir(), 'sim-vite-ok-'))
      const tmpDir = join(workRoot, '.tmp')
      await mkdir(tmpDir, { recursive: true })

      for (const [path, content] of Object.entries(prepared.files)) {
        const full = join(workRoot, path)
        await mkdir(dirname(full), { recursive: true })
        await writeFile(full, content, 'utf8')
      }

      const appSdkDir = join(workRoot, 'vendor/app-sdk')
      await mkdir(appSdkDir, { recursive: true })
      await cp(toolchain.appSdkSrc, appSdkDir, { recursive: true })
      await writeFile(
        join(workRoot, 'vite.config.mjs'),
        platformViteConfig({
          projectRoot: workRoot,
          appSdkEntry: join(appSdkDir, 'index.ts'),
          appSdkDir,
          reactDir: toolchain.reactDir,
          reactDomDir: toolchain.reactDomDir,
          schedulerDir: toolchain.schedulerDir,
          viteEntry: toolchain.viteEntry,
          viteReactPlugin: toolchain.viteReactPlugin,
        }),
        'utf8'
      )

      try {
        const { code, stderr } = await runVite(workRoot, toolchain.viteCli, tmpDir)
        expect(code, stderr).toBe(0)

        const { readdir } = await import('node:fs/promises')
        const distFiles: string[] = []
        async function walk(dir: string, base = dir) {
          for (const entry of await readdir(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name)
            if (entry.isDirectory()) await walk(full, base)
            else distFiles.push(full.slice(base.length + 1).split('\\').join('/'))
          }
        }
        await walk(join(workRoot, 'dist'))

        expect(distFiles).toContain('index.html')
        expect(distFiles.some((f) => f.endsWith('.js'))).toBe(true)
        expect(distFiles.some((f) => f.endsWith('.css'))).toBe(true)
        // Guardrail note: Rolldown may still bundle transitive CJS (scheduler) without
        // passing JS resolveId hooks — local-vite remains unpublishable in production.
        expect(distFiles.every((f) => !f.endsWith('.map'))).toBe(true)
      } finally {
        await rm(workRoot, { recursive: true, force: true }).catch(() => undefined)
      }
    },
    90_000
  )
})
