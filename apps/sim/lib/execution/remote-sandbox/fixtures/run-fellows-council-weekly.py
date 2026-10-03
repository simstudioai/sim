#!/usr/bin/env python3
"""Run the sanitized digest fixture fully offline and inspect its exported ZIP."""

import json
import pathlib
import sys
import types
import zipfile


FIXED_ISO_TIMESTAMP = '2026-08-03T12:00:00+00:00'
def fail_external_call(*_args, **_kwargs):
    raise AssertionError('The offline Fellows fixture attempted an external call')


def load_fixture(source_path: pathlib.Path) -> dict:
    source = source_path.read_text(encoding='utf-8')
    replacements = {
        '{{ANTHROPIC_API_KEY}}': repr('stub-anthropic-key'),
        '{{NCBI_API_KEY}}': repr('stub-ncbi-key'),
        '{{AIRTABLE_PAT}}': repr('stub-airtable-token'),
        '{{GOOGLE_SERVICE_ACCOUNT_JSON}}': repr(
            '{"type":"service_account","project_id":"fixture-project"}'
        ),
    }
    for placeholder, value in replacements.items():
        source = source.replace(placeholder, value)

    namespace = {
        '__file__': str(source_path),
        '__name__': 'fellows_council_weekly_fixture',
    }
    requests_stub = types.ModuleType('requests')
    requests_stub.get = fail_external_call
    requests_stub.post = fail_external_call
    sys.modules['requests'] = requests_stub
    exec(compile(source, str(source_path), 'exec'), namespace, namespace)
    return namespace


def install_stubs(
    namespace: dict,
    output_dir: pathlib.Path,
    zip_path: pathlib.Path,
) -> dict:
    real_datetime = namespace['datetime']
    timezone = namespace['timezone']

    class FrozenDateTime(real_datetime):
        @classmethod
        def now(cls, tz=None):
            fixed = real_datetime.fromisoformat(FIXED_ISO_TIMESTAMP)
            return fixed.astimezone(tz) if tz is not None else fixed.replace(tzinfo=None)

    member = namespace['FELLOWS'][0]
    user_id = member['user_id']
    profile = {
        'id': user_id,
        'first_name': member['first_name'],
        'last_name': member['last_name'],
        'email': member['email'],
        'last_login': '2026-08-01T10:00:00+00:00',
        'created_at': '2025-01-01T00:00:00+00:00',
        'thumbnail': '',
        'specialty': 'Internal Medicine',
        'subspecialty': '',
    }
    activity = {'posts': 2, 'comments': 3, 'reactions': 4, 'rounds': 1}
    credential_state = {'materialized': False}
    materialize_google_credentials = namespace['materialize_google_credentials']

    def tracked_materialize_google_credentials():
        credential_path = materialize_google_credentials()
        credential_state['materialized'] = bool(
            credential_path and pathlib.Path(credential_path).is_file()
        )
        if credential_state['materialized']:
            credentials = json.loads(
                pathlib.Path(credential_path).read_text(encoding='utf-8')
            )
            if credentials.get('project_id') != 'fixture-project':
                raise AssertionError('Fixture materialized unexpected Google credentials')
        return credential_path

    namespace.update(
        {
            'OUT_DIR': str(output_dir),
            'EXPORT_ZIP': str(zip_path),
            'datetime': FrozenDateTime,
            'materialize_google_credentials': tracked_materialize_google_credentials,
            'fetch_profiles': lambda: {user_id: dict(profile)},
            'fetch_activity': lambda _days: {user_id: dict(activity)},
            'fetch_physicians_reached': lambda: {user_id: 17},
            'fetch_recent_posts_pool': lambda **_kwargs: [],
            'fetch_streaks': lambda _user_ids: {user_id: 2},
            'build_fellow_interests': lambda *_args, **_kwargs: {
                user_id: {'interests': ['care delivery', 'clinical operations']}
            },
            'fetch_bios_and_pubs': lambda: {
                user_id: {'bio': 'Sanitized fixture profile.', 'pub_titles': []}
            },
            'fetch_shared_links': lambda _user_ids: {user_id: set()},
            'build_own_work': lambda *_args, **_kwargs: {user_id: None},
            'fetch_notable_joiners': lambda **_kwargs: [],
            'bq': fail_external_call,
        }
    )
    namespace['requests'].get = fail_external_call
    namespace['requests'].post = fail_external_call
    namespace['subprocess'].run = fail_external_call
    namespace['timezone'] = timezone
    return credential_state


def assert_runtime_credentials_removed(namespace: dict, output_dir: pathlib.Path) -> None:
    credential_path = output_dir / '.runtime' / 'google-service-account.json'
    if credential_path.exists():
        raise AssertionError('Fixture left runtime Google credentials on disk')
    if credential_path.parent.exists():
        raise AssertionError('Fixture left its runtime credential directory on disk')
    if namespace['os'].environ.get('GOOGLE_APPLICATION_CREDENTIALS'):
        raise AssertionError('Fixture left the runtime credential environment variable set')


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit('usage: run-fellows-council-weekly.py SOURCE OUTPUT_DIR ZIP_PATH')

    source_path = pathlib.Path(sys.argv[1])
    output_dir = pathlib.Path(sys.argv[2])
    zip_path = pathlib.Path(sys.argv[3])
    output_dir.mkdir(parents=True, exist_ok=True)

    namespace = load_fixture(source_path)
    credential_state = install_stubs(namespace, output_dir, zip_path)

    original_argv = sys.argv
    try:
        sys.argv = [str(source_path), '--cohort', 'fellows', '--no-news']
        namespace['main']()
    finally:
        sys.argv = original_argv

    assert_runtime_credentials_removed(namespace, output_dir)
    if not zip_path.is_file():
        raise AssertionError('Fixture did not create its declared ZIP artifact')
    with zipfile.ZipFile(zip_path) as archive:
        entries = archive.namelist()
        if any(entry.startswith('.runtime/') for entry in entries):
            raise AssertionError('Fixture archived runtime Google credentials')
    print(
        json.dumps(
            {
                'credentialMaterialized': credential_state['materialized'],
                'entries': entries,
                'zipPath': str(zip_path),
            },
            sort_keys=True,
        )
    )


if __name__ == '__main__':
    main()
