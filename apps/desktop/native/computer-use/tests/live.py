"""Strict live test: requires existing TCC grants; controls only our disposable fixture."""
import argparse
import base64
import json
import os
import pathlib
import plistlib
import selectors
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser()
parser.add_argument('helper', help='Packaged/signed SimComputerUse executable with existing user grants')
parser.add_argument('--allow-missing-screen', action='store_true', help='Run AX/input checks and explicitly report screenshot as blocked')
parser.add_argument('--existing-fixture', action='store_true', help='Use an already running disposable fixture and leave it open')
args = parser.parse_args()
source = pathlib.Path(__file__).resolve().parent
helper = subprocess.Popen([args.helper], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
fixture = None
selector = selectors.DefaultSelector()
selector.register(helper.stdout, selectors.EVENT_READ)
sequence = 0
bundle = 'com.mothership.computer-use-fixture'


def call(method, **params):
    global sequence
    sequence += 1
    helper.stdin.write(json.dumps({'id': str(sequence), 'method': method, 'params': params}) + '\n')
    helper.stdin.flush()
    if not selector.select(timeout=35):
        raise AssertionError('Native response timed out: ' + method)
    response = json.loads(helper.stdout.readline())
    assert response['id'] == str(sequence)
    if 'error' in response:
        raise AssertionError(method + ': ' + json.dumps(response['error']))
    return response['result']


def state(screenshot=False):
    return call('get_app_state', bundleId=bundle, includeScreenshot=screenshot)


def find(snapshot, role=None, label=None):
    return next(node for node in snapshot['nodes'] if (role is None or node['role'] == role) and (label is None or label in node.get('label', '')))


def mutate(method, snapshot, **params):
    result = call(method, bundleId=bundle, snapshotId=snapshot['snapshotId'], **params)
    assert result['dispatched'] and not result['verified']
    time.sleep(0.15)
    return state()


def coordinate(snapshot, node, fx=0.5, fy=0.5):
    window = next(w for w in snapshot['windows'] if w['windowId'] == snapshot['windowId'])
    return {'windowId': window['windowId'], 'x': node['x'] - window['x'] + node['width'] * fx, 'y': node['y'] - window['y'] + node['height'] * fy}


try:
    permissions = call('status')
    assert permissions['accessibility'], 'BLOCKED: Accessibility permission is missing.'
    assert permissions['screenRecording'] or args.allow_missing_screen, 'BLOCKED: Screen Recording permission is missing.'
    with tempfile.TemporaryDirectory(prefix='mship-computer-use-live-') as temporary:
        app = pathlib.Path(temporary) / 'Fixture.app'
        executable = app / 'Contents/MacOS/Fixture'
        executable.parent.mkdir(parents=True)
        (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': bundle, 'CFBundleName': 'Mothership Computer Use Fixture', 'CFBundleExecutable': 'Fixture', 'CFBundlePackageType': 'APPL', 'LSMinimumSystemVersion': '14.0'}))
        if not args.existing_fixture:
            subprocess.run(['swiftc', '-parse-as-library', str(source / 'Fixture.swift'), '-o', str(executable)], check=True)
            fixture = subprocess.Popen([str(executable)], stdout=open('/private/tmp/mship-fixture-events.log', 'w'), stderr=subprocess.DEVNULL)
            time.sleep(1)
        snapshot = state(screenshot=True)
        assert 'fixture-only-secret' not in json.dumps(snapshot), 'Secure value leaked'
        image = snapshot.get('screenshot')
        if permissions['screenRecording']:
            assert image and base64.b64decode(image['base64']).startswith(b'\x89PNG\r\n\x1a\n'), snapshot.get('screenshotError')
            pathlib.Path('/private/tmp/mship-computer-use-fixture.png').write_bytes(base64.b64decode(image['base64']))
        else:
            assert 'screen_capture_permission_required' in snapshot.get('screenshotError', '')
            print('BLOCKED: screenshot verification skipped because Screen Recording grant is missing', flush=True)
        baseline = int(next(node.get('value', node.get('label', '')) for node in snapshot['nodes'] if node.get('value', node.get('label', '')).startswith('Count: ')).split(': ')[1])
        button = find(snapshot, role='AXButton', label='Increment')
        snapshot = mutate('click', snapshot, elementId=button['elementId'])
        assert any(f'Count: {baseline + 1}' in node.get('value', '') or f'Count: {baseline + 1}' in node.get('label', '') for node in snapshot['nodes']), 'AX click did not increment counter'
        field = find(snapshot, role='AXTextField', label='Fixture editable text')
        snapshot = mutate('set_value', snapshot, elementId=field['elementId'], value='Mship α😀')
        assert find(snapshot, role='AXTextField', label='Fixture editable text')['value'] == 'Mship α😀'
        snapshot = mutate('type_text', snapshot, elementId=find(snapshot, role='AXTextField', label='Fixture editable text')['elementId'], text=' typed')
        assert ' typed' in find(snapshot, role='AXTextField', label='Fixture editable text')['value'], 'Unicode text event did not arrive'
        snapshot = mutate('press_key', snapshot, windowId=snapshot['windowId'], key='Cmd+A')
        snapshot = mutate('press_key', snapshot, windowId=snapshot['windowId'], key='Backspace')
        assert find(snapshot, role='AXTextField', label='Fixture editable text').get('value', '') == '', 'Keyboard chord did not clear text'
        snapshot = mutate('type_text', snapshot, elementId=find(snapshot, role='AXTextField', label='Fixture editable text')['elementId'], text='Verified 😀')
        assert find(snapshot, role='AXTextField', label='Fixture editable text')['value'] == 'Verified 😀'
        activation = call('activate_app', bundleId=bundle)
        assert activation['verified']
        snapshot = state()
        slider = find(snapshot, role='AXSlider')
        initial = float(slider['value'])
        start = coordinate(snapshot, slider, 0.25)
        end = coordinate(snapshot, slider, 0.8)
        snapshot = mutate('drag', snapshot, **start, toX=end['x'], toY=end['y'])
        assert float(find(snapshot, role='AXSlider')['value']) > initial + 10, 'Drag did not move slider'
        scroll = find(snapshot, role='AXScrollArea')
        snapshot = mutate('scroll', snapshot, **coordinate(snapshot, scroll), deltaX=0, deltaY=180)
        assert any((node.get('value', '').startswith('Scroll: ') and node['value'] != 'Scroll: 0') or (node.get('label', '').startswith('Scroll: ') and node['label'] != 'Scroll: 0') for node in snapshot['nodes']), 'Scroll did not move fixture content'
        button = find(snapshot, role='AXButton', label='Increment')
        snapshot = mutate('perform_action', snapshot, elementId=button['elementId'], accessibilityAction='AXPress')
        assert any(f'Count: {baseline + 2}' in node.get('value', '') or f'Count: {baseline + 2}' in node.get('label', '') for node in snapshot['nodes']), 'Explicit AX action did not increment'
        print('PASS: real fixture state, secure suppression, AX click/set/action, Unicode typing, keyboard chord, coordinate drag and scrolling; every mutation verified in fresh state; screenshot=' + ('verified' if permissions['screenRecording'] else 'BLOCKED'))
finally:
    if fixture:
        fixture.terminate()
        try:
            fixture.wait(timeout=3)
        except subprocess.TimeoutExpired:
            fixture.kill()
    helper.stdin.close()
    helper.terminate()
    try:
        helper.wait(timeout=3)
    except subprocess.TimeoutExpired:
        helper.kill()
    selector.close()
