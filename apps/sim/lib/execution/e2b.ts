import type { Sandbox as E2BSandbox } from '@e2b/code-interpreter'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import { CodeLanguage } from '@/lib/execution/languages'

/**
 * A sandbox input file. `content` entries are written inline; `url` entries are fetched from inside
 * the sandbox (so large mounts never pass their bytes through the web process).
 */
export type SandboxFile =
  | { type?: 'content'; path: string; content: string; encoding?: 'base64' }
  | { type: 'url'; path: string; url: string }

export interface E2BExecutionRequest {
  code: string
  language: CodeLanguage
  timeoutMs: number
  sandboxFiles?: SandboxFile[]
  outputSandboxPath?: string
  outputSandboxPaths?: string[]
  // Which sandbox template to run in. Defaults to 'code' (mothership-shell).
  // Document generation passes 'doc' so it runs in the doc template
  // (mothership-docs) that has python-pptx/docx/openpyxl/reportlab installed.
  sandboxKind?: 'code' | 'doc'
}

export interface E2BShellExecutionRequest {
  code: string
  envs: Record<string, string>
  timeoutMs: number
  sandboxFiles?: SandboxFile[]
  outputSandboxPath?: string
  outputSandboxPaths?: string[]
  // Which sandbox template to run in. Defaults to 'shell' (mothership-shell).
  // The Node document engines (pptxgenjs/docx + react-icons/sharp) pass 'doc' so
  // they run in the doc template (mothership-docs).
  sandboxKind?: 'shell' | 'doc'
}

export interface E2BExecutionResult {
  result: unknown
  stdout: string
  sandboxId?: string
  error?: string
  exportedFileContent?: string
  exportedFiles?: Record<string, string>
  /** Base64-encoded PNG images captured from rich outputs (e.g. matplotlib figures). */
  images?: string[]
}

const logger = createLogger('E2BExecution')

/**
 * Materializes sandbox input files before user code runs. `content` entries are written inline;
 * `url` entries are fetched from inside the sandbox via `curl` — their bytes never pass through the
 * web process, so the mount size is bounded by sandbox disk, not web heap. The URL and paths are
 * passed as env vars (never interpolated into the shell) so a presigned query string can't break or
 * inject. A failed fetch throws so user code never runs against a missing mount. `rootUser` matches
 * the shell sandbox's root execution context.
 */
async function writeSandboxInputs(
  sandbox: E2BSandbox,
  files: SandboxFile[] | undefined,
  opts: { sandboxId?: string; rootUser?: boolean }
): Promise<void> {
  if (!files?.length) return
  const fetchedByUrl: string[] = []
  const writtenInline: string[] = []
  for (const file of files) {
    if (file.type === 'url') {
      const dir = file.path.slice(0, file.path.lastIndexOf('/'))
      try {
        await sandbox.commands.run(
          'set -e; [ -n "$DIR" ] && mkdir -p "$DIR"; curl -fsS --retry 3 --retry-connrefused --max-time 300 "$URL" -o "$DST"',
          {
            envs: { URL: file.url, DST: file.path, DIR: dir },
            ...(opts.rootUser ? { user: 'root' } : {}),
          }
        )
        fetchedByUrl.push(file.path)
      } catch (error) {
        throw new Error(
          `Failed to fetch mounted file into sandbox at ${file.path}: ${getErrorMessage(error)}`
        )
      }
    } else if (file.encoding === 'base64') {
      const buf = Buffer.from(file.content, 'base64')
      await sandbox.files.write(
        file.path,
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      )
      writtenInline.push(file.path)
    } else {
      await sandbox.files.write(file.path, file.content)
      writtenInline.push(file.path)
    }
  }
  // Split counts so it's visible whether a mount was fetched in-sandbox (by presigned URL, no bytes
  // through the web process) or written inline.
  logger.info('Materialized sandbox inputs', {
    sandboxId: opts.sandboxId,
    fetchedByUrlCount: fetchedByUrl.length,
    writtenInlineCount: writtenInline.length,
    fetchedByUrl,
    writtenInline,
  })
}

async function createE2BSandbox(kind: 'code' | 'shell' | 'doc' | 'pi'): Promise<E2BSandbox> {
  const apiKey = env.E2B_API_KEY
  if (!apiKey) {
    throw new Error('E2B_API_KEY is required when E2B is enabled')
  }

  // Document generation uses a dedicated template (python-pptx/docx/openpyxl/
  // reportlab + fonts); shell/code execution use the general shell template.
  // Doc fails closed: never run LLM-authored Python in E2B's default template
  // (which is not vetted for this) just because the doc template id is unset.
  if (kind === 'doc' && !env.MOTHERSHIP_E2B_DOC_TEMPLATE_ID) {
    throw new Error('Document compiler not configured (MOTHERSHIP_E2B_DOC_TEMPLATE_ID is unset)')
  }
  // Pi fails closed for the same reason: the coding agent needs the Pi CLI + git
  // baked into a vetted template, never E2B's default image.
  if (kind === 'pi' && !env.E2B_PI_TEMPLATE_ID) {
    throw new Error('Pi cloud agent not configured (E2B_PI_TEMPLATE_ID is unset)')
  }

  const templateName =
    kind === 'doc'
      ? env.MOTHERSHIP_E2B_DOC_TEMPLATE_ID
      : kind === 'pi'
        ? env.E2B_PI_TEMPLATE_ID
        : env.MOTHERSHIP_E2B_TEMPLATE_ID
  logger.info('Creating E2B sandbox', {
    kind,
    template: templateName || '(default)',
  })
  const { Sandbox } = await import('@e2b/code-interpreter')
  return templateName ? Sandbox.create(templateName, { apiKey }) : Sandbox.create({ apiKey })
}

function shouldReadSandboxPathAsBase64(outputSandboxPath: string): boolean {
  const ext = outputSandboxPath.slice(outputSandboxPath.lastIndexOf('.')).toLowerCase()
  const binaryExts = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.pdf',
    '.zip',
    '.mp3',
    '.mp4',
    '.docx',
    '.pptx',
    '.xlsx',
  ])
  return binaryExts.has(ext)
}

async function readSandboxOutputFile(
  sandbox: E2BSandbox,
  outputSandboxPath: string,
  options?: { user?: string }
): Promise<string | undefined> {
  try {
    if (shouldReadSandboxPathAsBase64(outputSandboxPath)) {
      const b64Result = await sandbox.commands.run(`base64 -w0 "${outputSandboxPath}"`, options)
      return b64Result.stdout
    }
    return await sandbox.files.read(outputSandboxPath)
  } catch (error) {
    logger.warn('Failed to read requested sandbox output file', {
      outputSandboxPath,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

function requestedOutputSandboxPaths(req: {
  outputSandboxPath?: string
  outputSandboxPaths?: string[]
}): string[] {
  const paths = [...(req.outputSandboxPaths ?? [])]
  if (req.outputSandboxPath && !paths.includes(req.outputSandboxPath)) {
    paths.push(req.outputSandboxPath)
  }
  return paths
}

export async function executeInE2B(req: E2BExecutionRequest): Promise<E2BExecutionResult> {
  const { code, language, timeoutMs } = req

  const sandbox = await createE2BSandbox(req.sandboxKind ?? 'code')
  const sandboxId = sandbox.sandboxId

  const stdoutChunks = []

  try {
    // Inside the try so a failed mount still kills the sandbox via the finally below.
    await writeSandboxInputs(sandbox, req.sandboxFiles, { sandboxId })

    const execution = await sandbox.runCode(code, {
      language: language === CodeLanguage.Python ? 'python' : 'javascript',
      timeoutMs,
    })

    if (execution.error) {
      const errorMessage = `${execution.error.name}: ${execution.error.value}`
      logger.error(`E2B execution error`, {
        sandboxId,
        error: execution.error,
        errorMessage,
      })

      const errorOutput = execution.error.traceback || errorMessage
      return {
        result: null,
        stdout: errorOutput,
        error: errorMessage,
        sandboxId,
      }
    }

    if (execution.text) {
      stdoutChunks.push(execution.text)
    }
    if (execution.logs?.stdout) {
      stdoutChunks.push(...execution.logs.stdout)
    }
    if (execution.logs?.stderr) {
      stdoutChunks.push(...execution.logs.stderr)
    }

    const stdout = stdoutChunks.join('\n')

    let result: unknown = null
    const prefix = '__SIM_RESULT__='
    const lines = stdout.split('\n')
    const marker = lines.find((l) => l.startsWith(prefix))
    let cleanedStdout = stdout
    if (marker) {
      const jsonPart = marker.slice(prefix.length)
      try {
        result = JSON.parse(jsonPart)
      } catch {
        result = jsonPart
      }
      const filteredLines = lines.filter((l) => !l.startsWith(prefix))
      if (filteredLines.length > 0 && filteredLines[filteredLines.length - 1] === '') {
        filteredLines.pop()
      }
      cleanedStdout = filteredLines.join('\n')
    }

    const images: string[] = []
    if (execution.results?.length) {
      for (const r of execution.results) {
        if (r.png) {
          images.push(r.png)
        } else if (r.jpeg) {
          images.push(r.jpeg)
        }
      }
    }

    const exportedFiles: Record<string, string> = {}
    for (const outputSandboxPath of requestedOutputSandboxPaths(req)) {
      const content = await readSandboxOutputFile(sandbox, outputSandboxPath)
      if (content !== undefined) {
        exportedFiles[outputSandboxPath] = content
      }
    }
    const exportedFileContent = req.outputSandboxPath
      ? exportedFiles[req.outputSandboxPath]
      : undefined

    return {
      result,
      stdout: cleanedStdout,
      sandboxId,
      exportedFileContent,
      exportedFiles: Object.keys(exportedFiles).length ? exportedFiles : undefined,
      images: images.length ? images : undefined,
    }
  } finally {
    try {
      await sandbox.kill()
    } catch {}
  }
}

export async function executeShellInE2B(
  req: E2BShellExecutionRequest
): Promise<E2BExecutionResult> {
  const { code, envs, timeoutMs } = req

  const sandbox = await createE2BSandbox(req.sandboxKind ?? 'shell')
  const sandboxId = sandbox.sandboxId

  try {
    // Inside the try so a failed mount still kills the sandbox via the finally below.
    await writeSandboxInputs(sandbox, req.sandboxFiles, { sandboxId, rootUser: true })

    let result: { stdout: string; stderr: string; exitCode: number }
    try {
      result = await sandbox.commands.run(code, {
        envs: {
          ...envs,
          PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/root/.local/bin',
        },
        timeoutMs,
        user: 'root',
      })
    } catch (cmdError: any) {
      const stderr = cmdError?.stderr || cmdError?.message || String(cmdError)
      const stdout = cmdError?.stdout || ''
      const exitCode = cmdError?.exitCode ?? 1
      logger.error('E2B shell command error', {
        sandboxId,
        exitCode,
        error: stderr.slice(0, 500),
      })
      return {
        result: null,
        stdout: [stdout, stderr].filter(Boolean).join('\n'),
        error: stderr || `Command failed with exit code ${exitCode}`,
        sandboxId,
      }
    }

    const stdout = [result.stdout, result.stderr].filter(Boolean).join('\n')

    if (result.exitCode !== 0) {
      const errorMessage = result.stderr || `Process exited with code ${result.exitCode}`
      logger.error('E2B shell execution error', {
        sandboxId,
        exitCode: result.exitCode,
        stderr: result.stderr?.slice(0, 500),
      })
      return {
        result: null,
        stdout,
        error: errorMessage,
        sandboxId,
      }
    }

    let parsed: unknown = null
    const prefix = '__SIM_RESULT__='
    const lines = stdout.split('\n')
    const marker = lines.find((l) => l.startsWith(prefix))
    let cleanedStdout = stdout
    if (marker) {
      const jsonPart = marker.slice(prefix.length)
      try {
        parsed = JSON.parse(jsonPart)
      } catch {
        parsed = jsonPart
      }
      const filteredLines = lines.filter((l) => !l.startsWith(prefix))
      if (filteredLines.length > 0 && filteredLines[filteredLines.length - 1] === '') {
        filteredLines.pop()
      }
      cleanedStdout = filteredLines.join('\n')
    }

    const exportedFiles: Record<string, string> = {}
    for (const outputSandboxPath of requestedOutputSandboxPaths(req)) {
      const content = await readSandboxOutputFile(sandbox, outputSandboxPath, {
        user: 'root',
      })
      if (content !== undefined) {
        exportedFiles[outputSandboxPath] = content
      }
    }
    const exportedFileContent = req.outputSandboxPath
      ? exportedFiles[req.outputSandboxPath]
      : undefined

    return {
      result: parsed,
      stdout: cleanedStdout,
      sandboxId,
      exportedFileContent,
      exportedFiles: Object.keys(exportedFiles).length ? exportedFiles : undefined,
    }
  } finally {
    try {
      await sandbox.kill()
    } catch {}
  }
}

const PI_SANDBOX_PATH =
  '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/root/.local/bin'

/** Result of one command run inside a Pi sandbox. */
export interface PiSandboxCommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

/** Runs commands and moves files inside a live Pi sandbox. */
export interface PiSandboxRunner {
  run(
    command: string,
    options: {
      envs?: Record<string, string>
      timeoutMs: number
      onStdout?: (chunk: string) => void
      onStderr?: (chunk: string) => void
    }
  ): Promise<PiSandboxCommandResult>
  readFile(path: string): Promise<string>
  /**
   * Writes a file via the sandbox filesystem API. Bytes go through the E2B SDK,
   * never a shell, so untrusted content (the assembled prompt, a commit message)
   * is delivered without any shell parsing — callers reference it by a fixed path.
   */
  writeFile(path: string, content: string): Promise<void>
}

/**
 * Creates a Pi sandbox, keeps it alive for the duration of `fn` (so the cloned
 * repo persists across the clone -> agent -> push commands), streams command
 * output, and always kills the sandbox afterward. Per-command envs are isolated,
 * so secrets handed to one command never leak into the next.
 */
export async function withPiSandbox<T>(fn: (runner: PiSandboxRunner) => Promise<T>): Promise<T> {
  const sandbox = await createE2BSandbox('pi')
  const sandboxId = sandbox.sandboxId
  logger.info('Started Pi sandbox', { sandboxId })

  const runner: PiSandboxRunner = {
    run: async (command, options) => {
      try {
        const result = await sandbox.commands.run(command, {
          envs: { ...(options.envs ?? {}), PATH: PI_SANDBOX_PATH },
          timeoutMs: options.timeoutMs,
          user: 'root',
          onStdout: options.onStdout,
          onStderr: options.onStderr,
        })
        return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }
      } catch (error) {
        const failure = error as {
          stdout?: string
          stderr?: string
          message?: string
          exitCode?: number
        }
        return {
          stdout: failure.stdout ?? '',
          stderr: failure.stderr ?? failure.message ?? getErrorMessage(error),
          exitCode: failure.exitCode ?? 1,
        }
      }
    },
    readFile: (path) => sandbox.files.read(path),
    writeFile: async (path, content) => {
      await sandbox.files.write(path, content)
    },
  }

  try {
    return await fn(runner)
  } finally {
    try {
      await sandbox.kill()
    } catch {}
  }
}
