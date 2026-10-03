/**
 * Emits the production-command Linux probe for an isolated container. Pipe to Python as PID 1
 * in a disposable, network-disabled container with SYS_ADMIN and namespace-capable seccomp.
 * No provider credentials, services, or host filesystem mounts are needed.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  sessionProcessCommand,
  sessionProcessStopCommand,
} from '@/lib/execution/remote-sandbox/session-process'

const writer = `import os, pathlib, sys, time
path = pathlib.Path(sys.argv[1])
child = os.fork()
if child == 0:
    os.setsid()
    for i in range(1000):
        with path.open('a') as target:
            target.write('x')
        time.sleep(0.01)
    os._exit(0)
print(os.getuid(), flush=True)
time.sleep(10)
`
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const jobs = Object.fromEntries(
  [
    'first',
    'sibling',
    'late',
    'launcher-death',
    'controller-death',
    'normal-exit',
    'reap-orphans',
    'stale-pid',
    'empty',
    'unicode',
    'root',
    ...Array.from({ length: 20 }, (_, index) => `race${index}`),
  ].map((name, index) => {
    const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    let command = `python3 -c ${quote(writer)} /tmp/mship-kernel-proof/${name}`
    if (name === 'normal-exit')
      command = `python3 -c ${quote(writer.replace('time.sleep(10)', 'time.sleep(0.1)'))} /tmp/mship-kernel-proof/${name}`
    if (name === 'reap-orphans')
      command = `python3 -c ${quote(`import os, pathlib, time
for _ in range(20):
    child = os.fork()
    if child == 0:
        if os.fork() == 0: os._exit(0)
        os._exit(0)
    os.waitpid(child, 0)
for _ in range(100):
    zombies = 0
    for path in pathlib.Path('/proc').glob('[0-9]*/stat'):
        try: zombies += path.read_text().rsplit(')', 1)[1].split()[0] == 'Z'
        except FileNotFoundError: pass
    if not zombies: break
    time.sleep(0.01)
assert zombies == 0, 'namespace init did not reap orphaned children'
`)}`
    if (name === 'empty') command = ''
    if (name === 'unicode')
      command = 'printf \'%s\' \'héllo 世界\'; printf \'\\n%s|%s|%s\' "$HOME" "$USER" "$PWD"'
    if (name === 'root') command = 'id -u'
    return [
      name,
      {
        id,
        run: sessionProcessCommand(id, command, name === 'root'),
        stop: sessionProcessStopCommand(id),
      },
    ]
  })
)
const probeMode = process.argv.includes('--no-namespaces')
const proof = `import json\nexpect_no_namespaces = ${probeMode ? 'True' : 'False'}\njobs = json.loads(${JSON.stringify(JSON.stringify(jobs))})\n${readFileSync(fileURLToPath(new URL('./session-process.py', import.meta.url)), 'utf8')}`
process.stdout.write(proof)
