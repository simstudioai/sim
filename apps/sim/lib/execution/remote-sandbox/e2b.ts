import type { Sandbox as E2BSandbox } from '@e2b/code-interpreter'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import { CodeLanguage } from '@/lib/execution/languages'
import type {
  CreateSandboxOptions,
  RunCommandOptions,
  SandboxCodeResult,
  SandboxCommandResult,
  SandboxHandle,
  SandboxKind,
  SandboxProvider,
} from '@/lib/execution/remote-sandbox/types'

const logger = createLogger('E2BSandboxProvider')

function templateFor(kind: SandboxKind): string | undefined {
  // Document generation uses a dedicated template (python-pptx/docx/openpyxl/
  // reportlab + fonts); shell/code execution use the general shell template.
  // Doc fails closed: never run LLM-authored Python in E2B's default template
  // (which is not vetted for this) just because the doc template id is unset.
  if (kind === 'doc') {
    if (!env.MOTHERSHIP_E2B_DOC_TEMPLATE_ID) {
      throw new Error('Document compiler not configured (MOTHERSHIP_E2B_DOC_TEMPLATE_ID is unset)')
    }
    return env.MOTHERSHIP_E2B_DOC_TEMPLATE_ID
  }
  // Pi fails closed for the same reason: the coding agent needs the Pi CLI + git
  // baked into a vetted template, never E2B's default image.
  if (kind === 'pi') {
    if (!env.E2B_PI_TEMPLATE_ID) {
      throw new Error('Pi cloud agent not configured (E2B_PI_TEMPLATE_ID is unset)')
    }
    return env.E2B_PI_TEMPLATE_ID
  }
  return env.MOTHERSHIP_E2B_TEMPLATE_ID
}

class E2BSandboxHandle implements SandboxHandle {
  constructor(
    private readonly sandbox: E2BSandbox,
    private readonly language: CodeLanguage
  ) {}

  get sandboxId(): string {
    return this.sandbox.sandboxId
  }

  async runCode(code: string, options: { timeoutMs: number }): Promise<SandboxCodeResult> {
    const execution = await this.sandbox.runCode(code, {
      language: this.language === CodeLanguage.Python ? 'python' : 'javascript',
      timeoutMs: options.timeoutMs,
    })

    // Kernel stream entries are chunks, not lines — each already carries its own
    // newlines, and one long line can arrive split across several entries.
    // Concatenate each stream verbatim: joining chunks with '\n' injected a
    // newline at every chunk boundary, which corrupted large single-line
    // __SIM_RESULT__ payloads and silently truncated the persisted result.
    return {
      text: execution.text ?? '',
      stdout: (execution.logs?.stdout ?? []).join(''),
      stderr: (execution.logs?.stderr ?? []).join(''),
      error: execution.error
        ? {
            name: execution.error.name,
            value: execution.error.value,
            traceback: execution.error.traceback,
          }
        : undefined,
    }
  }

  async runCommand(command: string, options: RunCommandOptions): Promise<SandboxCommandResult> {
    try {
      const result = await this.sandbox.commands.run(command, {
        ...(options.envs ? { envs: options.envs } : {}),
        timeoutMs: options.timeoutMs,
        ...(options.rootUser ? { user: 'root' as const } : {}),
        ...(options.onStdout ? { onStdout: options.onStdout } : {}),
        ...(options.onStderr ? { onStderr: options.onStderr } : {}),
      })
      return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }
    } catch (error) {
      // The SDK throws on non-zero exit; callers want the streams, not a throw.
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
  }

  readFile(path: string): Promise<string> {
    return this.sandbox.files.read(path)
  }

  async writeFile(path: string, content: string | ArrayBuffer): Promise<void> {
    await this.sandbox.files.write(path, content as string)
  }

  async kill(): Promise<void> {
    await this.sandbox.kill()
  }
}

export const e2bProvider: SandboxProvider = {
  id: 'e2b',
  async create(kind: SandboxKind, options?: CreateSandboxOptions): Promise<SandboxHandle> {
    const apiKey = env.E2B_API_KEY
    if (!apiKey) {
      throw new Error('E2B_API_KEY is required when E2B is enabled')
    }
    const templateName = templateFor(kind)
    logger.info('Creating E2B sandbox', { kind, template: templateName || '(default)' })

    const { Sandbox } = await import('@e2b/code-interpreter')
    const sandbox = templateName
      ? await Sandbox.create(templateName, { apiKey })
      : await Sandbox.create({ apiKey })

    return new E2BSandboxHandle(sandbox, options?.language ?? CodeLanguage.Python)
  },
}
