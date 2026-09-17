"""Exercise the deployment gates with scripted AWS responses; no live mutations."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parent
DIGEST = 'sha256:' + 'a' * 64
OTHER_DIGEST = 'sha256:' + 'b' * 64


def execution(start=1000, digest=DIGEST, identifier='execution-current'):
    return {
        'startTime': start,
        'pipelineExecutionId': identifier,
        'sourceRevisions': [{'actionName': 'ECR_Source', 'revisionId': digest}],
    }


def deploy_action(identifier='action-current', start=1000, status='InProgress'):
    return {'actionName': 'Deploy_to_ECS', 'actionExecutionId': identifier,
            'startTime': start, 'status': status, 'output': {}}


def deploy_state(execution_id='execution-current', action_id='action-current', deployment_id='d-current'):
    return {'latestExecution': {'pipelineExecutionId': execution_id}, 'actionStates': [
        {'actionName': 'Deploy_to_ECS', 'latestExecution': {
            'actionExecutionId': action_id, 'externalExecutionId': deployment_id, 'status': 'InProgress'}}]}


class DeploymentGateTests(unittest.TestCase):
    def run_script(self, script, args, responses):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / 'responses.json'
            fixture.write_text(json.dumps(responses))
            (root / 'aws').write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ['FIXTURE_DIR'])
args = sys.argv[1:]
if args[0] == '--cli-connect-timeout':
    args = args[4:]
service, operation = args[:2]
key = operation
if operation == 'get-deployment-target':
    key += ':' + args[args.index('--target-id') + 1]
with (root / 'calls').open('a') as stream:
    stream.write(' '.join(args) + '\\n')
responses = json.loads((root / 'responses.json').read_text())
if key not in responses:
    raise SystemExit('Unexpected AWS call: ' + key)
response = responses[key]
# Objects model steady state; lists are finite, ordered expectations.
if isinstance(response, list):
    if not response:
        raise SystemExit('Unexpected extra AWS call: ' + key)
    next_response = response.pop(0)
    (root / 'responses.json').write_text(json.dumps(responses))
    response = next_response
if response.get('error'):
    sys.stderr.write(response['error'])
    sys.exit(254)
if response.get('advance_clock'):
    clock = root / 'clock'
    value = int(clock.read_text()) if clock.exists() else 1000
    clock.write_text(str(value + response['advance_clock']))
print(response.get('text', json.dumps(response.get('json'))))
''')
            (root / 'docker').write_text('''#!/usr/bin/env python3
import os, pathlib, sys
root = pathlib.Path(os.environ['FIXTURE_DIR'])
with (root / 'calls').open('a') as stream:
    stream.write('docker ' + ' '.join(sys.argv[1:]) + '\\n')
''')
            (root / 'date').write_text('''#!/usr/bin/env python3
import os, pathlib
path = pathlib.Path(os.environ['FIXTURE_DIR']) / 'clock'
value = int(path.read_text()) if path.exists() else 1000
path.write_text(str(value + 1))
print(value)
''')
            (root / 'sleep').write_text('#!/bin/sh\nexit 0\n')
            for name in ('aws', 'date', 'sleep', 'docker'):
                (root / name).chmod(0o755)
            result = subprocess.run(
                ['bash', str(SCRIPTS / script), *args],
                env={**os.environ, 'PATH': f'{root}:{os.environ["PATH"]}',
                     'FIXTURE_DIR': str(root), 'POLL_INTERVAL': '1', 'OVERALL_TIMEOUT': '12',
                     'GITHUB_OUTPUT': str(root / 'outputs')},
                capture_output=True, text=True, timeout=10,
            )
            calls = (root / 'calls').read_text() if (root / 'calls').exists() else ''
            result.github_output = (root / 'outputs').read_text() if (root / 'outputs').exists() else ''
            return result, calls

    def poll(self, updates=None, since='1000'):
        responses = {
            'list-pipeline-executions': {'json': [execution()]},
            'get-pipeline-execution': {'text': 'InProgress'},
            'get-pipeline-state': {'json': deploy_state()},
            'list-action-executions': {'json': [deploy_action()]},
            'get-deployment': {'text': 'InProgress'},
            'list-deployment-targets': {'text': 'target-one\ttarget-two'},
            'get-deployment-target:target-one': {'text': 'Succeeded'},
            'get-deployment-target:target-two': {'text': 'Succeeded'},
        }
        responses.update(updates or {})
        return self.run_script('wait-for-ecs-cutover.sh', ['app-pipeline', DIGEST, since], responses)

    def test_waits_for_every_target(self):
        targets = ('target-one', 'target-two')
        for pending_target in targets:
            with self.subTest(pending_target=pending_target):
                result, calls = self.poll({f'get-deployment-target:{pending_target}': [
                    {'text': 'InProgress'}, {'text': 'Succeeded'}]})
                self.assertEqual(result.returncode, 0, result.stderr)
                for target in targets:
                    self.assertEqual(calls.count(f'--target-id {target}'), 2)

    def test_rejects_stale_execution_inside_former_clock_skew_window(self):
        result, calls = self.poll({'list-pipeline-executions': {'json': [execution(start=999)]}})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('timed out', result.stdout)
        self.assertNotIn('get-pipeline-execution ', calls)

    def test_chooses_newest_matching_execution(self):
        result, calls = self.poll({'list-pipeline-executions': {'json': [
            execution(1000, identifier='execution-old'), execution(1001)]}})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('--pipeline-execution-id execution-current', calls)

    def test_changed_image_rejects_newer_different_execution(self):
        result, calls = self.poll({'list-pipeline-executions': {'json': [
            execution(), execution(1001, digest=OTHER_DIGEST, identifier='execution-newer')]}})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('deployment was superseded', result.stderr)
        self.assertNotIn('get-pipeline-execution ', calls)

    def test_rechecks_latest_digest_after_cutover(self):
        result, calls = self.poll({'list-pipeline-executions': [
            {'json': [execution()]},
            {'json': [execution(), execution(1001, digest=OTHER_DIGEST, identifier='execution-newer')]},
        ]})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('deployment was superseded', result.stderr)
        self.assertIn('get-deployment-target ', calls)
        self.assertNotIn('Traffic cutover complete', result.stdout)

    def test_rechecks_execution_identity_for_same_digest_after_cutover(self):
        result, _ = self.poll({'list-pipeline-executions': [
            {'json': [execution()]},
            {'json': [execution(), execution(1001, identifier='execution-newer')]},
        ]})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('newer pipeline execution appeared', result.stdout)
        self.assertNotIn('Traffic cutover complete', result.stdout)

    def test_iso_timestamps(self):
        result, _ = self.poll({'list-pipeline-executions': {'json': [
            execution('1970-01-01T00:16:40+00:00')]}})
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_scripted_responses_reject_unexpected_extra_calls(self):
        result, _ = self.poll({'list-pipeline-executions': [{'json': [execution()]}]})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Unexpected extra AWS call: list-pipeline-executions', result.stderr)
        self.assertNotIn('Traffic cutover complete', result.stdout)

    def test_access_denial_fails_immediately(self):
        result, calls = self.poll({'list-pipeline-executions': {'error': 'AccessDeniedException'}})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('AccessDeniedException', result.stderr)
        self.assertEqual(len(calls.splitlines()), 1)

    def test_credentials_expiring_during_target_poll_fail(self):
        result, _ = self.poll({'get-deployment-target:target-two': {'error': 'ExpiredToken'}})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('ExpiredToken', result.stderr)

    def test_failed_and_superseded_pipeline_never_reach_deployment(self):
        for status in ('Failed', 'Stopped', 'Superseded'):
            with self.subTest(status=status):
                result, calls = self.poll({'get-pipeline-execution': {'text': status}})
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('get-deployment ', calls)

    def test_waits_for_queued_deploy_action(self):
        result, calls = self.poll({'list-action-executions': [
            {'json': []}, {'json': [deploy_action()]}]})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls.count('list-action-executions '), 2)

    def test_finds_live_deployment_before_action_history_has_output(self):
        result, calls = self.poll()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('get-pipeline-state --name app-pipeline', calls)
        self.assertIn('get-deployment --deployment-id d-current', calls)
        self.assertIn('Traffic cutover complete', result.stdout)

    def test_waits_for_state_from_the_exact_pipeline_and_action(self):
        for stale in (None, deploy_state(execution_id='execution-old'),
                      deploy_state(action_id='action-old'), deploy_state(deployment_id='')):
            with self.subTest(stale=stale):
                result, calls = self.poll({'get-pipeline-state': [
                    {'json': stale}, {'json': deploy_state()}]})
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(calls.count('get-pipeline-state '), 2)
                self.assertEqual(calls.count('get-deployment '), 1)

    def test_old_live_action_cannot_satisfy_a_retry(self):
        result, calls = self.poll({
            'list-action-executions': {'json': [deploy_action(), deploy_action('action-old', start=999)]},
            'get-pipeline-state': [
                {'json': deploy_state(action_id='action-old', deployment_id='d-old')},
                {'json': deploy_state()}],
        })
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('--deployment-id d-old', calls)

    def test_live_retry_waits_for_history_to_include_the_same_attempt(self):
        for previous_status in ('Failed', 'Abandoned'):
            with self.subTest(previous_status=previous_status):
                previous = deploy_action('action-old', start=999, status=previous_status)
                result, calls = self.poll({
                    'list-action-executions': [
                        {'json': [previous]},
                        {'json': [previous, deploy_action()]},
                    ],
                })
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(calls.count('get-pipeline-state '), 2)
                self.assertEqual(calls.count('get-deployment '), 1)
                self.assertIn('get-deployment --deployment-id d-current', calls)

    def test_bad_live_state_and_failed_actions_fail_closed(self):
        for updates in (
            {'get-pipeline-state': {'error': 'AccessDeniedException'}},
            {'get-pipeline-state': {'json': deploy_state(deployment_id='wrong-provider-id')}},
            {'list-action-executions': {'json': [deploy_action(status='Failed')]}},
        ):
            with self.subTest(updates=updates):
                result, calls = self.poll(updates)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('get-deployment ', calls)

    def test_failed_deployment_never_accepts_old_cutover(self):
        result, calls = self.poll({'get-deployment': {'text': 'Failed'}})
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('get-deployment-target ', calls)

    def test_empty_targets_cannot_satisfy_gate(self):
        result, _ = self.poll({'list-deployment-targets': {'text': ''}})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('timed out', result.stdout)

    def test_failed_target_fails_immediately(self):
        result, _ = self.poll({'get-deployment-target:target-two': {'text': 'Failed'}})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('cutover status Failed', result.stdout)

    def test_unchanged_image_verifies_existing_cutover(self):
        result, calls = self.poll({'list-pipeline-executions': {'json': [execution(start=900)]}}, since='0')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('get-deployment-target ', calls)

    def test_unchanged_image_rejects_latest_different_deploy(self):
        result, calls = self.poll({'list-pipeline-executions': {'json': [
            execution(start=900), execution(start=999, digest=OTHER_DIGEST)]}}, since='0')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('cutover is unverified', result.stderr)
        self.assertNotIn('get-deployment ', calls)

    def test_unchanged_image_rejects_failed_previous_deploy(self):
        result, _ = self.poll({'get-deployment': {'text': 'Failed'}}, since='0')
        self.assertNotEqual(result.returncode, 0)

    def test_invalid_metadata_fails_before_aws(self):
        result, calls = self.poll(since='corrupted')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, '')

    def test_ecr_digest_and_missing_tag(self):
        result, _ = self.run_script('get-ecr-image-digest.sh', ['app', 'deploy'], {
            'batch-get-image': {'json': {'images': [{'imageId': {'imageDigest': DIGEST}}], 'failures': []}}})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), DIGEST)
        missing = {'batch-get-image': {'json': {'images': [], 'failures': [{'failureCode': 'ImageNotFound'}]}}}
        result, _ = self.run_script('get-ecr-image-digest.sh', ['app', 'deploy', '--allow-missing'], missing)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), '')
        result, _ = self.run_script('get-ecr-image-digest.sh', ['app', 'deploy'], missing)
        self.assertNotEqual(result.returncode, 0)

    def test_ecr_response_failures_are_not_missing_images(self):
        for response in ({'error': 'AccessDeniedException'}, {'json': {'images': [], 'failures': [{'failureCode': 'KmsError'}]}}, {'json': {'images': [], 'failures': []}}):
            with self.subTest(response=response):
                result, _ = self.run_script('get-ecr-image-digest.sh', ['app', 'deploy', '--allow-missing'], {'batch-get-image': response})
                self.assertNotEqual(result.returncode, 0)

    def test_tag_move_uses_push_boundary_and_final_manifest_digest(self):
        result, calls = self.run_script('promote-app-image.sh', ['registry', 'app', 'commit-dev', 'dev'], {
            'batch-get-image': [
                {'advance_clock': 30, 'json': {'images': [{'imageId': {'imageDigest': DIGEST}}], 'failures': []}},
                {'json': {'images': [{'imageId': {'imageDigest': OTHER_DIGEST}}], 'failures': []}},
            ]})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('retag_epoch=1030', result.github_output)
        self.assertIn(f'app_image_digest={OTHER_DIGEST}', result.github_output)
        self.assertIn('app_image_changed=true', result.github_output)
        self.assertEqual([line.split()[0] for line in calls.splitlines()], ['ecr', 'docker', 'ecr'])
        self.assertIn('registry/app:commit-dev', calls)

    def test_tag_move_aborts_before_docker_when_ecr_read_fails(self):
        result, calls = self.run_script('promote-app-image.sh', ['registry', 'app', 'commit', 'deploy'], {
            'batch-get-image': {'error': 'AccessDeniedException'}})
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('docker', calls)
        self.assertEqual(result.github_output, '')

    def test_same_digest_tag_move_reports_unchanged(self):
        result, _ = self.run_script('promote-app-image.sh', ['registry', 'app', 'commit', 'deploy'], {
            'batch-get-image': {'json': {'images': [{'imageId': {'imageDigest': DIGEST}}], 'failures': []}}})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('app_image_changed=false', result.github_output)


class ReleaseOrderingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        workflow = SCRIPTS.parent / 'workflows' / 'ci.yml'
        parsed = subprocess.run([
            'bun', '-e', 'console.log(JSON.stringify(Bun.YAML.parse(await Bun.file(process.argv[1]).text())))',
            str(workflow)], check=True, capture_output=True, text=True)
        cls.jobs = json.loads(parsed.stdout)['jobs']

    def eligible(self, job, branch, results, event='push', cancelled=False, promoted='true'):
        expression = self.jobs[job]['if']
        expression = re.sub(r'needs\.([\w-]+)\.result', lambda m: repr(results[m[1]]), expression)
        expression = expression.replace('needs.promote-images.outputs.promoted', repr(promoted))
        expression = expression.replace('github.ref', repr('refs/heads/' + branch))
        expression = expression.replace('github.event_name', repr(event))
        expression = expression.replace('!cancelled()', repr(not cancelled))
        expression = expression.replace('&&', ' and ').replace('||', ' or ')
        return eval(' '.join(expression.split()), {'__builtins__': {}})

    def release_results(self, branch):
        active = ('migrate-dev', 'build-dev', 'deploy-trigger-dev') if branch == 'dev' else (
            'migrate', 'build-amd64', 'deploy-trigger')
        results = {name: 'success' if name in active else 'skipped'
                   for name in self.jobs['promote-images']['needs']}
        return active, results

    def test_uploads_and_image_builds_can_start_before_migration(self):
        for job in ('deploy-trigger', 'deploy-trigger-dev', 'build-amd64', 'build-dev'):
            self.assertFalse(self.jobs[job].get('needs'), job)
        for job in ('deploy-trigger', 'deploy-trigger-dev'):
            upload = next(step for step in self.jobs[job]['steps'] if step.get('id') == 'deploy')
            self.assertIn('--skip-promotion', upload['run'])

    def test_each_release_waits_for_all_three_gates(self):
        for branch in ('main', 'staging', 'dev'):
            active, ready = self.release_results(branch)
            self.assertTrue(self.eligible('promote-images', branch, ready))
            for gate in active:
                self.assertIn(gate, self.jobs['promote-images']['needs'])
                for failure in ('failure', 'cancelled', 'skipped'):
                    with self.subTest(branch=branch, gate=gate, result=failure):
                        self.assertFalse(self.eligible('promote-images', branch, {**ready, gate: failure}))
            self.assertFalse(self.eligible('promote-images', branch, ready, cancelled=True))
            self.assertFalse(self.eligible('promote-images', branch, ready, event='pull_request'))

    def test_migrations_still_require_successful_tests(self):
        self.assertIn('test-build', self.jobs['migrate']['needs'])
        for branch in ('main', 'staging'):
            self.assertTrue(self.eligible('migrate', branch, {'test-build': 'success'}))
            for result in ('failure', 'cancelled', 'skipped'):
                self.assertFalse(self.eligible('migrate', branch, {'test-build': result}))

    def test_dev_build_cannot_move_deploy_tags(self):
        steps = self.jobs['build-dev']['steps']
        build = next(step for step in steps if step.get('uses') == './.github/actions/docker-build')
        self.assertTrue(build['with']['tags'].endswith(':${{ github.sha }}-dev'))
        self.assertNotIn('promote-app-image.sh', json.dumps(steps))
        self.assertNotIn('imagetools create', json.dumps(steps))

    def test_task_promotion_requires_a_successful_fresh_app_release(self):
        for branch, job, upload in (('main', 'promote-trigger', 'deploy-trigger'),
                                    ('staging', 'promote-trigger', 'deploy-trigger'),
                                    ('dev', 'promote-trigger-dev', 'deploy-trigger-dev')):
            ready = {'promote-images': 'success', upload: 'success'}
            self.assertIn('promote-images', self.jobs[job]['needs'])
            self.assertTrue(self.eligible(job, branch, ready))
            self.assertFalse(self.eligible(job, branch, ready, promoted='false'))
            self.assertFalse(self.eligible(job, branch, {**ready, 'promote-images': 'failure'}))
            steps = self.jobs[job]['steps']
            wait = next(i for i, step in enumerate(steps) if 'wait-for-ecs-cutover.sh' in step.get('run', ''))
            promote = next(i for i, step in enumerate(steps) if 'promote "$VERSION"' in step.get('run', ''))
            self.assertLess(wait, promote)
            self.assertEqual(steps[promote]['env']['VERSION'], '${{ needs.' + upload + '.outputs.version }}')

    def test_permission_check_and_other_images_precede_app_rollout(self):
        steps = self.jobs['promote-images']['steps']
        preflight = next(i for i, step in enumerate(steps) if 'get-pipeline-state' in step.get('run', ''))
        retag = next(i for i, step in enumerate(steps) if step.get('id') == 'promote')
        self.assertLess(preflight, retag)
        self.assertTrue(steps[retag]['env']['ECR_REPOS'].strip().endswith('${{ secrets.ECR_APP }}'))


if __name__ == '__main__':
    unittest.main()
