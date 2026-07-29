import type { Sandbox as E2BSandbox, Template as E2BTemplate } from '@e2b/code-interpreter'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import { CodeLanguage } from '@/lib/execution/languages'
import { classifyInstallOutput, tailBuildLog } from '@/lib/execution/remote-sandbox/build-errors'
import {
  quoteDependency,
  type SandboxSpec,
  SIM_DEPS_DIR,
  SIM_NODE_MODULES_DIR,
} from '@/lib/execution/remote-sandbox/sandbox-spec'
import type {
  CreateSandboxOptions,
  RunCommandOptions,
  SandboxCodeResult,
  SandboxCommandResult,
  SandboxHandle,
  SandboxImageBuild,
  SandboxImageBuilder,
  SandboxImageBuildStatus,
  SandboxKind,
  SandboxProvider,
} from '@/lib/execution/remote-sandbox/types'

const logger = createLogger('E2BSandboxProvider')

/** The `Template` callable, threaded in so the SDK stays a dynamic import. */
type TemplateFactory = typeof E2BTemplate

/**
 * Prefix for content-addressed dependency templates. Refs are account-global, so
 * the prefix keeps them clearly attributable and out of the way of hand-built
 * templates.
 */
const SANDBOX_TEMPLATE_PREFIX = 'sim-sbx-'

/**
 * How much of the spec hash goes into the ref. Template names are one namespace
 * across the whole E2B account, and nothing detects a collision — two specs
 * sharing a prefix would build to the same name and silently swap package sets
 * between workspaces. 32 hex chars (128 bits) puts that out of reach.
 */
const SPEC_HASH_REF_LENGTH = 32

export function sandboxImageRef(specHash: string): string {
  return `${SANDBOX_TEMPLATE_PREFIX}${specHash.slice(0, SPEC_HASH_REF_LENGTH)}`
}

/**
 * E2B's control-plane base. `ConnectionConfig` derives this internally but is
 * not re-exported by `@e2b/code-interpreter`, and `e2b` itself is only a
 * transitive dependency, so the one endpoint the SDK omits resolves it here.
 */
function e2bApiUrl(): string {
  return `https://api.${env.E2B_DOMAIN || 'e2b.app'}`
}

function templateFor(kind: SandboxKind, imageRef?: string): string | undefined {
  // A workspace dependency set may only displace the general shell template.
  // `doc` and `pi` keep their vetted images unconditionally, so a user's package
  // list can never land under the document compiler or the coding agent.
  if (imageRef && (kind === 'code' || kind === 'shell')) {
    return imageRef
  }
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

  async runCode(
    code: string,
    options: { timeoutMs: number; envs?: Record<string, string> }
  ): Promise<SandboxCodeResult> {
    const execution = await this.sandbox.runCode(code, {
      language: this.language === CodeLanguage.Python ? 'python' : 'javascript',
      timeoutMs: options.timeoutMs,
      ...(options.envs ? { envs: options.envs } : {}),
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

/**
 * Composes the dependency layer over the general shell template. `fromTemplate`
 * means each build stacks only the new layer and inherits everything else, which
 * is what makes a template per workspace sandbox cheap.
 *
 * Dependencies reach the installer as individually quoted argv entries. The SDK
 * renders `pipInstall`/`npmInstall` by joining packages with spaces into one
 * shell string, so an unquoted `django>=5.0` would redirect stdout into a file
 * named `=5.0` and silently install an unpinned Django — hence
 * {@link quoteDependency} and the hand-composed `runCmd`.
 */
function composeDependencyTemplate(
  spec: SandboxSpec,
  template: TemplateFactory,
  baseTemplate: string
) {
  const packages = spec.dependencies.map(quoteDependency).join(' ')

  if (spec.language === CodeLanguage.Python) {
    return template()
      .fromTemplate(baseTemplate)
      .runCmd(`pip install --no-input --disable-pip-version-check ${packages}`, { user: 'root' })
  }

  // Unlike pip, an npm install is not automatically importable — Node resolves
  // from NODE_PATH or the install location. Installing into a fixed prefix and
  // baking NODE_PATH is what makes `require`/`import` find these packages.
  return template()
    .fromTemplate(baseTemplate)
    .makeDir(SIM_DEPS_DIR, { user: 'root' })
    .runCmd(`npm install --prefix ${SIM_DEPS_DIR} --no-audit --no-fund --omit=dev ${packages}`, {
      user: 'root',
    })
    .setEnvs({ NODE_PATH: SIM_NODE_MODULES_DIR })
}

const e2bImages: SandboxImageBuilder = {
  async startBuild(spec: SandboxSpec, specHash: string): Promise<SandboxImageBuild> {
    const apiKey = env.E2B_API_KEY
    if (!apiKey) {
      throw new Error('E2B_API_KEY is required to build a sandbox image')
    }
    // Resolved before the dynamic import so a misconfigured deployment fails
    // without ever reaching the network.
    const baseTemplate = env.MOTHERSHIP_E2B_TEMPLATE_ID
    if (!baseTemplate) {
      throw new Error('Sandbox builds are not configured (MOTHERSHIP_E2B_TEMPLATE_ID is unset)')
    }
    const imageRef = sandboxImageRef(specHash)

    const { Template } = await import('@e2b/code-interpreter')
    const template = composeDependencyTemplate(spec, Template, baseTemplate)
    const build = await Template.buildInBackground(template, imageRef, { apiKey })

    logger.info('Started E2B sandbox image build', {
      imageRef,
      buildId: build.buildId,
      language: spec.language,
      dependencyCount: spec.dependencies.length,
    })
    return { imageRef, buildId: build.buildId, providerImageId: build.templateId }
  },

  async getBuildStatus(
    build: SandboxImageBuild,
    spec: SandboxSpec
  ): Promise<SandboxImageBuildStatus> {
    const apiKey = env.E2B_API_KEY
    if (!apiKey) {
      throw new Error('E2B_API_KEY is required to poll a sandbox image build')
    }
    const { Template } = await import('@e2b/code-interpreter')
    const status = await Template.getBuildStatus(
      { templateId: build.providerImageId ?? build.imageRef, buildId: build.buildId },
      { apiKey }
    )

    const logs = status.logEntries.map((entry) => entry.message).join('\n')
    if (status.status === 'ready') return { status: 'ready' }
    if (status.status === 'error') {
      return {
        status: 'failed',
        error: classifyInstallOutput(spec.language, `${status.reason?.message ?? ''}\n${logs}`),
        logs: tailBuildLog(logs),
      }
    }
    return { status: 'building' }
  },

  /**
   * The SDK surfaces no template delete, so the retention sweep calls the REST
   * endpoint directly. A non-2xx throws so the caller leaves the registry row in
   * place and retries, rather than orphaning the remote template.
   */
  async deleteImage(build: SandboxImageBuild): Promise<void> {
    const apiKey = env.E2B_API_KEY
    if (!apiKey) {
      throw new Error('E2B_API_KEY is required to delete a sandbox image')
    }
    const templateId = build.providerImageId ?? build.imageRef
    const response = await fetch(`${e2bApiUrl()}/templates/${encodeURIComponent(templateId)}`, {
      method: 'DELETE',
      headers: { 'X-API-KEY': apiKey },
      // The retention sweep deletes sequentially; without this one hung
      // connection to the control plane stalls the whole cron handler.
      signal: AbortSignal.timeout(30_000),
    })
    // A template that is already gone is the state we wanted.
    if (!response.ok && response.status !== 404) {
      throw new Error(`E2B refused to delete template ${templateId} (${response.status})`)
    }
  },
}

export const e2bProvider: SandboxProvider = {
  id: 'e2b',
  dependencyStrategy: 'prebuilt',
  images: e2bImages,
  async create(kind: SandboxKind, options?: CreateSandboxOptions): Promise<SandboxHandle> {
    const apiKey = env.E2B_API_KEY
    if (!apiKey) {
      throw new Error('E2B_API_KEY is required when E2B is enabled')
    }
    const templateName = templateFor(kind, options?.imageRef)
    logger.info('Creating E2B sandbox', { kind, template: templateName || '(default)' })

    const { Sandbox } = await import('@e2b/code-interpreter')
    const sandbox = templateName
      ? await Sandbox.create(templateName, { apiKey })
      : await Sandbox.create({ apiKey })

    return new E2BSandboxHandle(sandbox, options?.language ?? CodeLanguage.Python)
  },
}
