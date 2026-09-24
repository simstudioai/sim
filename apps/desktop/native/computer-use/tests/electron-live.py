"""Offline Electron acceptance: deep rich text, exactly-once submission, and focus-change abort.

Requires an already-authorized native helper. Creates and controls only a uniquely identified
local fixture. No production account, remote origin, network request, or system permission
mutation is used. Example:
  python3 tests/electron-live.py /private/tmp/candidate-helper --baseline-helper /path/to/old-helper
"""
import argparse
import base64
import json
import os
import pathlib
import plistlib
import selectors
import shutil
import struct
import subprocess
import tempfile
import time
import zlib

BUNDLE = 'com.mothership.computer-use-electron-fixture'
SOURCE = pathlib.Path(__file__).resolve().parent
REPO = SOURCE.parents[4]


class Helper:
    def __init__(self, executable):
        self.process = subprocess.Popen([executable], stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, text=True, bufsize=1)
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)
        self.sequence = 0

    def reply(self, method, **params):
        self.sequence += 1
        self.process.stdin.write(json.dumps({'id': str(self.sequence), 'method': method,
                                            'params': params}) + '\n')
        self.process.stdin.flush()
        if not self.selector.select(timeout=40):
            raise AssertionError('Native response timed out: ' + method)
        reply = json.loads(self.process.stdout.readline())
        assert reply['id'] == str(self.sequence), reply
        return reply

    def call(self, method, **params):
        reply = self.reply(method, **params)
        assert 'error' not in reply, {'method': method, 'error': reply.get('error')}
        return reply['result']

    def state(self, screenshot=False):
        return self.call('get_app_state', bundleId=BUNDLE, includeScreenshot=screenshot)

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=3)
        self.selector.close()


def fixture_state(path, predicate=lambda value: value.get('ready'), timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            value = json.loads(path.read_text())
            if predicate(value):
                return value
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        time.sleep(0.05)
    raise AssertionError('Fixture did not reach expected state')


def composer(snapshot):
    return next((node for node in snapshot['nodes']
                 if node.get('label') == 'Fixture message composer'
                 and node.get('role') in ['AXTextArea', 'AXTextField']), None)


def depth(snapshot, node):
    lookup = {entry['elementId']: entry for entry in snapshot['nodes']}
    result = 0
    while node.get('parentId') in lookup:
        node = lookup[node['parentId']]
        result += 1
    return result


def build_fixture(root, runtime):
    app = root / 'Mothership Composer Fixture.app'
    assert not app.exists(), 'Refusing to overwrite an existing fixture bundle'
    subprocess.run(['cp', '-cR', str(runtime), str(app)], check=True)
    info_path = app / 'Contents/Info.plist'
    info = plistlib.loads(info_path.read_bytes())
    info.update(CFBundleIdentifier=BUNDLE, CFBundleName='Mothership Composer Fixture',
                CFBundleDisplayName='Mothership Composer Fixture')
    info_path.write_bytes(plistlib.dumps(info))
    subprocess.run(['codesign', '--force', '--deep', '--sign', '-', str(app)],
                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
    return app / 'Contents/MacOS' / info['CFBundleExecutable']



def png_pixels(data):
    """Decode the helper's 8-bit non-interlaced RGB(A) PNG without extra test dependencies."""
    width, height, bits, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', data[16:29])
    assert bits == 8 and color in [2, 6] and (compression, filtering, interlace) == (0, 0, 0)
    channels = 4 if color == 6 else 3
    compressed = bytearray()
    offset = 8
    while offset < len(data):
        size = struct.unpack('>I', data[offset:offset + 4])[0]
        if data[offset + 4:offset + 8] == b'IDAT':
            compressed.extend(data[offset + 8:offset + 8 + size])
        offset += size + 12
    raw = zlib.decompress(compressed)
    stride = width * channels
    previous = bytearray(stride)
    rows = []
    for y in range(height):
        start = y * (stride + 1)
        filter_type = raw[start]
        row = bytearray(raw[start + 1:start + 1 + stride])
        for x in range(stride):
            left = row[x - channels] if x >= channels else 0
            above = previous[x]
            upper_left = previous[x - channels] if x >= channels else 0
            if filter_type == 1:
                prediction = left
            elif filter_type == 2:
                prediction = above
            elif filter_type == 3:
                prediction = (left + above) // 2
            elif filter_type == 4:
                p = left + above - upper_left
                distances = [abs(p - left), abs(p - above), abs(p - upper_left)]
                prediction = [left, above, upper_left][distances.index(min(distances))]
            else:
                assert filter_type == 0
                prediction = 0
            row[x] = (row[x] + prediction) & 255
        rows.append(row)
        previous = row
    return lambda x, y: tuple(rows[y][x * channels:x * channels + 3])


def verify_marker_pixels(png, capture, window, fixture, snapshot):
    """Compare captured color edges with the real AX target frame, independent of browser DPI."""
    sample = png_pixels(png)
    marker = fixture['markerBounds']
    content = fixture['contentBounds']
    native_marker = next(n for n in snapshot['nodes'] if n.get('label') == 'Fixture geometry marker')
    scale_x = capture['width'] / window['width']
    scale_y = capture['height'] / window['height']
    border_x = native_marker['width'] * 3 / marker['width']
    border_y = native_marker['height'] * 3 / marker['height']
    left = (native_marker['x'] - window['x'] + border_x) * scale_x
    right = (native_marker['x'] - window['x'] + native_marker['width'] - border_x) * scale_x
    top = (native_marker['y'] - window['y'] + border_y) * scale_y
    bottom = (native_marker['y'] - window['y'] + native_marker['height'] - border_y) * scale_y
    geometry = {'nativeMarker': {k: native_marker[k] for k in ['x', 'y', 'width', 'height']},
                'window': window, 'contentBounds': content, 'viewport': fixture['viewport'],
                'domMarker': marker, 'predictedPixelEdges': [left, right, top, bottom]}
    print(json.dumps({'markerGeometry': geometry}), flush=True)
    center_x = round((left + right) / 2)
    center_y = round((top + bottom) / 2)
    def is_marker(x, y):
        color = sample(x, y)
        fill_distance = sum((a - b) ** 2 for a, b in zip(color, (0, 184, 169)))
        border_distance = sum((a - b) ** 2 for a, b in zip(color, (16, 44, 42)))
        return (color[1] > color[0] + 60 and color[2] > color[0] + 50
                and fill_distance < border_distance)
    vertical = [y for y in range(max(0, int(top) - 30), min(capture['height'], int(bottom) + 30))
                if is_marker(center_x, y)]
    horizontal = [x for x in range(max(0, int(left) - 30), min(capture['width'], int(right) + 30))
                  if is_marker(x, center_y)]
    if not vertical or not horizontal:
        nearby = [(x, y)
                  for y in range(max(0, int(top) - 200), min(capture['height'], int(bottom) + 200))
                  for x in range(max(0, int(left) - 200), min(capture['width'], int(right) + 200))
                  if is_marker(x, y)]
        observed = ([min(x for x, _ in nearby), max(x for x, _ in nearby) + 1,
                     min(y for _, y in nearby), max(y for _, y in nearby) + 1] if nearby else None)
        raise AssertionError({'screenshotMarkerMismatch': True, 'observedPixelEdges': observed,
                              'predictedPixelEdges': [left, right, top, bottom]})
    edges = [min(horizontal), max(horizontal) + 1, min(vertical), max(vertical) + 1]
    predicted = [left, right, top, bottom]
    errors = [round(abs(actual - expected), 3) for actual, expected in zip(edges, predicted)]
    assert max(errors) <= 2, {'markerEdgeErrorsPx': errors}
    return {'markerEdgeErrorsPx': errors, 'scaleX': scale_x, 'scaleY': scale_y}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('helper')
    parser.add_argument('--baseline-helper', help='Optional previous helper, read-only discovery comparison')
    parser.add_argument('--electron', type=pathlib.Path,
                        default=REPO / 'node_modules/electron/dist/Electron.app')
    parser.add_argument('--artifacts', type=pathlib.Path)
    parser.add_argument('--geometry-only', action='store_true', help='Inspect the local fixture without input')
    parser.add_argument('--launch-only', action='store_true', help='Leave a fresh offline fixture running for a model trial')
    args = parser.parse_args()
    root = args.artifacts or pathlib.Path(tempfile.mkdtemp(prefix='mship-electron-composer-'))
    if args.artifacts:
        root.mkdir(mode=0o700, parents=True, exist_ok=False)
    os.chmod(root, 0o700)
    assert args.electron.is_dir(), args.electron
    fixture = None
    fixture_app = None
    helper = Helper(args.helper)
    report = {'fixtureBundle': BUNDLE, 'checks': [], 'artifacts': str(root),
              'mode': 'geometry-only' if args.geometry_only else 'full'}
    try:
        permissions = helper.call('status')
        assert permissions['accessibility'], 'BLOCKED: existing Accessibility grant required'
        executable = build_fixture(root, args.electron)
        fixture_app = executable.parents[2]
        with (root / 'electron.log').open('w') as log:
            fixture = subprocess.Popen([str(executable), str(SOURCE / 'electron-fixture/main.cjs')],
                                       env={**os.environ, 'MSHIP_COMPOSER_FIXTURE_OUTPUT': str(root)},
                                       stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                       start_new_session=args.launch_only)
        state_path = root / 'state.json'
        initial = fixture_state(state_path)
        assert initial['composer'] == '' and initial['submissions'] == 0
        if args.launch_only:
            report.update(mode='fixture-only', fixturePid=fixture.pid, statePath=str(state_path),
                          submissions=0, ready=True)
            (root / 'report.json').write_text(json.dumps(report, indent=2))
            print(json.dumps(report, indent=2))
            return
        if args.baseline_helper:
            baseline = Helper(args.baseline_helper)
            try:
                previous = baseline.state()
                report['baseline'] = {'composerFound': composer(previous) is not None,
                                      'nodes': len(previous['nodes']),
                                      'truncated': previous['truncated']}
            finally:
                baseline.close()
        snapshot = helper.state()
        target = composer(snapshot)
        assert target is not None, 'Deep contenteditable composer was omitted from native state'
        assert depth(snapshot, target) > 24, 'Fixture did not expose enough real AX ancestors'
        assert not snapshot.get('screenshot'), 'Discovery unexpectedly depended on screenshot'
        report['discovery'] = {'nodes': len(snapshot['nodes']), 'composerDepth': depth(snapshot, target),
                               'truncated': snapshot['truncated'],
                               'menuNodes': sum(n['role'].startswith('AXMenu') for n in snapshot['nodes']),
                               'composerEditable': target.get('editable'), 'composerFocused': target.get('focused')}
        report['checks'].append('deep composer discovered without screenshot')

        if not args.geometry_only:
            app = next(app for app in helper.call('list_apps')['apps'] if app['bundleId'] == BUNDLE)
            assert not app['isActive'], 'Fixture must start inactive for opt-in activation regression'
            target = composer(snapshot)
            (root / 'before-input-snapshot.json').write_text(json.dumps(snapshot))
            steps = [step for number in range(1, 6)
                     for step in [{'action': 'type_text', 'text': str(number)},
                                  {'action': 'press_key', 'key': 'Enter'}]]
            repeated = helper.call('input_sequence', bundleId=BUNDLE, snapshotId=snapshot['snapshotId'],
                                   elementId=target['elementId'], activateFirst=True, steps=steps)
            assert repeated['sequence'] == {'completedSteps': 10, 'totalSteps': 10}, repeated
            expected_history = ['1', '2', '3', '4', '5']
            five = fixture_state(state_path, lambda value: value['submissions'] == 5)
            assert five['history'] == expected_history and five['composer'] == ''
            report['checks'].append('one ten-step call explicitly activated inactive app and submitted 1 through 5 separately')

            snapshot = helper.state()
            toggle = next(node for node in snapshot['nodes']
                          if node['role'] == 'AXCheckBox' and 'Move focus after submit' in node.get('label', ''))
            helper.call('click', bundleId=BUNDLE, snapshotId=snapshot['snapshotId'], elementId=toggle['elementId'])
            fixture_state(state_path, lambda value: value.get('moveFocusAfterSubmit'))
            snapshot = helper.state()
            target = composer(snapshot)
            moved = helper.call('input_sequence', bundleId=BUNDLE, snapshotId=snapshot['snapshotId'],
                                elementId=target['elementId'], steps=[
                                    {'action': 'type_text', 'text': 'focus-boundary'},
                                    {'action': 'press_key', 'key': 'Enter'},
                                    {'action': 'type_text', 'text': 'MUST-NOT-APPEAR'},
                                ])
            assert moved['sequence']['completedSteps'] == 2 and moved['sequence']['totalSteps'] == 3, moved
            assert 'focus' in moved['sequence'].get('error', '').lower(), moved
            expected_history += ['focus-boundary']
            moved_state = fixture_state(state_path, lambda value: value['focused'] == 'sink')
            assert moved_state['history'] == expected_history and moved_state['sink'] == '' and moved_state['composer'] == ''
            report['checks'].append('Enter that moved actual editor focus prevented all later text')

            snapshot = helper.state()
            target = composer(snapshot)
            blocked = helper.reply('input_sequence', bundleId=BUNDLE, snapshotId=snapshot['snapshotId'],
                                   elementId=target['elementId'], steps=[
                                       {'action': 'press_key', 'key': 'Tab'},
                                       {'action': 'type_text', 'text': 'MUST-NOT-APPEAR'},
                                   ])
            assert 'result' in blocked, blocked
            sequence = blocked['result']['sequence']
            assert sequence['completedSteps'] == 1 and sequence['totalSteps'] == 2, blocked
            assert 'focus' in json.dumps(sequence.get('error', '')).lower(), blocked
            stopped = fixture_state(state_path, lambda value: value['focused'] == 'sink')
            assert stopped['sink'] == '' and stopped['composer'] == ''
            assert stopped['submissions'] == len(expected_history) and stopped['history'] == expected_history
            report['checks'].append('Tab focus change prevented later text and preserved submission count')

        snapshot = helper.state(screenshot=True)
        if permissions['screenRecording']:
            capture = snapshot.get('screenshot')
            assert capture, snapshot.get('screenshotError')
            png = base64.b64decode(capture['base64'])
            assert png.startswith(b'\x89PNG\r\n\x1a\n')
            dimensions = struct.unpack('>II', png[16:24])
            assert dimensions == (capture['width'], capture['height'])
            window = next(w for w in snapshot['windows'] if w['windowId'] == snapshot['windowId'])
            bounds = fixture_state(state_path)['windowBounds']
            assert all(abs(window[key] - bounds[key]) <= 2 for key in ['x', 'y', 'width', 'height'])
            assert abs(capture['width'] / window['width'] - capture['height'] / window['height']) < 0.02
            target = composer(snapshot)
            assert 0 <= target['x'] - window['x'] < window['width']
            assert 0 <= target['y'] - window['y'] < window['height']
            (root / 'fixture.png').write_bytes(png)
            report['screenshotGeometry'] = verify_marker_pixels(png, capture, window, fixture_state(state_path), snapshot)
            report['checks'].append('selected-window PNG marker pixels align with window-local coordinates')
        else:
            assert 'screen_capture_permission_required' in snapshot.get('screenshotError', '')
            report['screenshot'] = 'BLOCKED: existing Screen Recording grant missing'
        report['passed'] = True
        (root / 'report.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))
    except Exception as error:
        report['passed'] = False
        report['failure'] = str(error)
        (root / 'report.json').write_text(json.dumps(report, indent=2))
        raise
    finally:
        if fixture and not args.launch_only:
            fixture.terminate()
            try:
                fixture.wait(timeout=5)
            except subprocess.TimeoutExpired:
                fixture.kill()
                fixture.wait(timeout=3)
        helper.close()
        if fixture_app and not args.launch_only:
            shutil.rmtree(fixture_app)


if __name__ == '__main__':
    main()
