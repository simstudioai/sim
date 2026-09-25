import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { withSandboxFilePublication } from '@/lib/execution/remote-sandbox/file-publication'
import type { SandboxHandle, SandboxSessionRequest } from '@/lib/execution/remote-sandbox/types'

/** A valid release is reused; activation repairs only its own versioned launcher. */
const CHECK_CLI_COMMAND = `python3 - <<'SIM_SESSION_CLI'
import hashlib, json, os, stat, sys, tempfile
path = os.environ['SIM_CLI_PATH']
for artifact, expected in json.loads(os.environ['SIM_CLI_ARTIFACTS']).items():
    if os.path.islink(artifact):
        sys.exit(10)
    digest = hashlib.sha256()
    try:
        with open(artifact, 'rb') as source:
            for chunk in iter(lambda: source.read(65536), b''):
                digest.update(chunk)
    except FileNotFoundError:
        sys.exit(10)
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
SIM_SESSION_CLI`

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
  const check = async (): Promise<boolean> => {
    const result = await sandbox.runCommand(CHECK_CLI_COMMAND, {
      envs: {
        SIM_CLI_PATH: cli.path,
        SIM_CLI_ARTIFACTS: JSON.stringify(
          Object.fromEntries(
            [cli, ...(cli.runtime ? [cli.runtime] : [])].map(({ path, content }) => [
              path,
              createHash('sha256').update(content).digest('hex'),
            ])
          )
        ),
      },
      timeoutMs: Math.min(30_000, remainingMs()),
      maxOutputBytes: 64 * 1024,
      rootUser: false,
      atMostOnce: true,
      signal,
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
