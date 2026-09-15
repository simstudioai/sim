import { createHash } from 'node:crypto'
import { getRedisClient } from '@/lib/core/config/redis'
import { resolveProvider } from '@/lib/execution/remote-sandbox/provider'
import type { SessionFileIdentity } from '@/lib/execution/remote-sandbox/session-file-observer'

const TTL_SECONDS = 24 * 60 * 60
const RECORD_INPUT = `
local previous = redis.call('GET', KEYS[1])
local next = 'unknown'
if previous == 'clean' and ARGV[1] == 'clean' then next = 'clean' end
redis.call('SET', KEYS[1], next, 'EX', ARGV[2])
return next
`

function key(sessionKey: string, machine: SessionFileIdentity) {
  if (!machine.sandboxId) throw new Error('Workbench physical identity is unavailable')
  const digest = createHash('sha256')
    .update(JSON.stringify([sessionKey, machine.providerId, machine.sandboxId]))
    .digest('hex')
  return `mothership:workbench-provenance:v1:${digest}`
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
  await redis().set(key(sessionKey, machine), 'clean', 'EX', TTL_SECONDS, 'NX')
}

/** Record inputs before writing or executing; missing history never becomes clean on a retry. */
export async function recordSessionFileInput(
  sessionKey: string,
  machine: SessionFileIdentity,
  exactEmpty: boolean
) {
  await redis().eval(
    RECORD_INPUT,
    1,
    key(sessionKey, machine),
    exactEmpty ? 'clean' : 'unknown',
    TTL_SECONDS
  )
}

/** Physical identity, not a caller path, binds the lifetime of this evidence. */
export async function isSessionFileProvenanceClean(
  sessionKey: string,
  machine: SessionFileIdentity
) {
  return (await redis().get(key(sessionKey, machine))) === 'clean'
}

/** Records classified API input on the existing physical machine without creating one. */
export async function recordExistingSessionFileInput(sessionKey: string, exactEmpty: boolean) {
  const provider = resolveProvider()
  const sandbox = await provider.findSessionSandbox?.(sessionKey, {})
  if (!sandbox) throw new Error('The active workbench is unavailable')
  await recordSessionFileInput(
    sessionKey,
    { providerId: provider.id, sandboxId: sandbox.sandboxId },
    exactEmpty
  )
}
