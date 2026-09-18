import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const runner = fileURLToPath(new URL('../process.ts', import.meta.url))

it.each([
  ['exit status', 'process.stderr.write("metric");process.exit(7)', 5000, 7, false, false, 6],
  ['bounded diagnostics', 'process.stderr.write("x".repeat(100000))', 5000, 0, false, true, 65536],
  ['deadline', 'await new Promise(resolve=>setTimeout(resolve,30000))', 50, null, true, false, 0],
])(
  'measures native Bun subprocess %s',
  (_name, source, deadline, code, timedOut, truncated, bytes) => {
    const script = `import {runProcess} from ${JSON.stringify(runner)};const result=await runProcess([process.execPath,'--no-env-file','-e',${JSON.stringify(source)}],process.cwd(),process.env,${deadline});process.stdout.write(JSON.stringify({...result,stderr:result.stderr.length}));`
    const result = JSON.parse(
      execFileSync('bun', ['--no-env-file', '-e', script], { encoding: 'utf8', timeout: 10000 })
    )
    expect(result).toMatchObject({ timedOut, truncated, stderr: bytes })
    if (code === null) expect(result.exitCode).not.toBe(0)
    else expect(result.exitCode).toBe(code)
  }
)
