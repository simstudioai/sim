export interface SessionProcessIdentity {
  id: string
  sandboxId: string
  sessionKey: string
}

/**
 * PID 1 owns every descendant, including new sessions and double forks. A root-only
 * tombstone serializes Stop with launch; pidfds confirm exit without signalling a reused PID.
 */
const PROCESS_RUNTIME = `import base64, contextlib, fcntl, json, os, pathlib, pwd, re, select, signal, subprocess, sys, tempfile

action, identity = sys.argv[1:3]
if not re.fullmatch(r"[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}", identity):
    raise ValueError("Invalid command identity")
base = pathlib.Path('/run/sim-mship-processes/v1')
base.mkdir(mode=0o700, parents=True, exist_ok=True)
info = base.lstat()
if base.is_symlink() or info.st_uid != 0 or info.st_mode & 0o077:
    raise RuntimeError('Unsafe command ownership directory')
record = base / (identity + '.json')

def save(value):
    name = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=base, delete=False) as target:
            name = target.name
            json.dump(value, target)
            target.flush()
            os.fsync(target.fileno())
        os.replace(name, record)
    finally:
        if name and os.path.exists(name):
            os.unlink(name)

@contextlib.contextmanager
def locked():
    with open(base / (identity + '.lock'), 'a+') as guard:
        fcntl.flock(guard, fcntl.LOCK_EX)
        value = json.loads(record.read_text()) if record.exists() else {}
        yield value

def start_ticks(status):
    return status.rsplit(')', 1)[1].split()[19]

if action == 'run':
    descriptor = os.pidfd_open(os.getpid())
    try:
        signal.pidfd_send_signal(descriptor, 0)
    finally:
        os.close(descriptor)
    with locked() as state:
        if state:
            raise RuntimeError('Command identity is closed or already admitted')
        save({'launcher': os.getpid()})
    parent_proc = os.open('/proc', os.O_RDONLY | os.O_DIRECTORY)
    os.set_inheritable(parent_proc, True)
    os.execvp('unshare', ['unshare', '--pid', '--fork', '--kill-child=SIGKILL', '--mount-proc',
        sys.executable, '-c', script.decode(), 'init', identity, *sys.argv[3:], str(parent_proc)])
elif action == 'init':
    if os.getpid() != 1:
        raise RuntimeError('Command requires its own PID namespace')
    parent_proc = int(sys.argv[5])
    with locked() as state:
        if state.get('closed'):
            sys.exit(125)
        host_stat_fd = os.open('self/stat', os.O_RDONLY, dir_fd=parent_proc)
        with os.fdopen(host_stat_fd) as source:
            host_stat = source.read()
        state.update(pid=int(host_stat.split(' ', 1)[0]), start=start_ticks(host_stat),
            namespace=os.readlink('self/ns/pid', dir_fd=parent_proc))
        save(state)
        os.close(parent_proc)
        owner = pwd.getpwnam(sys.argv[4])
        def enter_user():
            os.initgroups(owner.pw_name, owner.pw_gid)
            os.setgid(owner.pw_gid)
            os.setuid(owner.pw_uid)
        environment = dict(os.environ, HOME=owner.pw_dir, USER=owner.pw_name, LOGNAME=owner.pw_name)
        child = subprocess.Popen(['/bin/bash', '-lc', base64.b64decode(sys.argv[3]).decode()],
            cwd=owner.pw_dir, env=environment, preexec_fn=enter_user)
    while True:
        waited_pid, waited_status = os.wait()
        if waited_pid == child.pid:
            child.returncode = os.waitstatus_to_exitcode(waited_status)
            break
    status = child.returncode
    sys.exit(status if status >= 0 else 128 - status)
elif action == 'stop':
    with locked() as state:
        state['closed'] = True
        save(state)
        pid = state.get('pid')
        if pid:
            try:
                descriptor = os.pidfd_open(pid)
            except ProcessLookupError:
                descriptor = None
            if descriptor is not None:
                try:
                    try:
                        same = (os.readlink('/proc/' + str(pid) + '/ns/pid') == state['namespace']
                            and start_ticks(pathlib.Path('/proc/' + str(pid) + '/stat').read_text()) == state['start'])
                    except FileNotFoundError:
                        same = False
                    if same:
                        try:
                            signal.pidfd_send_signal(descriptor, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        poller = select.poll()
                        poller.register(descriptor, select.POLLIN)
                        if not poller.poll(3000):
                            raise RuntimeError('Command namespace exit is unconfirmed')
                finally:
                    os.close(descriptor)
    print(json.dumps({'settled': True}))
else:
    raise ValueError('Invalid command action')
`

const PROCESS_LAUNCHER = `exec python3 -c 'import base64,sys;script=base64.b64decode(sys.argv.pop(1));exec(script)' ${Buffer.from(PROCESS_RUNTIME).toString('base64')}`

function commandIdentity(identity: string): string {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(identity)) {
    throw new Error('Invalid sandbox command identity')
  }
  return identity
}

/** The caller invokes the supervisor as root; the requested command retains its ordinary user. */
export function sessionProcessCommand(identity: string, command: string, rootUser = false): string {
  return `${PROCESS_LAUNCHER} run ${commandIdentity(identity)} '${Buffer.from(command).toString('base64')}' ${rootUser ? 'root' : 'user'}`
}

/** Safe before launch as well as after a lost launch reply: the tombstone prevents future work. */
export function sessionProcessStopCommand(identity: string): string {
  return `${PROCESS_LAUNCHER} stop ${commandIdentity(identity)}`
}
