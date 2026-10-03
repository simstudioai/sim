/** Redis equivalent of updateProviderCapacity; real-backend parity tests cover each transition. */
export const PROVIDER_CAPACITY_SCRIPT = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
if now >= tonumber(ARGV[3]) then return redis.error_reply('Provider capacity storage deadline expired') end
local config = cjson.decode(ARGV[1])
local action = cjson.decode(ARGV[2])
local raw = redis.call('HGET', KEYS[1], 'capacityState')
local state
if raw then state = cjson.decode(raw) else
  state = { version = 1, scale = 1, nextRequestAt = 0,
    pageTokens = math.min(config.initialPageTokens, config.pagesPerMinute), refilledAt = now,
    cooldownUntil = 0, recoveryAt = now + math.ceil(config.recoveryIntervalMs), leases = {} }
end
if state.version ~= 1 then return redis.error_reply('Unsupported provider capacity state') end
now = math.max(now, state.refilledAt)
local leases = {}
for _, lease in ipairs(state.leases) do
  if lease.expiresAt > now then table.insert(leases, lease) end
end
state.leases = leases
local pageWindow = {}
local pagesInWindow = 0
for _, bucket in ipairs(state.pageWindow or {}) do
  if bucket.at + 61000 > now then
    table.insert(pageWindow, bucket)
    pagesInWindow = pagesInWindow + bucket.pages
  end
end
state.pageWindow = pageWindow
state.scale = math.max(config.minimumScale, math.min(1, state.scale))
state.pageTokens = math.min(config.pagesPerMinute, state.pageTokens +
  math.max(0, now - state.refilledAt) * config.pagesPerMinute * state.scale / 60000)
state.refilledAt = math.max(now, state.refilledAt)
if state.requestQuota and state.requestQuota.resetAt <= now then state.requestQuota = nil end
local function quotaRequestInterval()
  if not state.requestQuota then return 0 end
  local remainingMs = math.max(0, state.requestQuota.resetAt - now)
  return math.ceil(math.min(remainingMs, remainingMs / math.max(1, state.requestQuota.remaining * 0.9)))
end
local wait = 0
local allowed = false
if action.kind == 'settle' then
  local held = false
  leases = {}
  for _, lease in ipairs(state.leases) do
    if lease.id == action.leaseId then held = true else table.insert(leases, lease) end
  end
  state.leases = leases
  if held and action.requestQuota and action.requestQuota.resetAt > now then
    local previous = state.requestQuota
    if not previous or action.requestQuota.resetAt >= previous.resetAt then
      local remaining = action.requestQuota.remaining
      if previous and previous.resetAt == action.requestQuota.resetAt then remaining = math.min(previous.remaining, remaining) end
      state.requestQuota = { resetAt = action.requestQuota.resetAt, remaining = remaining }
      state.nextRequestAt = math.max(state.nextRequestAt, now + quotaRequestInterval())
    end
  end
  if held and action.outcome == 'rate_limit' then
    if now >= state.cooldownUntil then state.scale = math.max(config.minimumScale, state.scale / 2) end
    local delay = math.max(action.retryAfterMs or 0, (config.rateLimitBackoffMs or 1000) / state.scale)
    state.cooldownUntil = math.max(state.cooldownUntil, now + math.ceil(delay))
    state.nextRequestAt = math.max(state.nextRequestAt, state.cooldownUntil)
    state.pageTokens = 0
    state.recoveryAt = state.cooldownUntil + math.ceil(config.recoveryIntervalMs)
    wait = state.cooldownUntil - now
  elseif held and action.outcome == 'success' and now >= state.recoveryAt and now >= state.cooldownUntil then
    state.scale = math.min(1, state.scale + 0.05)
    state.recoveryAt = now + math.ceil(config.recoveryIntervalMs)
  end
  allowed = held
else
  local held = false
  for _, lease in ipairs(state.leases) do
    if lease.id == action.leaseId then held = true end
  end
  if held then
    allowed = true
  else
    wait = math.max(0, state.cooldownUntil - now, state.nextRequestAt - now)
    if state.requestQuota and state.requestQuota.remaining == 0 then wait = math.max(wait, state.requestQuota.resetAt - now) end
    if state.requestQuota and config.maximumQuotaPacingMs and quotaRequestInterval() > config.maximumQuotaPacingMs then
      wait = math.max(wait, state.requestQuota.resetAt - now)
    end
    if state.pageTokens < action.pages then
      wait = math.max(wait, (action.pages - state.pageTokens) * 60000 / (config.pagesPerMinute * state.scale))
    end
    if pagesInWindow + action.pages > config.pagesPerMinute then
      for _, bucket in ipairs(pageWindow) do
        pagesInWindow = pagesInWindow - bucket.pages
        if pagesInWindow + action.pages <= config.pagesPerMinute then
          wait = math.max(wait, bucket.at + 61000 - now)
          break
        end
      end
    end
    if #state.leases >= config.maxConcurrent then wait = math.max(wait, 1000) end
    if wait == 0 and action.leaseDurationMs > 0 then
      state.pageTokens = state.pageTokens - action.pages
      state.nextRequestAt = now + math.ceil(math.max(60000 / (config.requestsPerMinute * state.scale), quotaRequestInterval()))
      if state.requestQuota then state.requestQuota.remaining = state.requestQuota.remaining - 1 end
      table.insert(state.leases, { id = action.leaseId, expiresAt = now + math.ceil(action.leaseDurationMs) })
      local at = math.floor(now / 1000) * 1000
      local last = pageWindow[#pageWindow]
      if last and last.at == at then last.pages = last.pages + action.pages
      else table.insert(pageWindow, { at = at, pages = action.pages }) end
      allowed = true
    end
  end
end
redis.call('HSET', KEYS[1], 'capacityState', cjson.encode(state))
local retainUntil = now + 86400000
retainUntil = math.max(retainUntil, state.cooldownUntil + 86400000)
for _, lease in ipairs(state.leases) do retainUntil = math.max(retainUntil, lease.expiresAt + 86400000) end
redis.call('PEXPIREAT', KEYS[1], retainUntil)
local result = { allowed = allowed, retryAfterMs = math.ceil(wait), scale = state.scale, inFlight = #state.leases }
if not allowed and state.cooldownUntil > now then result.cooldownRemainingMs = math.ceil(state.cooldownUntil - now) end
return cjson.encode(result)
`
