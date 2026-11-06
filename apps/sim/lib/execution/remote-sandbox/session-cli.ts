import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { withSandboxFilePublication } from '@/lib/execution/remote-sandbox/file-publication'
import type {
  SandboxHandle,
  SandboxSessionRequest,
  SessionCliVerification,
} from '@/lib/execution/remote-sandbox/types'

/**
 * Exits 0 when every artifact matches its digest, and 10 when one is missing, unreadable, not a
 * regular file, a symlink, or changed, so repair overwrites it. Opening never follows a link or
 * blocks on a FIFO. A valid release is reused; activation repairs only its own versioned launcher.
 */
export const SESSION_CLI_CHECK_SCRIPT = `import hashlib, json, os, stat, sys, tempfile
path = os.environ['SIM_CLI_PATH']
for artifact, expected in json.loads(os.environ['SIM_CLI_ARTIFACTS']).items():
    try:
        descriptor = os.open(artifact, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        sys.exit(10)
    digest = hashlib.sha256()
    with os.fdopen(descriptor, 'rb') as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            sys.exit(10)
        for chunk in iter(lambda: source.read(65536), b''):
            digest.update(chunk)
    if digest.hexdigest() != expected:
        sys.exit(10)
if stat.S_IMODE(os.stat(path).st_mode) != 0o755:
    os.chmod(path, 0o755)
launcher = os.path.join(os.path.dirname(path), 'sim')
if not os.path.islink(launcher) or os.readlink(launcher) != os.path.basename(path):
    with tempfile.TemporaryDirectory(prefix='.sim-link-', dir=os.path.dirname(path)) as directory:
        staged = os.path.join(directory, 'sim')
        os.symlink(os.path.basename(path), staged)
        os.replace(staged, launcher)
`

const CHECK_CLI_COMMAND = `python3 - <<'SIM_SESSION_CLI'
${SESSION_CLI_CHECK_SCRIPT}SIM_SESSION_CLI`

/**
 * A session command refused to start because the deployment CLI it would run with no longer
 * matches this release. Nothing the caller asked for ran; repair the CLI and launch again.
 */
export class SessionCliStaleError extends Error {
  constructor() {
    super('Workbench CLI changed since it was verified')
    this.name = 'SessionCliStaleError'
  }
}

/** A launch could not complete the CLI check (an unreadable artifact, a hung check), so it ran nothing. */
export class SessionCliVerificationError extends Error {
  constructor() {
    super('Workbench CLI verification failed')
    this.name = 'SessionCliVerificationError'
  }
}

const verifications = new WeakMap<
  NonNullable<SandboxSessionRequest['cli']>,
  SessionCliVerification
>()

/** The digests a launch verifies before it starts the command, hashed once per CLI request. */
export function sessionCliVerification(
  cli: NonNullable<SandboxSessionRequest['cli']>
): SessionCliVerification {
  let verification = verifications.get(cli)
  if (!verification) {
    verification = {
      path: cli.path,
      artifacts: Object.fromEntries(
        [cli, ...(cli.runtime ? [cli.runtime] : [])].map(({ path, content }) => [
          path,
          createHash('sha256').update(content).digest('hex'),
        ])
      ),
    }
    verifications.set(cli, verification)
  }
  return verification
}

/** Each running script keeps the CLI release chosen by the Sim instance that started it. */
export function sessionCommandPath(
  session: SandboxSessionRequest | undefined,
  base: string
): string {
  return session?.cli ? `${posix.dirname(session.cli.path)}:/home/user/.local/bin:${base}` : base
}

export async function ensureSessionCli(
  sandbox: SandboxHandle,
  cli: NonNullable<SandboxSessionRequest['cli']>,
  signal: AbortSignal,
  timeoutMs: number
): Promise<void> {
  const started = Date.now()
  const remainingMs = (): number => {
    signal.throwIfAborted()
    const remaining = timeoutMs - (Date.now() - started)
    if (remaining <= 0) throw new DOMException('timeout', 'AbortError')
    return remaining
  }
  const verification = sessionCliVerification(cli)
  /**
   * A handle that verifies at launch checks through its own supervisor, which the user's shell
   * profile and Python site hooks cannot reach; the shell form sources the user's login profile.
   */
  const check = async (): Promise<boolean> => {
    const options = {
      timeoutMs: Math.min(30_000, remainingMs()),
      maxOutputBytes: 64 * 1024,
      rootUser: false,
      atMostOnce: true,
      signal,
    }
    if (sandbox.verifiesCliAtLaunch) {
      try {
        const result = await sandbox.runCommand('true', { ...options, verifyCli: verification })
        signal.throwIfAborted()
        if (result.timedOut) throw new DOMException('timeout', 'AbortError')
        if (result.exitCode !== 0) throw new SessionCliVerificationError()
        return true
      } catch (error) {
        if (error instanceof SessionCliStaleError) return false
        throw error
      }
    }
    const result = await sandbox.runCommand(CHECK_CLI_COMMAND, {
      ...options,
      envs: {
        SIM_CLI_PATH: verification.path,
        SIM_CLI_ARTIFACTS: JSON.stringify(verification.artifacts),
      },
    })
    signal.throwIfAborted()
    if (result.timedOut) throw new DOMException('timeout', 'AbortError')
    if (result.exitCode === 0) return true
    if (result.exitCode === 10) return false
    throw new Error(
      result.stderr.trim() || result.stdout.trim() || 'Workbench CLI verification failed'
    )
  }
  if (await check()) return
  for (const artifact of [...(cli.runtime ? [cli.runtime] : []), cli]) {
    await withSandboxFilePublication(
      sandbox,
      artifact.path,
      {
        overwrite: true,
        followSymlinks: false,
        executable: artifact === cli,
        rootUser: false,
        signal,
        timeoutMs: remainingMs(),
      },
      (staged) => sandbox.writeFile(staged, artifact.content)
    )
  }
  if (!(await check())) throw new Error('Workbench CLI installation could not be verified')
}
