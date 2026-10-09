#!/usr/bin/env python3
"""Offline Electron regression for background AX value editing and explicit focus recovery.

Start an inactive fixture with electron-live.py <helper> --launch-only --artifacts <new-dir>.
Then run this script with <helper> --state <new-dir>/state.json --report <report.json>.
The fixture must already be inactive; this test never focuses an unrelated app to arrange it.
It submits exactly one synthetic local message, relative to the existing submission baseline.
"""
import argparse
import importlib.util
import json
import pathlib
import time
import uuid

SOURCE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('electron_live', SOURCE / 'electron-live.py')
fixture_tools = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture_tools)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('helper')
    parser.add_argument('--state', required=True, type=pathlib.Path,
                        help='State file of an already running, inactive offline composer fixture')
    parser.add_argument('--report', required=True, type=pathlib.Path)
    args = parser.parse_args()
    helper = fixture_tools.Helper(args.helper)
    initial = fixture_tools.fixture_state(args.state)
    nonce = 'background-recovery-' + uuid.uuid4().hex[:12]
    report = {'passed': False, 'fixturePid': initial['pid'], 'checks': []}
    try:
        def active():
            apps = helper.call('list_apps')['apps']
            app = next(app for app in apps if app['bundleId'] == fixture_tools.BUNDLE)
            assert app['pid'] == initial['pid'], 'Fixture PID changed'
            return app['isActive']

        def editor():
            state = helper.state()
            target = fixture_tools.composer(state)
            assert target and target.get('editable'), 'Missing writable rich editor'
            return state, target

        assert not active(), 'Fixture must start in the background'
        snapshot, target = editor()
        reply = helper.reply('input_sequence', bundleId=fixture_tools.BUNDLE,
                             snapshotId=snapshot['snapshotId'], elementId=target['elementId'],
                             steps=[{'action': 'type_text', 'text': 'MUST NOT DISPATCH'},
                                    {'action': 'press_key', 'key': 'Enter'}])
        assert reply.get('error', {}).get('code') == 'activation_required', reply
        assert reply['error'].get('dispatchState') == 'not_started', reply
        unchanged = fixture_tools.fixture_state(args.state)
        assert all(unchanged[key] == initial[key]
                   for key in ['composer', 'sink', 'submissions', 'history'])
        assert not active(), 'Background rejection activated the fixture'
        report['checks'].append('background keyboard input rejected before dispatch with activation_required')

        snapshot, target = editor()
        helper.call('set_value', bundleId=fixture_tools.BUNDLE,
                    snapshotId=snapshot['snapshotId'], elementId=target['elementId'], value=nonce)
        time.sleep(0.2)
        changed = fixture_tools.fixture_state(args.state)
        snapshot, target = editor()
        background_value_verified = target.get('value') == nonce and changed['composer'] == nonce
        assert changed['submissions'] == initial['submissions'] and not active()
        report['backgroundSetValueVerified'] = background_value_verified
        if background_value_verified:
            report['checks'].append('background set_value verified in AX and fixture DOM')
            helper.call('set_value', bundleId=fixture_tools.BUNDLE,
                        snapshotId=snapshot['snapshotId'], elementId=target['elementId'], value=initial['composer'])
            fixture_tools.fixture_state(args.state, lambda state: state['composer'] == initial['composer'])
        else:
            assert changed['composer'] == initial['composer'] and target.get('value') != nonce
            report['checks'].append('background AX set_value success was an unverified no-op; no submission or activation')

        helper.call('activate_app', bundleId=fixture_tools.BUNDLE)
        snapshot, target = editor()
        helper.call('set_value', bundleId=fixture_tools.BUNDLE,
                    snapshotId=snapshot['snapshotId'], elementId=target['elementId'], value=nonce)
        time.sleep(0.2)
        snapshot, target = editor()
        foreground_state = fixture_tools.fixture_state(args.state)
        report['foregroundSetValueVerified'] = target.get('value') == nonce and foreground_state['composer'] == nonce
        assert foreground_state['submissions'] == initial['submissions']
        result = helper.call('input_sequence', bundleId=fixture_tools.BUNDLE,
                             snapshotId=snapshot['snapshotId'], elementId=target['elementId'],
                             steps=[{'action': 'press_key', 'key': 'Cmd+A'},
                                    {'action': 'type_text', 'text': nonce},
                                    {'action': 'press_key', 'key': 'Enter'}])
        assert result['sequence'] == {'completedSteps': 3, 'totalSteps': 3}, result
        final = fixture_tools.fixture_state(args.state,
                    lambda state: state['submissions'] == initial['submissions'] + 1)
        assert final['history'] == initial['history'] + [nonce]
        assert final['composer'] == '' and final['sink'] == initial['sink']
        time.sleep(0.15)
        assert fixture_tools.fixture_state(args.state)['submissions'] == final['submissions']
        snapshot, _ = editor()
        assert any(node.get('value') == f"Submissions: {final['submissions']}"
                   or node.get('label') == f"Submissions: {final['submissions']}"
                   for node in snapshot['nodes'])
        report['checks'].append('explicit activation and fresh observation recovered with exactly one local submission')
        report.update(passed=True, nonce=nonce, submissionsBefore=initial['submissions'],
                      submissionsAfter=final['submissions'])
    finally:
        helper.close()
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
