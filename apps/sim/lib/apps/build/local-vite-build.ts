import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { createLogger } from '@sim/logger'
import { buildArtifactManifest } from '@/lib/apps/artifacts/manifest'
import { persistArtifactBundle, requireAppsArtifactRoot } from '@/lib/apps/artifacts/store'
import type { AppActionManifestEntry } from '@/lib/apps/manifest'
import {
  currentLocalViteBuildIdentity,
  getLocalToolchainPaths,
} from '@/lib/apps/build/local-toolchain'
import {
  platformViteConfig,
  prepareTrustedSourceTree,
} from '@/lib/apps/build/prepare-source'
import type { AppBuildRequest, AppBuildResult } from '@/lib/apps/build/types'
import { isProd } from '@/lib/core/config/env-flags'

const logger = createLogger('LocalViteAppBuild')

/** Generous ceiling for template Vite builds. */
export const LOCAL_VITE_BUILD_TIMEOUT_MS = 5 * 60 * 1000

async function walkFiles(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const out: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(full, base)))
    } else if (entry.isFile()) {
      out.push(relative(base, full).split('\\').join('/'))
    }
  }
  return out
}

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, content, 'utf8')
  }
}

function runViteBuild(params: {
  workRoot: string
  viteCli: string
  tmpDir: string
}): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [params.viteCli, 'build', '--config', 'vite.config.mjs'], {
      cwd: params.workRoot,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        // Keep Vite/config loader temps inside the work root — never host node_modules.
        TMPDIR: params.tmpDir,
        TMP: params.tmpDir,
        TEMP: params.tmpDir,
        XDG_CACHE_HOME: join(params.workRoot, '.cache'),
        NODE_ENV: 'production',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, LOCAL_VITE_BUILD_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolvePromise({
        code: 1,
        stdout,
        stderr: stderr || error.message,
        timedOut,
      })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ code, stdout, stderr, timedOut })
    })
  })
}

/**
 * Dev/staging build: trusted source tree + monorepo Vite/React, no npm install.
 * Enabled only when APPS_ALLOW_LOCAL_VITE_BUILDS=true. Never enable on bundled prod.
 */
export async function runLocalViteBuild(
  request: AppBuildRequest & { actions: AppActionManifestEntry[] }
): Promise<AppBuildResult> {
  if (isProd) {
    return {
      success: false,
      error:
        'Local Vite builds are disabled in production. Use the E2B app-build image when available.',
      diagnostics: { mode: 'local-vite-blocked-prod' },
    }
  }

  try {
    requireAppsArtifactRoot()
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'APPS_ARTIFACT_ROOT is required',
      diagnostics: { mode: 'local-vite' },
    }
  }

  const prepared = prepareTrustedSourceTree({
    revisionFiles: request.files,
    actions: request.actions,
  })
  if (!prepared.ok) {
    return { success: false, error: prepared.error, diagnostics: { mode: 'local-vite' } }
  }

  const toolchain = getLocalToolchainPaths()
  const workRoot = await mkdtemp(join(tmpdir(), 'sim-app-build-'))
  const tmpDir = join(workRoot, '.tmp')
  try {
    await mkdir(tmpDir, { recursive: true })
    await writeTree(workRoot, prepared.files)

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

    const { code, stdout, stderr, timedOut } = await runViteBuild({
      workRoot,
      viteCli: toolchain.viteCli,
      tmpDir,
    })

    if (timedOut) {
      return {
        success: false,
        error: `Vite build timed out after ${LOCAL_VITE_BUILD_TIMEOUT_MS}ms`,
        diagnostics: { mode: 'local-vite', timedOut: true },
      }
    }

    if (code !== 0) {
      logger.warn('Local Vite build failed', { code, stderr: stderr.slice(0, 2000) })
      return {
        success: false,
        error: 'Vite build failed',
        diagnostics: {
          mode: 'local-vite',
          exitCode: code,
          stderr: stderr.slice(0, 4000),
          stdout: stdout.slice(0, 2000),
        },
      }
    }

    const distDir = join(workRoot, 'dist')
    const relPaths = await walkFiles(distDir)
    const buffers: Array<{ path: string; content: Buffer }> = []
    for (const rel of relPaths) {
      const content = await readFile(join(distDir, rel))
      buffers.push({ path: rel, content })
    }

    const built = buildArtifactManifest(buffers)
    if (!built.ok) {
      return { success: false, error: built.error, diagnostics: { mode: 'local-vite' } }
    }

    const persistFiles = built.manifest.files.map((f) => {
      const content = buffers.find((b) => b.path === f.path)!.content
      return {
        path: f.path,
        content,
        hash: f.hash,
        contentType: f.contentType,
        byteSize: f.byteSize,
      }
    })

    const persisted = await persistArtifactBundle({
      manifest: built.manifest,
      manifestHash: built.manifestHash,
      files: persistFiles,
    })
    if (!persisted.ok) {
      return { success: false, error: persisted.error, diagnostics: { mode: 'local-vite' } }
    }

    const identity = currentLocalViteBuildIdentity(toolchain.monorepoRoot)

    return {
      success: true,
      artifactManifestHash: built.manifestHash,
      buildImageDigest: identity.buildImageDigest,
      diagnostics: {
        mode: identity.mode,
        fileCount: built.manifest.files.length,
        manifestHash: built.manifestHash,
        templateVersion: identity.templateVersion,
        sdkVersion: identity.sdkVersion,
        lockfileHash: identity.lockfileHash,
        /** Guardrails only — Rolldown may still resolve transitive CJS deps. */
        importPlugins: 'esm-guardrails',
      },
    }
  } catch (error) {
    logger.error('Local Vite build threw', { error })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Local Vite build failed',
      diagnostics: { mode: 'local-vite' },
    }
  } finally {
    await rm(workRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}
