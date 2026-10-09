#!/usr/bin/env python3
"""Read-only, fail-closed ECS retirement check for the Project column contract migration.

The expected digest acknowledges the fully deployed #8830 column-only readers/writers,
including retirement of pre-8830 servers and relevant old worker jobs. No live or supported
rollback application may still access project_workspace when the contract removes it.
AWS checks below independently verify ECS retirement, not worker drainage.
"""
import argparse
import datetime
import json
import re
import subprocess
import sys


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


def verify(environment, region, digest):
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
        raise RuntimeError('Set the environment-specific PROJECT_COLUMN_ENFORCEMENT_READY_IMAGE_DIGEST after verifying #8830 column-only readers/writers and pre-8830 server/worker drainage')
    pipeline = f'sim-{environment}-{region}-app-deployment'
    execution = latest_execution(region, pipeline)
    if not matches_release(execution, digest):
        raise RuntimeError('The latest app pipeline has not completed for the acknowledged image; traffic cutover alone is insufficient')
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
            raise RuntimeError('A live ECS task does not match the acknowledged compatible release')
    latest = latest_execution(region, pipeline)
    if latest.get('pipelineExecutionId') != execution_id or not matches_release(latest, digest):
        raise RuntimeError('Application deployment changed during preflight')
    print(json.dumps({'ecsRetired': True, 'expectedImageDigest': digest, 'pipelineExecutionId': execution_id,
                      'operatorAcknowledgedColumnWritersAndWorkers': True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--environment', required=True, choices=['production', 'staging'])
    parser.add_argument('--region', required=True)
    parser.add_argument('--expected-image-digest', required=True)
    args = parser.parse_args()
    try:
        verify(args.environment, args.region, args.expected_image_digest)
    except (RuntimeError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        print(f'Project column rollout preflight refused: {error}', file=sys.stderr)
        sys.exit(1)
