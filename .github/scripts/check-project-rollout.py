#!/usr/bin/env python3
"""Discover and verify the compatible app and membership workers before Project contraction."""
import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request


def aws(region, *args):
    result = subprocess.run(
        ['aws', '--region', region, '--no-cli-pager', '--cli-connect-timeout', '10', '--cli-read-timeout', '30', *args, '--output', 'json'],
        capture_output=True, text=True, timeout=90, check=False,
    )
    if result.returncode:
        raise RuntimeError('AWS preflight read failed; check deployment-read permissions')
    return json.loads(result.stdout)


def latest_execution(region, pipeline):
    executions = aws(region, 'codepipeline', 'list-pipeline-executions', '--pipeline-name', pipeline).get('pipelineExecutionSummaries', [])
    def epoch(execution):
        value = execution['startTime']
        return value if isinstance(value, (int, float)) else datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
    if not executions:
        raise RuntimeError('No application deployment execution was found')
    return max(executions, key=epoch)


def matches_release(execution, digest):
    return execution.get('status') == 'Succeeded' and any(
        revision.get('actionName') == 'ECR_Source' and revision.get('revisionId') == digest
        for revision in execution.get('sourceRevisions', [])
    )


def verify_ecs(environment, region, digest):
    pipeline = f'sim-{environment}-{region}-app-deployment'
    execution = latest_execution(region, pipeline)
    if not matches_release(execution, digest):
        raise RuntimeError('The latest app pipeline has not completed for the discovered image; traffic cutover alone is insufficient')
    execution_id = execution['pipelineExecutionId']
    group = aws(region, 'deploy', 'get-deployment-group', '--application-name', f'sim-{environment}-{region}-ecs-app',
                '--deployment-group-name', f'sim-{environment}-{region}-app-dg')['deploymentGroupInfo']
    services = group.get('ecsServices', [])
    if len(services) != 1:
        raise RuntimeError('Expected exactly one application ECS service')
    cluster, service = services[0]['clusterName'], services[0]['serviceName']
    description = aws(region, 'ecs', 'describe-services', '--cluster', cluster, '--services', service)
    if description.get('failures') or len(description.get('services', [])) != 1:
        raise RuntimeError('Cannot inspect the application ECS service')
    record = description['services'][0]
    if record.get('desiredCount', 0) < 1 or record.get('runningCount') != record['desiredCount'] or record.get('pendingCount') != 0:
        raise RuntimeError('Application ECS service is not stable')
    arns = set()
    for status in ('RUNNING', 'STOPPED'):
        arns.update(aws(region, 'ecs', 'list-tasks', '--cluster', cluster, '--service-name', service,
                        '--desired-status', status).get('taskArns', []))
    live = []
    ordered = sorted(arns)
    for start in range(0, len(ordered), 100):
        response = aws(region, 'ecs', 'describe-tasks', '--cluster', cluster, '--tasks', *ordered[start:start + 100])
        if response.get('failures'):
            raise RuntimeError('Cannot account for every ECS task')
        if len(response.get('tasks', [])) != len(ordered[start:start + 100]):
            raise RuntimeError('Incomplete ECS task response')
        live.extend(task for task in response['tasks'] if task.get('lastStatus') != 'STOPPED')
    if len(live) != record['desiredCount']:
        raise RuntimeError('Old, stopping, or pending ECS tasks remain')
    for task in live:
        app = [container for container in task.get('containers', []) if container.get('name') == 'app']
        if task.get('lastStatus') != 'RUNNING' or task.get('desiredStatus') != 'RUNNING' or len(app) != 1 or app[0].get('imageDigest') != digest:
            raise RuntimeError('A live ECS task does not match the discovered compatible release')
    latest = latest_execution(region, pipeline)
    if latest.get('pipelineExecutionId') != execution_id or not matches_release(latest, digest):
        raise RuntimeError('Application deployment changed during preflight')
    return execution_id


# #8830 introduced authority-aware transactions that survive connector retirement.
COMPATIBLE_COMMIT = '34925988ee6720d09cc80f537faab6155875984e'
# Outbox enterprise workspace moves/owner claims call Project membership mutations.
# Other tasks do not become membership writers merely by importing billing helpers.
MEMBERSHIP_TASKS = ('process-outbox',)
UNFINISHED_STATUSES = (
    'PENDING_VERSION', 'WAITING_FOR_DEPLOY', 'QUEUED', 'DEQUEUED', 'EXECUTING',
    'REATTEMPTING', 'FROZEN', 'WAITING', 'DELAYED',
)
TERMINAL_STATUSES = {
    'COMPLETED', 'CANCELED', 'FAILED', 'CRASHED', 'SYSTEM_FAILURE', 'EXPIRED',
    'TIMED_OUT', 'INTERRUPTED',
}


def compatible_commit(commit):
    if not isinstance(commit, str) or not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise RuntimeError('Release has no full Git commit SHA; cannot establish compatibility')
    result = subprocess.run(
        ['git', 'merge-base', '--is-ancestor', COMPATIBLE_COMMIT, commit],
        capture_output=True, timeout=30, check=False,
    )
    if result.returncode not in (0, 1):
        raise RuntimeError(f'Cannot resolve release {commit}; checkout must include full repository history')
    return result.returncode == 0


def trigger_api(path, token, body=None):
    request = urllib.request.Request(
        'https://api.trigger.dev' + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # Never echo response bodies: authentication responses can contain credentials.
        raise RuntimeError(f'Trigger API {error.code} for {path.split("?")[0]}; verify CI token access') from None
    except urllib.error.URLError:
        raise RuntimeError('Trigger API unavailable; worker readiness cannot be established') from None


def trigger_pages(path, token, filters=None):
    params = {'page[size]': '100', **(filters or {})}
    seen = set()
    for _ in range(1000):
        response = trigger_api(path + '?' + urllib.parse.urlencode(params), token)
        if not isinstance(response.get('data'), list) or not isinstance(response.get('pagination'), dict):
            raise RuntimeError('Incomplete Trigger pagination response')
        yield from response['data']
        cursor = response['pagination'].get('next')
        if not cursor:
            return
        if not isinstance(cursor, str) or cursor in seen:
            raise RuntimeError('Trigger pagination did not advance')
        seen.add(cursor)
        params['page[after]'] = cursor
    raise RuntimeError('Trigger page limit reached; refusing incomplete worker inventory')


def deployment_commit(deployment):
    git = deployment.get('git') or {}
    if deployment.get('status') != 'DEPLOYED' or git.get('dirty') is True:
        raise RuntimeError('Worker release is not a clean deployed build')
    if git.get('source') != 'github_actions':
        raise RuntimeError('Worker release is not attributable to the repository CI build')
    remote = git.get('remoteUrl', '')
    if remote not in ('https://github.com/simstudioai/sim', 'https://github.com/simstudioai/sim.git',
                      'git@github.com:simstudioai/sim.git'):
        raise RuntimeError('Worker release Git repository is missing or unexpected')
    return git.get('commitSha')


def verify_workers(environment):
    access_token, project = os.environ.get('TRIGGER_ACCESS_TOKEN'), os.environ.get('TRIGGER_PROJECT_ID')
    if not access_token or not project or not re.fullmatch(r'proj_[a-zA-Z0-9]+', project):
        raise RuntimeError('CI requires TRIGGER_ACCESS_TOKEN and TRIGGER_PROJECT_ID for worker verification')
    target = 'prod' if environment == 'production' else 'staging'
    auth = trigger_api(f'/api/v1/projects/{project}/{target}/jwt', access_token, {
        'claims': {'scopes': ['read:runs', 'read:deployments']}, 'expirationTime': '30m',
    })
    token, environment_id = auth.get('token'), auth.get('environmentId')
    if not token or not environment_id:
        raise RuntimeError('Trigger did not return an environment-scoped read token')
    current = trigger_api('/api/v1/deployments/current', token)
    commit = deployment_commit(current)
    if not compatible_commit(commit):
        raise RuntimeError(f'Promoted Trigger version {current.get("version")} lacks #8830 ({commit})')
    deployments = {current['version']: current}
    verified_versions = {current['version']}
    examined = 0
    for listed in trigger_pages('/api/v1/runs', token, {
        'filter[taskIdentifier]': ','.join(MEMBERSHIP_TASKS),
        'filter[status]': ','.join(UNFINISHED_STATUSES),
        # No default recent-only window: delayed or suspended work may be old.
        'filter[createdAt][from]': '1970-01-01T00:00:00Z',
    }):
        if listed.get('taskIdentifier') not in MEMBERSHIP_TASKS:
            raise RuntimeError('Trigger ignored the membership task filter')
        run_id = listed.get('id', '')
        if not re.fullmatch(r'run_[a-zA-Z0-9]+', run_id):
            raise RuntimeError('Trigger returned an invalid run identifier')
        # List indexes may lag; authoritative retrieval avoids stale executing rows.
        run = trigger_api(f'/api/v3/runs/{run_id}', token)
        if (listed.get('env') or {}).get('id') != environment_id:
            raise RuntimeError(f'Cannot establish environment for worker run {run_id}')
        if run.get('taskIdentifier') not in MEMBERSHIP_TASKS:
            raise RuntimeError(f'Unexpected task for worker run {run_id}')
        if run.get('status') in TERMINAL_STATUSES:
            continue
        if run.get('status') not in UNFINISHED_STATUSES:
            raise RuntimeError(f'Unknown worker status for {run_id}: {run.get("status")}')
        examined += 1
        version = run.get('version')
        if not version:
            raise RuntimeError(f'Unfinished membership run {run_id} has no bound version ({run.get("status")})')
        if version not in verified_versions:
            if version not in deployments:
                deployments.update({d['version']: d for d in trigger_pages('/api/v1/deployments', token)})
            if version not in deployments or not compatible_commit(deployment_commit(deployments[version])):
                raise RuntimeError(f'Unfinished incompatible membership run {run_id}, version {version}, status {run.get("status")}')
            verified_versions.add(version)
    latest = trigger_api('/api/v1/deployments/current', token)
    if latest.get('id') != current.get('id') or latest.get('version') != current.get('version'):
        raise RuntimeError('Promoted worker changed during verification; retry on a stable release')
    return {'environmentId': environment_id, 'version': current['version'], 'commit': commit,
            'tasks': MEMBERSHIP_TASKS, 'compatibleUnfinishedRuns': examined}


def verify(environment, region, repository):
    pipeline = f'sim-{environment}-{region}-app-deployment'
    execution = latest_execution(region, pipeline)
    digests = [r.get('revisionId') for r in execution.get('sourceRevisions', [])
               if r.get('actionName') == 'ECR_Source']
    if (execution.get('status') != 'Succeeded' or len(digests) != 1
            or not re.fullmatch(r'sha256:[0-9a-f]{64}', digests[0] or '')):
        raise RuntimeError('Latest app deployment has not succeeded with a verifiable ECR digest')
    digest = digests[0]
    images = aws(region, 'ecr', 'describe-images', '--repository-name', repository,
                 '--image-ids', f'imageDigest={digest}').get('imageDetails', [])
    if len(images) != 1 or images[0].get('imageDigest') != digest:
        raise RuntimeError('Deployed digest could not be resolved in the application ECR repository')
    commits = [tag for tag in images[0].get('imageTags', []) if re.fullmatch(r'[0-9a-f]{40}', tag)]
    if len(commits) != 1 or not compatible_commit(commits[0]):
        raise RuntimeError('Deployed app has no unambiguous compatible commit tag containing #8830')
    execution_id = verify_ecs(environment, region, digest)
    workers = verify_workers(environment)
    if verify_ecs(environment, region, digest) != execution_id:
        raise RuntimeError('App deployment changed while verifying workers')
    print(json.dumps({'environment': environment, 'ecsRetired': True, 'imageDigest': digest,
                      'appCommit': commits[0], 'pipelineExecutionId': execution_id, 'workers': workers}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--environment', required=True, choices=['production', 'staging'])
    parser.add_argument('--region', required=True)
    parser.add_argument('--app-repository', required=True)
    args = parser.parse_args()
    try:
        verify(args.environment, args.region, args.app_repository)
    except (RuntimeError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        print(f'Project column rollout preflight refused: {error}', file=sys.stderr)
        sys.exit(1)
