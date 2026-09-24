"""Run against a compiled helper; no permission requests or personal UI reads."""
import json
import subprocess
import sys

helper = sys.argv[1]
process = subprocess.Popen([helper], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

def call(method, params=None):
    process.stdin.write(json.dumps({'id': method, 'method': method, 'params': params or {}}) + '\n')
    process.stdin.flush()
    return json.loads(process.stdout.readline())

status = call('status')['result']
assert status['kind'] == 'status' and status['platform'] == 'darwin'
assert isinstance(status['accessibility'], bool) and isinstance(status['screenRecording'], bool)
assert call('unknown')['error']['code'] == 'unknown_method'
assert call('request_permission', {'permission': 'invalid'})['error']['code'] == 'invalid_arguments'
if not status['accessibility']:
    for action in ['get_app_state', 'click', 'type_text', 'press_key', 'scroll', 'drag', 'set_value', 'perform_action']:
        assert call(action, {'bundleId': 'com.mothership.computer-use-fixture'})['error']['code'] == 'accessibility_permission_required'
else:
    assert call('get_app_state', {'bundleId': 'com.apple.systempreferences'})['error']['code'] == 'protected_app'
    assert call('get_app_state', {'bundleId': 'com.simstudio.computer-use'})['error']['code'] == 'protected_app'
process.stdin.write('x' * (129 * 1024) + '\n')
process.stdin.flush()
assert json.loads(process.stdout.readline())['error']['code'] == 'invalid_request'
assert call('unknown', {'text': 'A😀é漢字'})['error']['code'] == 'unknown_method'
assert call('status')['result'] == status
process.stdin.close()
assert process.wait(timeout=5) == 0
print('PASS: persistent JSONL, status, malformed method, invalid permission, permission gates, clean EOF')
