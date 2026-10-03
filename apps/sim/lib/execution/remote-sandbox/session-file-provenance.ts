import { createHash } from 'node:crypto'
import { isRecordLike, omit } from '@sim/utils/object'
import { getRedisClient } from '@/lib/core/config/redis'
import {
  type DurableSecretProvenance,
  normalizeDurableSecretProvenanceEntries,
} from '@/lib/execution/durable-secret-provenance'
import {
  PROVENANCE_MAX_ENTRIES,
  PROVENANCE_MAX_SERIALIZED_BYTES,
} from '@/lib/execution/provenance-limits'
import { resolveProvider } from '@/lib/execution/remote-sandbox/provider'
import type { SessionFileIdentity } from '@/lib/execution/remote-sandbox/session-file-observer'

const TTL_SECONDS = 24 * 60 * 60
const UNKNOWN = '{"status":"unknown"}'
const EMPTY = '{"status":"exact","entries":[]}'
const RECORD_INPUT = `
local previous = redis.call('GET', KEYS[1])
local next = ARGV[3]
local maxBytes = tonumber(ARGV[4])
local maxEntries = tonumber(ARGV[5])
if previous and #previous <= maxBytes and #ARGV[1] <= maxBytes then
  local previousOk, history = pcall(cjson.decode, previous)
  local inputOk, input = pcall(cjson.decode, ARGV[1])
  if previousOk and inputOk and type(history) == 'table' and type(input) == 'table'
      and history.status == 'exact' and input.status == 'exact'
      and type(history.entries) == 'table' and type(input.entries) == 'table' then
    local entries = {}
    local seen = {}
    local secretValues = {}
    local secretValueCount = 0
    local valid = (#history.entries > 0 or previous == ARGV[6])
      and (#input.entries > 0 or ARGV[1] == ARGV[6])
    for _, source in ipairs({history.entries, input.entries}) do
      for index, _ in pairs(source) do
        if type(index) ~= 'number' or index < 1 or index > #source or index % 1 ~= 0 then
          valid = false; break
        end
      end
      if not valid then break end
      for _, entry in ipairs(source) do
        if type(entry) ~= 'table' or type(entry.encryptedValue) ~= 'string' then
          valid = false
          break
        end
        local id = cjson.encode({entry.encryptedValue, entry.name or '',
          entry.sourceUserId or '', entry.sourceWorkspaceId or ''})
        if not seen[id] then
          seen[id] = true
          if not secretValues[entry.encryptedValue] then
            secretValues[entry.encryptedValue] = true
            secretValueCount = secretValueCount + 1
            if secretValueCount > maxEntries then valid = false; break end
          end
          table.insert(entries, entry)
        end
      end
      if not valid then break end
    end
    if valid then
      if #entries == 0 then next = ARGV[6]
      else next = cjson.encode({status='exact', entries=entries}) end
      if #next > maxBytes then next = ARGV[3] end
    end
  end
end
redis.call('SET', KEYS[1], next, 'EX', ARGV[2])
return 1
`

function key(sessionKey: string, machine: SessionFileIdentity) {
  if (!machine.sandboxId) throw new Error('Workbench physical identity is unavailable')
  const digest = createHash('sha256')
    .update(JSON.stringify([sessionKey, machine.providerId, machine.sandboxId]))
    .digest('hex')
  return `mothership:workbench-provenance:v2:${digest}`
}
function redis() {
  const client = getRedisClient()
  if (!client) throw new Error('Workbench provenance storage is unavailable')
  return client
}

/** Only a newly created physical machine starts with no prior input exposure. */
export async function initializeSessionFileProvenance(
  sessionKey: string,
  machine: SessionFileIdentity
) {
  await redis().set(key(sessionKey, machine), EMPTY, 'EX', TTL_SECONDS, 'NX')
}

/**
 * Atomically widen encrypted machine history before classified input enters it.
 * Source-value hashes have already narrowed the input selection and do not bind a machine's lifetime.
 */
export async function recordSessionFileInput(
  sessionKey: string,
  machine: SessionFileIdentity,
  input: boolean | DurableSecretProvenance
) {
  const provenance =
    typeof input === 'boolean'
      ? input
        ? { status: 'exact' as const, entries: [] }
        : { status: 'unknown' as const }
      : input
  const normalized =
    provenance.status === 'exact'
      ? normalizeDurableSecretProvenanceEntries(provenance.entries)
      : undefined
  const entries =
    normalized &&
    normalizeDurableSecretProvenanceEntries(
      normalized.map((entry) => omit(entry, ['sourceValueHash']))
    )
  const encoded = entries ? JSON.stringify({ status: 'exact', entries }) : UNKNOWN
  await redis().eval(
    RECORD_INPUT,
    1,
    key(sessionKey, machine),
    Buffer.byteLength(encoded, 'utf8') <= PROVENANCE_MAX_SERIALIZED_BYTES ? encoded : UNKNOWN,
    TTL_SECONDS,
    UNKNOWN,
    PROVENANCE_MAX_SERIALIZED_BYTES,
    PROVENANCE_MAX_ENTRIES,
    EMPTY
  )
}

/** Missing, legacy, expired or malformed history can never certify an existing machine. */
export async function readSessionSecretProvenance(
  sessionKey: string,
  machine: SessionFileIdentity
): Promise<DurableSecretProvenance> {
  const value = await redis().get(key(sessionKey, machine))
  if (!value || Buffer.byteLength(value, 'utf8') > PROVENANCE_MAX_SERIALIZED_BYTES)
    return { status: 'unknown' }
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecordLike(parsed) || parsed.status !== 'exact') return { status: 'unknown' }
    const entries = normalizeDurableSecretProvenanceEntries(parsed.entries)
    return entries ? { status: 'exact', entries } : { status: 'unknown' }
  } catch {
    return { status: 'unknown' }
  }
}

/** Physical identity, not a caller path, binds the lifetime of this evidence. */
export async function isSessionFileProvenanceClean(
  sessionKey: string,
  machine: SessionFileIdentity
) {
  const history = await readSessionSecretProvenance(sessionKey, machine)
  return history.status === 'exact' && history.entries.length === 0
}

/** Records classified API input on the existing physical machine without creating one. */
export async function recordExistingSessionFileInput(
  sessionKey: string,
  provenance: boolean | DurableSecretProvenance
) {
  const provider = resolveProvider()
  const sandbox = await provider.findSessionSandbox?.(sessionKey, {})
  if (!sandbox) throw new Error('The active workbench is unavailable')
  await recordSessionFileInput(
    sessionKey,
    { providerId: provider.id, sandboxId: sandbox.sandboxId },
    provenance
  )
}
