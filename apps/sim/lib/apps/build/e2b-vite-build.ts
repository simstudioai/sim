import type { Sandbox as E2BSandbox } from '@e2b/code-interpreter'
import { createLogger } from '@sim/logger'
import { assertSafeArtifactPath, buildArtifactManifest } from '@/lib/apps/artifacts/manifest'
import { persistArtifactBundle, requireAppsArtifactRoot } from '@/lib/apps/artifacts/store'
import { currentE2BBuildIdentity } from '@/lib/apps/build/build-identity'
import { platformViteConfig, prepareTrustedSourceTree } from '@/lib/apps/build/prepare-source'
import type { AppBuildRequest, AppBuildResult } from '@/lib/apps/build/types'
import { env, getEnv } from '@/lib/core/config/env'

const logger = createLogger('E2BViteAppBuild')

const APP_ROOT = '/home/user/app'
const TMP_ROOT = '/home/user/tmp'
const ARTIFACT_EXPORT_PATH = '/home/user/artifacts.json'
const TOOLCHAIN_ROOT = '/opt/sim-app'
const BUILD_TIMEOUT_MS = 5 * 60 * 1000
const SANDBOX_TIMEOUT_MS = BUILD_TIMEOUT_MS + 60_000
const MAX_EXPORT_JSON_BYTES = 30_000_000
const MAX_EXPORTED_FILES = 500
const MAX_EXPORTED_FILE_BYTES = 5_000_000
const MAX_EXPORTED_TOTAL_BYTES = 20_000_000

type ExportedArtifactPayload = {
  version: 1
  fileCount: number
  totalBytes: number
  files: Array<{ path: string; contentBase64: string }>
}

type E2BCommandResult = {
  stdout: string
  stderr: string
  exitCode: number
}

export type E2BAppSandbox = Pick<E2BSandbox, 'sandboxId' | 'files' | 'commands' | 'kill'>

export function decodeE2BArtifactExport(
  raw: string
): { ok: true; files: Array<{ path: string; content: Buffer }> } | { ok: false; error: string } {
  if (Buffer.byteLength(raw, 'utf8') > MAX_EXPORT_JSON_BYTES) {
    return { ok: false, error: 'E2B artifact export exceeds transport size cap' }
  }

  let payload: ExportedArtifactPayload
  try {
    payload = JSON.parse(raw) as ExportedArtifactPayload
  } catch {
    return { ok: false, error: 'E2B artifact export is not valid JSON' }
  }

  if (
    payload?.version !== 1 ||
    !Array.isArray(payload.files) ||
    payload.files.length === 0 ||
    payload.files.length > MAX_EXPORTED_FILES ||
    payload.fileCount !== payload.files.length
  ) {
    return { ok: false, error: 'E2B artifact export metadata is invalid' }
  }

  const seen = new Set<string>()
  const files: Array<{ path: string; content: Buffer }> = []
  let totalBytes = 0
  for (const entry of payload.files) {
    if (
      !entry ||
      typeof entry.path !== 'string' ||
      typeof entry.contentBase64 !== 'string' ||
      seen.has(entry.path) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.contentBase64)
    ) {
      return { ok: false, error: 'E2B artifact export contains an invalid file entry' }
    }
    const pathError = assertSafeArtifactPath(entry.path)
    if (pathError) {
      return { ok: false, error: `E2B artifact export path rejected: ${entry.path}` }
    }
    seen.add(entry.path)

    const content = Buffer.from(entry.contentBase64, 'base64')
    if (content.toString('base64') !== entry.contentBase64) {
      return { ok: false, error: `E2B artifact export has invalid base64 for ${entry.path}` }
    }
    if (content.byteLength > MAX_EXPORTED_FILE_BYTES) {
      return { ok: false, error: `E2B artifact file exceeds size cap: ${entry.path}` }
    }
    totalBytes += content.byteLength
    if (totalBytes > MAX_EXPORTED_TOTAL_BYTES) {
      return { ok: false, error: 'E2B artifact export exceeds total size cap' }
    }
    files.push({ path: entry.path, content })
  }

  if (payload.totalBytes !== totalBytes) {
    return { ok: false, error: 'E2B artifact export byte count does not match payload' }
  }
  return { ok: true, files }
}

async function createSandbox(): Promise<E2BAppSandbox> {
  const apiKey = env.E2B_API_KEY
  const templateId = (getEnv('E2B_APP_BUILD_TEMPLATE_ID') || '').trim()
  if (!apiKey) throw new Error('E2B_API_KEY is required for app builds')
  if (!templateId) throw new Error('E2B_APP_BUILD_TEMPLATE_ID is required for app builds')

  const { Sandbox } = await import('@e2b/code-interpreter')
  return Sandbox.create(templateId, {
    apiKey,
    timeoutMs: SANDBOX_TIMEOUT_MS,
    allowInternetAccess: false,
    metadata: { workload: 'sim-app-build' },
  })
}

async function writeSandboxTree(sandbox: E2BAppSandbox, files: Record<string, string>) {
  await sandbox.files.makeDir(TMP_ROOT)
  await sandbox.files.write(
    Object.entries(files).map(([path, data]) => ({
      path: `${APP_ROOT}/${path}`,
      data,
    }))
  )
}

async function runCommand(
  sandbox: E2BAppSandbox,
  command: string,
  timeoutMs: number
): Promise<E2BCommandResult> {
  try {
    return await sandbox.commands.run(command, {
      timeoutMs,
      envs: {
        HOME: '/home/user',
        TMPDIR: TMP_ROOT,
        TMP: TMP_ROOT,
        TEMP: TMP_ROOT,
        XDG_CACHE_HOME: `${APP_ROOT}/.cache`,
        NODE_ENV: 'production',
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      },
    })
  } catch (error) {
    const failure = error as {
      stdout?: string
      stderr?: string
      message?: string
      exitCode?: number
    }
    return {
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? failure.message ?? String(error),
      exitCode: failure.exitCode ?? 1,
    }
  }
}

export async function runE2BViteBuild(
  request: AppBuildRequest,
  deps?: { createSandbox?: () => Promise<E2BAppSandbox> }
): Promise<AppBuildResult> {
  try {
    requireAppsArtifactRoot()
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'APPS_ARTIFACT_ROOT is required',
      diagnostics: { mode: 'e2b' },
    }
  }

  const imageDigest = (getEnv('E2B_APP_BUILD_IMAGE_DIGEST') || '').trim()
  const templateId = (getEnv('E2B_APP_BUILD_TEMPLATE_ID') || '').trim()
  if (!templateId.includes(':') || !imageDigest.startsWith('e2b-build:')) {
    return {
      success: false,
      error:
        'E2B app builds require a tagged E2B_APP_BUILD_TEMPLATE_ID and the e2b-build:<buildId> digest emitted by the template build.',
      diagnostics: { mode: 'e2b' },
    }
  }

  const prepared = prepareTrustedSourceTree({
    revisionFiles: request.files,
    actions: request.actions,
  })
  if (!prepared.ok) {
    return { success: false, error: prepared.error, diagnostics: { mode: 'e2b' } }
  }

  let sandbox: E2BAppSandbox | undefined
  try {
    sandbox = await (deps?.createSandbox ?? createSandbox)()
    await writeSandboxTree(sandbox, prepared.files)

    const viteConfig = platformViteConfig({
      projectRoot: APP_ROOT,
      appSdkEntry: `${TOOLCHAIN_ROOT}/vendor/app-sdk/index.ts`,
      appSdkDir: `${TOOLCHAIN_ROOT}/vendor/app-sdk`,
      reactDir: `${TOOLCHAIN_ROOT}/node_modules/react`,
      reactDomDir: `${TOOLCHAIN_ROOT}/node_modules/react-dom`,
      schedulerDir: `${TOOLCHAIN_ROOT}/node_modules/scheduler`,
      viteEntry: `${TOOLCHAIN_ROOT}/node_modules/vite/dist/node/index.js`,
      viteReactPlugin: `${TOOLCHAIN_ROOT}/node_modules/@vitejs/plugin-react/dist/index.js`,
    })
    await sandbox.files.write(`${APP_ROOT}/vite.config.mjs`, viteConfig)

    const buildResult = await runCommand(
      sandbox,
      `cd ${APP_ROOT} && node ${TOOLCHAIN_ROOT}/node_modules/vite/bin/vite.js build --config ${APP_ROOT}/vite.config.mjs --configLoader runner`,
      BUILD_TIMEOUT_MS
    )
    if (buildResult.exitCode !== 0) {
      return {
        success: false,
        error: 'E2B Vite build failed',
        diagnostics: {
          mode: 'e2b',
          exitCode: buildResult.exitCode,
          stderr: buildResult.stderr.slice(0, 4000),
          stdout: buildResult.stdout.slice(0, 2000),
        },
      }
    }

    const collectResult = await runCommand(
      sandbox,
      `node ${TOOLCHAIN_ROOT}/collect-artifacts.mjs ${APP_ROOT}/dist ${ARTIFACT_EXPORT_PATH}`,
      30_000
    )
    if (collectResult.exitCode !== 0) {
      return {
        success: false,
        error: 'E2B artifact collection failed',
        diagnostics: {
          mode: 'e2b',
          exitCode: collectResult.exitCode,
          stderr: collectResult.stderr.slice(0, 4000),
        },
      }
    }

    const rawExport = await sandbox.files.read(ARTIFACT_EXPORT_PATH)
    const decoded = decodeE2BArtifactExport(rawExport)
    if (!decoded.ok) {
      return { success: false, error: decoded.error, diagnostics: { mode: 'e2b' } }
    }

    const built = buildArtifactManifest(decoded.files)
    if (!built.ok) {
      return { success: false, error: built.error, diagnostics: { mode: 'e2b' } }
    }
    const persistFiles = built.manifest.files.map((entry) => {
      const content = decoded.files.find((file) => file.path === entry.path)?.content
      if (!content) throw new Error(`Artifact content missing for ${entry.path}`)
      return {
        path: entry.path,
        content,
        hash: entry.hash,
        contentType: entry.contentType,
        byteSize: entry.byteSize,
      }
    })
    const persisted = await persistArtifactBundle({
      manifest: built.manifest,
      manifestHash: built.manifestHash,
      files: persistFiles,
    })
    if (!persisted.ok) {
      return { success: false, error: persisted.error, diagnostics: { mode: 'e2b' } }
    }

    const identity = currentE2BBuildIdentity(imageDigest)
    return {
      success: true,
      artifactManifestHash: built.manifestHash,
      buildImageDigest: imageDigest,
      diagnostics: {
        ...identity,
        buildImageDigest: imageDigest,
        fileCount: built.manifest.files.length,
        manifestHash: built.manifestHash,
        sandboxId: sandbox.sandboxId,
      },
    }
  } catch (error) {
    logger.error('E2B App build failed', { error, projectId: request.projectId })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'E2B App build failed',
      diagnostics: { mode: 'e2b' },
    }
  } finally {
    if (sandbox) {
      await sandbox.kill().catch(() => undefined)
    }
  }
}
