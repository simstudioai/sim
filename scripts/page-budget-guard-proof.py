import json
import pathlib
import subprocess

root = pathlib.Path.cwd()
owner = root / 'apps/sim/lib/mothership/chat/page-context.ts'
original = owner.read_text()
output = pathlib.Path('/tmp/page-budget-guard-proof')
output.mkdir()
reports = []
base = ['bun', 'run', '--cwd', 'apps/sim', 'test', 'lib/mothership/chat/process-contents.test.ts', '-t', 'oversized page batch', '--reporter=json']
cases = [
    ('intact', original, []),
    ('without-text-guard', original.replace('textLength > MAX_PAGE_CONTEXT_TEXT_LENGTH || ', ''), ['combined text']),
    ('without-byte-guard', original.replace(' || bytes > MAX_PAGE_CONTEXT_BYTES', ''), ['combined serialized bytes']),
]
try:
    for name, source, expected in cases:
        owner.write_text(source)
        report = output / (name + '.json')
        result = subprocess.run([*base, '--outputFile=' + str(report)], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (output / (name + '.log')).write_text(result.stdout)
        data = json.loads(report.read_text())
        failed = [test['fullName'] for file in data['testResults'] for test in file['assertionResults'] if test['status'] == 'failed']
        assert len(failed) == len(expected), (name, failed)
        assert all(any(label in title for title in failed) for label in expected), (name, failed)
        assert result.returncode == (1 if expected else 0), (name, result.returncode)
        reports.append({'case': name, 'failedTests': failed, 'exitCode': result.returncode, 'expectedFailureObserved': bool(expected)})
finally:
    owner.write_text(original)
    (output / 'summary.json').write_text(json.dumps(reports, indent=2) + '\n')
assert owner.read_text() == original
