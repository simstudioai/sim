#!/usr/bin/env bash
set -euo pipefail

SOURCE_SHA=9e1f122b86e1757e56e8b4248a5c225114faa23d
SOURCE_TREE=293947e7aa89e75ac236d471285558c9ee74a817
REPOSITORY=simstudioai/sim
REPOSITORY_ID=912559512
readonly SOURCE_SHA SOURCE_TREE REPOSITORY REPOSITORY_ID
root=$(git rev-parse --show-toplevel)
cd "$root"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
proof_dir="$RUNNER_TEMP/webkit-probe"
input_dir="$RUNNER_TEMP/webkit-probe-inputs"
state_dir="$RUNNER_TEMP/webkit-probe-server"
mkdir -p "$proof_dir"

fail() { echo "::error::$*" >&2; exit 1; }

allowed_path() {
  case "$1" in
    .github/scripts/playwright-server.sh|.github/scripts/http-e2e.sh|apps/sim/scripts/test-mobile-e2e.ts|apps/docs/scripts/test-navigation-e2e.ts|.github/workflows/webkit-probe.yml|.github/workflows/webkit-probe-wave.yml|.github/scripts/webkit-probe.sh) return 0 ;;
    *) return 1 ;;
  esac
}

verify_source() {
  [[ "$(git rev-parse "$SOURCE_SHA^{tree}")" == "$SOURCE_TREE" ]] || fail 'Runtime tree pin differs'
  local changed untracked file
  changed=$(git diff --name-only --no-renames "$SOURCE_SHA" --)
  untracked=$(git ls-files --others --exclude-standard)
  while IFS= read -r file; do
    [[ -z "$file" ]] || allowed_path "$file" || fail "Unexpected runtime input: $file"
  done <<<"$changed
$untracked"
  if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
    [[ "${GITHUB_REPOSITORY:-}" == "$REPOSITORY" ]] || fail 'Untrusted repository'
    [[ "${GITHUB_EVENT_NAME:-}" == push ]] || fail 'Only the experiment branch push may run'
    [[ "${GITHUB_REF:-}" == refs/heads/codex/ci-webkit-container-probe ]] || fail 'Unexpected experiment ref'
    [[ "${GITHUB_RUN_ATTEMPT:-}" == 1 ]] || fail 'Experiment retries are not admissible'
    [[ "$(git rev-parse HEAD)" == "${GITHUB_SHA:-}" ]] || fail 'Recipe checkout differs from workflow source'
    [[ "$(git rev-list --parents -n 1 HEAD)" == "$GITHUB_SHA $SOURCE_SHA" ]] || fail 'Experiment must be one reviewed commit on the runtime pin'
    git diff --quiet HEAD -- || fail 'Tracked inputs changed after checkout'
    [[ -z "$untracked" ]] || fail 'Unexpected untracked source'
  fi
}

set_suite() {
  case "$1" in
    mobile-webkit-1|mobile-webkit-2)
      producer=41739278611 workflow=406304094 workflow_path=.github/workflows/validation.yml
      artifact=13279653087 artifact_name=next-build artifact_size=323626694
      artifact_hash=a59937892e90f6093639eb03a66d84cf321ab6c655f3dfd6a1ca41ee16aa7550
      archive=next-build.tar.zst
      ;;
    docs-webkit)
      producer=41739278492 workflow=384846738 workflow_path=.github/workflows/docs-negotiation.yml
      artifact=13279353647 artifact_name=docs-build artifact_size=96914120
      artifact_hash=88041db4fb25e0550fd73fa7e2b8d081a638d741e16314759facd647e83d0762
      archive=docs-build.tar.zst
      ;;
    *) fail 'Unknown WebKit suite' ;;
  esac
}

verify_producer() {
  gh api "repos/$REPOSITORY/actions/runs/$producer" >"$proof_dir/producer-$producer.json"
  jq -e --arg sha "$SOURCE_SHA" --arg repo "$REPOSITORY" --arg path "$workflow_path" \
    --argjson id "$producer" --argjson wid "$workflow" --argjson rid "$REPOSITORY_ID" '
    .id == $id and .workflow_id == $wid and .path == $path and
    .event == "push" and .head_branch == "staging" and .head_sha == $sha and
    .status == "completed" and .conclusion == "success" and .run_attempt == 1 and
    .repository.id == $rid and .head_repository.id == $rid and
    .repository.full_name == $repo and .head_repository.full_name == $repo
  ' "$proof_dir/producer-$producer.json" >/dev/null || fail 'Producer provenance differs'
  gh api "repos/$REPOSITORY/actions/artifacts/$artifact" >"$proof_dir/artifact-$artifact.json"
  jq -e --arg sha "$SOURCE_SHA" --arg name "$artifact_name" --arg digest "sha256:$artifact_hash" \
    --argjson id "$artifact" --argjson run "$producer" --argjson rid "$REPOSITORY_ID" --argjson size "$artifact_size" '
    .id == $id and .name == $name and .expired == false and .digest == $digest and .size_in_bytes == $size and
    .workflow_run.id == $run and .workflow_run.repository_id == $rid and .workflow_run.head_repository_id == $rid and
    .workflow_run.head_branch == "staging" and .workflow_run.head_sha == $sha
  ' "$proof_dir/artifact-$artifact.json" >/dev/null || fail 'Artifact provenance or expiry differs'
}

verify_harness() {
  PROBE_SOURCE_SHA="$SOURCE_SHA" PROOF_DIR="$proof_dir" bun - <<'JS'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { parse } from '@babel/parser'
const removed = new Set(['start', 'end', 'loc', 'extra', 'leadingComments', 'innerComments', 'trailingComments'])
const canonical = (node) => JSON.stringify(node, (key, value) => removed.has(key) ? undefined : value)
function checks(source, mobile) {
  const result = []
  let launch = 0
  function walk(node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'check') {
      const name = node.arguments[0]
      const starts = mobile && name?.type === 'TemplateLiteral' && name.quasis.map((q) => q.value.cooked ?? q.value.raw).join('') === '/browser starts'
      if (starts) launch++
      else result.push(canonical(node))
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') walk(value)
    }
  }
  walk(parse(source, { sourceType: 'module', plugins: ['typescript'] }))
  if (mobile && launch !== 1) throw new Error('The one mobile browser-start check must remain')
  return result
}
const proof = []
for (const [file, mobile] of [['apps/sim/scripts/test-mobile-e2e.ts', true], ['apps/docs/scripts/test-navigation-e2e.ts', false]]) {
  const before = checks(execFileSync('git', ['show', process.env.PROBE_SOURCE_SHA + ':' + file], { encoding: 'utf8' }), mobile)
  const after = checks(readFileSync(file, 'utf8'), mobile)
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Existing check bodies changed: ' + file)
  proof.push({ file, unchangedChecks: after.length, sha256: createHash('sha256').update(JSON.stringify(after)).digest('hex') })
}
writeFileSync(process.env.PROOF_DIR + '/harness-parity.json', JSON.stringify(proof, null, 2) + '\n')
JS
}

validate_pair() {
  [[ "$2" == local || "$2" == remote ]] || fail 'Unknown variant'
  [[ "$3" == 1 || "$3" == 2 || "$3" == 3 ]] || fail 'Unknown wave'
  set_suite "$1"
}

verify_results() {
  PROBE_SUITE="$1" PROOF_DIR="$proof_dir" bun - <<'JS'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { closeSync, openSync, opendirSync, readFileSync, readSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { toArray, toRecord } from '@sim/utils/object'
import { compareStrings } from '@sim/utils/string'
const suite = process.env.PROBE_SUITE
const expected = {
  'mobile-webkit-1': { cases: 57, images: 24, casesHash: '6f1862a8288b0b977366f53a7de07c91568ad6c8e3ba1b229ac4b8b4c1a8e4d9', imagesHash: 'b52a9c9e2732404d838271c4a4c6501e21113ec08bdc1e25a032291b6869cbe2' },
  'mobile-webkit-2': { cases: 44, images: 16, casesHash: 'dc8f7a7331a604c6a5f0971f0e6ad32cb2c68ccb411985c74bf31abb8c9cf9e3', imagesHash: '6f80f9cf90bbfc46ec6edff17f3ac77aa327e55de2486486a7fc70bdeb4f6d11' },
  'docs-webkit': { cases: 93, images: 89, casesHash: '4e4b0bde26d54a823035f47c60b62212fd1be224fbe4b3558c8168285fb4fb30', imagesHash: '8c49330056e4d3bb7f56887d753a71e1f9b98c523bc59eded8ddac60b8addf66' },
}[suite]
assert(expected, 'Unknown result suite')
const mobile = suite !== 'docs-webkit'
const reportPath = mobile
  ? resolve(process.env.RUNNER_TEMP, 'e2e/mobile-e2e-report.json')
  : resolve('apps/docs/test-results/navigation-webkit/docs.json')
assert(statSync(reportPath).size <= 5 * 1024 * 1024, 'Unexpected report byte size')
const report = toRecord(JSON.parse(readFileSync(reportPath, 'utf8')))
if (!mobile) assert.equal(report.engine, 'webkit', 'Unexpected report browser')
const records = toArray(mobile ? report.checks : report.results)
assert.equal(records.length, expected.cases, 'Case/status manifest differs')
const cases = records.map((value) => {
  const row = toRecord(value)
  assert(typeof row.name === 'string' && typeof row.status === 'string', 'Malformed case result')
  return [row.name, row.status]
}).sort((a, b) => compareStrings(a[0], b[0]) || compareStrings(a[1], b[1]))
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
assert.equal(hash(cases), expected.casesHash, 'Case/status manifest differs')
const artifactDirectory = realpathSync(mobile ? reportPath + '.artifacts' : dirname(reportPath))
const images = []
let entries = 0
function collect(directory, depth) {
  assert(depth <= 8, 'Artifact directory depth exceeds its bound')
  const stream = opendirSync(directory)
  try {
    for (let entry = stream.readSync(); entry; entry = stream.readSync()) {
      assert(++entries <= 2048, 'Artifact entry count exceeds its bound')
      assert(!entry.isSymbolicLink(), 'Unexpected artifact symlink')
      const path = join(directory, entry.name)
      if (entry.isDirectory()) collect(path, depth + 1)
      else if (entry.isFile() && entry.name.endsWith('.png')) {
        assert(images.length < expected.images, 'PNG inventory differs')
        images.push(realpathSync(path))
      }
    }
  } finally {
    stream.closeSync()
  }
}
collect(artifactDirectory, 0)
assert.equal(images.length, expected.images, 'PNG inventory differs')
const names = images.map((path) => basename(path)).sort(compareStrings)
assert.equal(hash(names), expected.imagesHash, 'PNG inventory differs')
if (mobile) {
  const references = toArray(report.screenshots)
  assert.equal(references.length, expected.images, 'Screenshot references differ')
  const paths = references.map((path) => {
    assert(typeof path === 'string', 'Malformed screenshot reference')
    return realpathSync(path)
  }).sort(compareStrings)
  assert.deepEqual(paths, [...images].sort(compareStrings), 'Screenshot references differ')
}
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
for (const path of images) {
  assert(path.startsWith(artifactDirectory + sep), 'Screenshot escaped its artifact directory')
  assert(statSync(path).size > signature.length, 'PNG signature differs')
  const file = openSync(path, 'r')
  try {
    const header = Buffer.alloc(signature.length)
    assert.equal(readSync(file, header, 0, header.length, 0), header.length, 'PNG signature differs')
    assert(header.equals(signature), 'PNG signature differs')
  } finally {
    closeSync(file)
  }
}
writeFileSync(join(process.env.PROOF_DIR, 'result-parity.json'), JSON.stringify({ suite, cases: cases.length, casesSha256: hash(cases), hostPngs: images.length, pngNamesSha256: hash(names) }, null, 2) + '\n')
JS
}

prepare() {
  validate_pair "$@"
  verify_source
  verify_producer
  mkdir -p "$input_dir"
  gh api --allow-escape-sequences "repos/$REPOSITORY/actions/artifacts/$artifact/zip" >"$input_dir/build.zip"
  local actual members
  actual=$(sha256sum "$input_dir/build.zip")
  [[ "${actual%% *}" == "$artifact_hash" ]] || fail 'Artifact ZIP digest differs'
  members=$(unzip -Z1 "$input_dir/build.zip")
  [[ "$members" == "$archive" ]] || fail 'Unexpected artifact members'
  unzip -p "$input_dir/build.zip" "$archive" >"$input_dir/$archive"
  sha256sum "$input_dir/$archive" >"$proof_dir/archive-sha256.txt"
  if [[ "$1" == docs-webkit ]]; then
    tar -I zstd -xf "$input_dir/$archive" -C apps/docs
  else
    tar -I zstd -xf "$input_dir/$archive" -C apps/sim
    jq -e '[.routes[].srcRoute] | any(. == "/blog/[slug]" or . == "/library/[slug]") | not' \
      apps/sim/.next/prerender-manifest.json >/dev/null || fail 'Hosted or missing prerender manifest'
  fi
  jq -n --arg source "$SOURCE_SHA" --arg tree "$SOURCE_TREE" --arg recipe "$(git rev-parse HEAD)" \
    --arg suite "$1" --arg variant "$2" --arg wave "$3" --arg provider "${WEBKIT_PROBE_PROVIDER:?}" \
    --arg node "$(node --version)" --arg bun "$(bun --version)" --arg digest "$artifact_hash" \
    '{source:$source, runtimeTree:$tree, recipe:$recipe, suite:$suite, variant:$variant, wave:$wave, provider:$provider, node:$node, bun:$bun, artifactZipSha256:$digest}' \
    >"$proof_dir/pair.json"
}

docs_pid=''
docs_tag=''
tls_dir=''
finish() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$docs_pid" ]]; then
    if ! bash .github/scripts/stop-session.sh "$docs_pid" "$docs_tag"; then
      echo '::error::Docs process cleanup failed' >&2
      if [[ "$status" == 0 ]]; then status=1; fi
    fi
    wait "$docs_pid" 2>/dev/null || true
  fi
  if [[ -n "$tls_dir" ]]; then rm -rf "$tls_dir"; fi
  if ! bash .github/scripts/playwright-server.sh stop "$state_dir"; then
    echo '::error::Owned WebKit container cleanup failed' >&2
    if [[ "$status" == 0 ]]; then status=1; fi
  fi
  exit "$status"
}

run_docs() {
  export DATABASE_URL=postgresql://docs_test:docs_test@127.0.0.1:1/docs_test
  export DOCS_E2E_BASE_URL=http://127.0.0.1:3001 DOCS_NAVIGATION_BROWSER=webkit
  export DOCS_NAVIGATION_REPORT_PATH="$root/apps/docs/test-results/navigation-webkit/docs.json"
  mkdir -p apps/docs/test-results
  tls_dir=$(mktemp -d)
  export DOCS_FEEDBACK_TEST_CERT="$tls_dir/cert.pem" DOCS_FEEDBACK_TEST_KEY="$tls_dir/key.pem"
  openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=127.0.0.1' -addext 'subjectAltName=IP:127.0.0.1' \
    -keyout "$DOCS_FEEDBACK_TEST_KEY" -out "$DOCS_FEEDBACK_TEST_CERT" 2>/dev/null
  export NODE_EXTRA_CA_CERTS="$DOCS_FEEDBACK_TEST_CERT"
  export DOCS_FEEDBACK_WEBHOOK_URL=https://127.0.0.1:3443/feedback
  DOCS_FEEDBACK_WEBHOOK_TOKEN=$(openssl rand -hex 32)
  export DOCS_FEEDBACK_WEBHOOK_TOKEN
  docs_tag="docs-webkit-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT-$$"
  E2E_APP="$docs_tag" setsid --wait bun run --cwd apps/docs start --port 3001 >apps/docs/test-results/docs-server.log 2>&1 &
  docs_pid=$!
  local attempt
  for attempt in $(seq 1 60); do
    kill -0 "$docs_pid" 2>/dev/null || fail 'Documentation server exited before becoming ready'
    if curl -fsS --max-time 2 "$DOCS_E2E_BASE_URL/introduction" -o /dev/null; then break; fi
    [[ "$attempt" != 60 ]] || fail 'Documentation server did not become ready'
    sleep 1
  done
  bun run --cwd apps/docs test:navigation:e2e
}

run_pair() {
  validate_pair "$@"
  verify_source
  unset PLAYWRIGHT_WEBKIT_WS_ENDPOINT GH_TOKEN GITHUB_TOKEN
  trap finish EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if [[ "$2" == remote ]]; then
    PLAYWRIGHT_WEBKIT_WS_ENDPOINT=$(bash .github/scripts/playwright-server.sh start "$state_dir")
    [[ -n "$PLAYWRIGHT_WEBKIT_WS_ENDPOINT" ]] || fail 'Empty remote browser endpoint'
    export PLAYWRIGHT_WEBKIT_WS_ENDPOINT
  fi
  if [[ "$1" == docs-webkit ]]; then
    if [[ "$2" == local ]]; then bunx --no-install playwright install --with-deps --only-shell webkit; fi
    run_docs
  else
    export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/sim_test
    export BETTER_AUTH_SECRET=http-e2e-ci-secret-at-least-32-characters
    export ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
    export MOBILE_E2E_BROWSER=webkit
    if [[ "$1" == mobile-webkit-1 ]]; then export MOBILE_E2E_SHARD=1/2; else export MOBILE_E2E_SHARD=2/2; fi
    (cd apps/sim && bash ../../.github/scripts/http-e2e.sh mobile)
  fi
}

case "${1:-}" in
  plan)
    verify_source
    provider="${CI_PROVIDER_INPUT:-}"
    [[ "$provider" =~ ^[a-zA-Z0-9_-]{0,32}$ ]] || fail 'Invalid provider selector'
    if [[ -z "$provider" ]]; then provider=blacksmith; fi
    set_suite mobile-webkit-1; verify_producer
    set_suite docs-webkit; verify_producer
    printf 'provider=%s\n' "$provider" >>"${GITHUB_OUTPUT:?}"
    jq -n --arg source "$SOURCE_SHA" --arg recipe "$(git rev-parse HEAD)" --arg provider "$provider" \
      '{source:$source, recipe:$recipe, frozenProvider:$provider}' >"$proof_dir/plan.json"
    ;;
  verify) verify_source; verify_harness ;;
  prepare) shift; [[ "$#" == 3 ]] || fail 'Expected suite variant wave'; prepare "$@" ;;
  run) shift; [[ "$#" == 3 ]] || fail 'Expected suite variant wave'; run_pair "$@" ;;
  results) shift; [[ "$#" == 1 ]] || fail 'Expected one result suite'; verify_source; verify_results "$1" ;;
  *) fail 'Expected plan, verify, prepare, run or results' ;;
esac
