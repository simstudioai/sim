import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Exercises the complete preflight with deterministic AWS and Trigger responses. */
const harness = `
import importlib.util, json, os, sys, urllib.parse
spec = importlib.util.spec_from_file_location('rollout', sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
f = json.load(sys.stdin)
digest = 'sha256:' + 'a' * 64
commit = 'a' * 40
old_commit = 'b' * 40
current = {'pipelineExecutionId': 'current', 'startTime': 2, 'status': 'Succeeded',
           'sourceRevisions': [{'actionName': 'ECR_Source', 'revisionId': digest}]}
pending = {**current, 'pipelineExecutionId': 'newer', 'startTime': 3, 'status': 'InProgress'}
aws_reads = 0
worker_reads = 0
queries = []
def aws(region, *args):
    global aws_reads
    action = args[1]
    if action == 'list-pipeline-executions':
        aws_reads += 1
        history = [current, {**current, 'pipelineExecutionId': 'older', 'startTime': 1}]
        if f.get('pending') or (f.get('appRace') and aws_reads > 3): history.append(pending)
        return {'pipelineExecutionSummaries': history}
    if action == 'describe-images':
        return {'imageDetails': [{'imageDigest': digest, 'imageTags': f.get('imageTags', [commit])}]}
    if action == 'get-deployment-group':
        return {'deploymentGroupInfo': {'ecsServices': [{'clusterName': 'cluster', 'serviceName': 'service'}]}}
    if action == 'describe-services':
        return {'services': [{'desiredCount': 1, 'runningCount': 1, 'pendingCount': 0}]}
    if action == 'list-tasks':
        return {'taskArns': ['app'] if args[-1] == 'RUNNING' else (['old'] if f.get('stoppingTask') else [])}
    if action == 'describe-tasks':
        tasks = [{'lastStatus': 'RUNNING', 'desiredStatus': 'RUNNING', 'containers': [{'name': 'app', 'imageDigest': digest}]}]
        if f.get('stoppingTask'): tasks.append({'lastStatus': 'STOPPING', 'desiredStatus': 'STOPPED', 'containers': []})
        return {'tasks': tasks}
    raise AssertionError(args)
def deployment(version, sha):
    return {'id': 'dp_' + version, 'version': version, 'status': 'DEPLOYED',
            'git': {'source': 'github_actions', 'remoteUrl': 'https://github.com/simstudioai/sim', 'commitSha': sha}}
def api(path, token, body=None):
    global worker_reads
    if path.endswith('/jwt'):
        assert path == '/api/v1/projects/proj_fixture/staging/jwt'
        assert body['claims']['scopes'] == ['read:runs', 'read:deployments']
        return {'token': 'temporary-read-token', 'environmentId': 'staging-env'}
    if path == '/api/v1/deployments/current':
        worker_reads += 1
        d = deployment('20261012.20', old_commit if f.get('oldPromoted') else commit)
        if f.get('workerRace') and worker_reads > 1: d['id'] = 'changed'
        if f.get('wrongRepo'): d['git']['remoteUrl'] = 'https://github.com/other/repo'
        return d
    if path.startswith('/api/v1/runs?'):
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)
        queries.append(query)
        assert query['filter[taskIdentifier]'] == ['process-outbox']
        assert query['filter[createdAt][from]'] == ['1970-01-01T00:00:00Z']
        assert 'FROZEN' in query['filter[status]'][0] and 'REATTEMPTING' in query['filter[status]'][0]
        if f.get('badPagination'): return {'data': []}
        if f.get('secondPage') and 'page[after]' not in query:
            return {'data': [], 'pagination': {'next': 'second'}}
        runs = [] if not f.get('runStatus') else [{'id': 'run_fixture', 'taskIdentifier': 'process-outbox',
                   'env': {'id': 'production-env' if f.get('wrongEnv') else 'staging-env'}}]
        return {'data': runs, 'pagination': {}}
    if path == '/api/v3/runs/run_fixture':
        return {'id': 'run_fixture', 'taskIdentifier': 'process-outbox', 'status': f['runStatus'],
                'version': None if f.get('unbound') else ('20261009.1' if f.get('oldRun') else '20261012.20')}
    if path.startswith('/api/v1/deployments?'):
        return {'data': [deployment('20261009.1', old_commit)], 'pagination': {}}
    raise AssertionError(path)
m.aws = aws
m.trigger_api = api
m.compatible_commit = lambda sha: sha == commit
os.environ['TRIGGER_ACCESS_TOKEN'] = 'fixture-token'
os.environ['TRIGGER_PROJECT_ID'] = 'proj_fixture'
try:
    m.verify('staging', 'us-east-1', 'app-repository')
    if f.get('secondPage'): assert len(queries) == 2
except RuntimeError as error:
    print(str(error), file=sys.stderr)
    sys.exit(1)
`

interface Fixture {
  pending?: boolean
  appRace?: boolean
  workerRace?: boolean
  stoppingTask?: boolean
  oldPromoted?: boolean
  wrongRepo?: boolean
  wrongEnv?: boolean
  badPagination?: boolean
  secondPage?: boolean
  runStatus?: string
  unbound?: boolean
  oldRun?: boolean
  imageTags?: string[]
}

function verify(fixture: Fixture) {
  return spawnSync(
    'python3',
    ['-c', harness, resolve('.github/scripts/check-project-rollout.py')],
    {
      encoding: 'utf8',
      input: JSON.stringify(fixture),
      timeout: 10_000,
    }
  )
}

describe('automatic Project rollout verification', () => {
  it.each<Fixture>([{}, { runStatus: 'EXECUTING' }, { runStatus: 'COMPLETED', oldRun: true }])(
    'accepts a compatible deployment and ignores terminal stale list entries: %j',
    (fixture) => {
      const result = verify(fixture)
      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({
        environment: 'staging',
        ecsRetired: true,
        pipelineExecutionId: 'current',
        workers: { tasks: ['process-outbox'], version: '20261012.20' },
      })
      expect(result.stdout).not.toContain('operatorAcknowledged')
    }
  )

  it.each<[Fixture, string]>([
    [{ pending: true }, 'Latest app deployment has not succeeded'],
    [{ imageTags: ['staging'] }, 'unambiguous compatible commit'],
    [{ imageTags: ['b'.repeat(40)] }, 'unambiguous compatible commit'],
    [{ stoppingTask: true }, 'Old, stopping, or pending ECS tasks remain'],
    [{ appRace: true }, 'latest app pipeline has not completed'],
    [{ workerRace: true }, 'Promoted worker changed'],
    [{ oldPromoted: true }, 'lacks #8830'],
    [{ wrongRepo: true }, 'Git repository'],
    [{ badPagination: true }, 'Incomplete Trigger pagination'],
    [{ runStatus: 'EXECUTING', wrongEnv: true }, 'Cannot establish environment'],
    [{ runStatus: 'PENDING_VERSION', unbound: true }, 'no bound version'],
    [{ runStatus: 'UNKNOWN' }, 'Unknown worker status'],
    [{ runStatus: 'QUEUED', oldRun: true, secondPage: true }, 'incompatible membership run'],
    [{ runStatus: 'REATTEMPTING', oldRun: true }, 'incompatible membership run'],
    [{ runStatus: 'FROZEN', oldRun: true }, 'incompatible membership run'],
    [{ runStatus: 'DELAYED', oldRun: true }, 'incompatible membership run'],
  ])('fails closed for %j', (fixture, message) => {
    const result = verify(fixture)
    expect(result.status, result.stdout).toBe(1)
    expect(result.stderr).toContain(message)
  })
})
