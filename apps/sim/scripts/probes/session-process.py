import concurrent.futures, os, pathlib, pwd, signal, subprocess, time

assert os.getpid() == 1 and os.getuid() == 0, 'Run only as PID 1 in a disposable root container'

subprocess.run(['useradd', '--create-home', 'user'], check=True)
owner = pwd.getpwnam('user')
base = pathlib.Path('/tmp/mship-kernel-proof')
base.mkdir(mode=0o777)
base.chmod(0o777)
processes = []
def run(job):
    process = subprocess.Popen(['/bin/bash', '-c', job['run']], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    processes.append(process)
    return process
def stop(job):
    result = subprocess.run(['/bin/bash', '-c', job['stop']], capture_output=True, timeout=5)
    assert result.returncode == 0, result.stderr.decode()
    assert json.loads(result.stdout) == {'settled': True}
def size(name):
    path = base / name
    return path.stat().st_size if path.exists() else 0
def started(name):
    for _ in range(300):
        if size(name):
            return
        time.sleep(0.01)
    raise AssertionError('writer did not start: ' + name)

try:
    if expect_no_namespaces:
        refused = run(jobs['first'])
        output, error = refused.communicate(timeout=3)
        assert refused.returncode != 0 and b'Operation not permitted' in error, error
        stop(jobs['first'])
        assert size('first') == 0
        print(json.dumps({'ok': True, 'missingNamespaceCapabilityRefusesUserCode': True}))
        raise SystemExit(0)
    stop(jobs['late'])
    late = run(jobs['late'])
    late.communicate(timeout=3)
    assert late.returncode != 0 and size('late') == 0
    first, sibling = run(jobs['first']), run(jobs['sibling'])
    started('first')
    started('sibling')
    assert (base / 'first').stat().st_uid == owner.pw_uid
    duplicate = run(jobs['first'])
    duplicate.communicate(timeout=3)
    assert duplicate.returncode != 0
    stop(jobs['first'])
    first.communicate(timeout=3)
    stopped_count, sibling_count = size('first'), size('sibling')
    time.sleep(0.08)
    assert size('first') == stopped_count and size('sibling') > sibling_count
    assert (base / 'first').read_text() == 'x' * stopped_count
    for name in ['empty', 'unicode', 'root', 'normal-exit', 'reap-orphans']:
        normal = run(jobs[name])
        output, error = normal.communicate(timeout=3)
        assert normal.returncode == 0, error.decode()
        stop(jobs[name])
        if name == 'unicode':
            assert output.decode() == 'héllo 世界\n/home/user|user|/home/user', output
        if name == 'root':
            assert output.strip() == b'0'
        if name == 'normal-exit':
            count = size(name)
            time.sleep(0.08)
            assert size(name) == count

    launcher = run(jobs['launcher-death'])
    started('launcher-death')
    launcher.kill()
    launcher.communicate(timeout=3)
    count = size('launcher-death')
    time.sleep(0.08)
    assert size('launcher-death') == count
    stop(jobs['launcher-death'])

    controller = os.fork()
    if controller == 0:
        subprocess.Popen(['/bin/bash', '-c', jobs['controller-death']['run']],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os._exit(0)
    os.waitpid(controller, 0)
    started('controller-death')
    stop(jobs['controller-death'])
    count = size('controller-death')
    time.sleep(0.08)
    assert size('controller-death') == count

    # A recycled host PID must not kill an unrelated running command.
    sibling_state = json.loads(pathlib.Path('/run/sim-mship-processes/v1', jobs['sibling']['id'] + '.json').read_text())
    stale = pathlib.Path('/run/sim-mship-processes/v1', jobs['stale-pid']['id'] + '.json')
    stale.write_text(json.dumps(dict(sibling_state, start='0')))
    count = size('sibling')
    stop(jobs['stale-pid'])
    time.sleep(0.08)
    assert size('sibling') > count

    for index in range(20):
        name = 'race' + str(index)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            pending_run = pool.submit(run, jobs[name])
            stopped = pool.submit(stop, jobs[name])
            stopped.result()
            observed = size(name)
            time.sleep(0.02)
            assert size(name) == observed, 'execution started after Stop acknowledgement'
            pending_run.result().communicate(timeout=3)
    print(json.dumps({'ok': True, 'actualModuleCommands': True, 'lateLaunchRefused': True,
        'concurrentStopLaunchRaces': 20, 'duplicateLaunchRefused': True,
        'detachedDescendantStopped': True, 'parallelSiblingContinues': True,
        'normalUserFileOwnership': True, 'filesPreserved': True, 'launcherDeathKillsDescendants': True,
        'controllerDeathRecovery': True, 'stalePidDoesNotKillSibling': True,
        'emptyAndUnicodeCommands': True, 'homeUserCwdPreserved': True, 'trustedRootCommand': True,
        'normalExitKillsDetachedChildren': True, 'orphanedChildrenReaped': True}))
finally:
    for job in jobs.values():
        stop(job)
    for process in processes:
        process.communicate(timeout=3)
