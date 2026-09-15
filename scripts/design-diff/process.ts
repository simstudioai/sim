/** Native Bun subprocess contract used by the benchmark, independent of Node stream events. */
interface Runtime {
  spawn(
    args: string[],
    options: {
      cwd: string
      env: NodeJS.ProcessEnv
      stdin: 'ignore'
      stdout: 'ignore'
      stderr: 'pipe'
      detached: true
    }
  ): { pid: number; exited: Promise<number>; stderr: ReadableStream<Uint8Array> }
}

/** Await the process exit status itself and drain bounded diagnostics separately. */
export async function runProcess(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  milliseconds = 900000
) {
  const runtime = (globalThis as typeof globalThis & { Bun?: Runtime }).Bun
  if (!runtime) throw new Error('Benchmark subprocesses require Bun')
  const proc = runtime.spawn(args, {
    cwd,
    env,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
    detached: true,
  })
  const reader = proc.stderr.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  let truncated = false
  const drain = (async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = Math.max(0, 65536 - bytes)
      if (value.length > remaining) truncated = true
      if (remaining) {
        chunks.push(value.subarray(0, remaining))
        bytes += Math.min(remaining, value.length)
      }
    }
    return Buffer.concat(chunks).toString('utf8')
  })()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    try {
      process.kill(-proc.pid, 'SIGKILL')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }, milliseconds)
  try {
    const [exitCode, stderr] = await Promise.all([proc.exited, drain])
    return { exitCode, stderr, truncated, timedOut }
  } finally {
    clearTimeout(timeout)
  }
}
