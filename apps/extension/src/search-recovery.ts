import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { escapeRegExp } from '@sim/utils/string'
import { SIM_ORIGIN } from '@/config'

export const SEARCH_RECOVERY_KEY = 'searchRecovery'
export const SEARCH_RECOVERY_PROVIDERS = [
  {
    id: 'google',
    label: 'Google',
    origins: ['https://www.google.com/*', 'https://google.com/*'],
    path: '/search',
    parameter: 'q',
    ruleId: 101,
  },
  {
    id: 'bing',
    label: 'Bing',
    origins: ['https://www.bing.com/*', 'https://bing.com/*'],
    path: '/search',
    parameter: 'q',
    ruleId: 102,
  },
  {
    id: 'duckduckgo',
    label: 'DuckDuckGo',
    origins: ['https://duckduckgo.com/*', 'https://www.duckduckgo.com/*'],
    path: '/',
    parameter: 'q',
    ruleId: 103,
  },
  {
    id: 'yahoo',
    label: 'Yahoo',
    origins: ['https://search.yahoo.com/*'],
    path: '/search',
    parameter: 'p',
    ruleId: 104,
  },
] as const

type ProviderId = (typeof SEARCH_RECOVERY_PROVIDERS)[number]['id']
type RecoveryPreferences = Record<ProviderId, boolean>
const logger = createLogger('BrowserShortcutRecovery')
const MESSAGE_TYPE = 'set-search-recovery'

/** Search text is never observed in JavaScript; Chrome matches only explicit shortcut requests. */
function recoveryRules(
  provider: (typeof SEARCH_RECOVERY_PROVIDERS)[number]
): chrome.declarativeNetRequest.Rule[] {
  const hosts = provider.origins.map((origin) => escapeRegExp(new URL(origin).host)).join('|')
  const character = '(?:[a-z0-9._~:@/-]|%(?:2[6def]|3[0-9a]|4[0-9a-f]|5[0-9af]|6[1-9a-f]|7[0-9ae]))'
  const shortcut = `(?:sim|go)(?:/|%2f)${character}+`
  const condition = {
    isUrlFilterCaseSensitive: false,
    requestDomains: provider.origins.map((origin) => new URL(origin).hostname),
    resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
    requestMethods: [chrome.declarativeNetRequest.RequestMethod.GET],
  }
  // Separate ambiguity guards keep the redirect below Chrome's compiled-regex memory limit.
  return [
    {
      id: provider.ruleId + 100,
      priority: 2,
      action: { type: chrome.declarativeNetRequest.RuleActionType.ALLOW },
      condition: {
        ...condition,
        regexFilter: `[?&]${provider.parameter}=.*&${provider.parameter}=`,
      },
    },
    {
      id: provider.ruleId + 200,
      priority: 2,
      action: { type: chrome.declarativeNetRequest.RuleActionType.ALLOW },
      condition: { ...condition, regexFilter: '[?&][^=&]*%[^=&]*=' },
    },
    {
      id: provider.ruleId,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
        redirect: { regexSubstitution: `${SIM_ORIGIN}/sim-links/recover?q=\\1` },
      },
      condition: {
        ...condition,
        regexFilter: `^https://(?:${hosts})${escapeRegExp(provider.path)}\\?(?:[^#]*&)?${provider.parameter}=(${shortcut})(?:&[^#]*)?$`,
      },
    },
  ]
}

/** A remembered choice is effective only while Chrome still grants that provider's sites. */
export async function readSearchRecovery(): Promise<RecoveryPreferences> {
  const stored = (await chrome.storage.local.get(SEARCH_RECOVERY_KEY))[SEARCH_RECOVERY_KEY]
  const preferences: RecoveryPreferences = {
    google: false,
    bing: false,
    duckduckgo: false,
    yahoo: false,
  }
  for (const provider of SEARCH_RECOVERY_PROVIDERS) {
    preferences[provider.id] =
      isRecordLike(stored) &&
      stored[provider.id] === true &&
      (await chrome.permissions.contains({ origins: [...provider.origins] }))
  }
  return preferences
}

/** The worker serializes settings and rule updates across every open side panel. */
export async function setSearchRecovery(provider: ProviderId, enabled: boolean): Promise<void> {
  const response: unknown = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPE,
    provider,
    enabled,
  })
  if (!isRecordLike(response) || response.ok !== true)
    throw new Error('Could not update browser shortcuts.')
}

/** Reconcile persisted, permission-bound rules at startup, on revocation, and after an explicit choice. */
export function registerSearchRecovery() {
  let pending = Promise.resolve()
  const update = (choice?: { provider: ProviderId; enabled: boolean }) => {
    const operation = pending.then(async () => {
      const preferences = await readSearchRecovery()
      if (choice) {
        const provider = SEARCH_RECOVERY_PROVIDERS.find(
          (provider) => provider.id === choice.provider
        )
        if (!provider) throw new Error('Unknown shortcut provider.')
        if (
          choice.enabled &&
          !(await chrome.permissions.contains({ origins: [...provider.origins] }))
        )
          throw new Error('Search site access has not been granted.')
        preferences[choice.provider] = choice.enabled
      }
      const rules = SEARCH_RECOVERY_PROVIDERS.filter(
        (provider) => preferences[provider.id]
      ).flatMap(recoveryRules)
      for (const rule of rules) {
        const supported = await chrome.declarativeNetRequest.isRegexSupported({
          regex: rule.condition.regexFilter ?? '',
          isCaseSensitive: false,
          requireCapturing: true,
        })
        if (!supported.isSupported) throw new Error('Chrome cannot apply shortcut recovery.')
      }
      const ruleIds = SEARCH_RECOVERY_PROVIDERS.flatMap((provider) => [
        provider.ruleId,
        provider.ruleId + 100,
        provider.ruleId + 200,
      ])
      const previousRules = (await chrome.declarativeNetRequest.getDynamicRules()).filter((rule) =>
        ruleIds.includes(rule.id)
      )
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: ruleIds,
        addRules: rules,
      })
      try {
        await chrome.storage.local.set({ [SEARCH_RECOVERY_KEY]: preferences })
      } catch (error) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: ruleIds,
          addRules: previousRules,
        })
        throw error
      }
    })
    pending = operation.catch(() => logger.warn('Could not update browser shortcut recovery'))
    return operation
  }
  const reconcile = () => {
    void update().catch(() => {})
  }
  chrome.runtime.onInstalled.addListener(reconcile)
  chrome.runtime.onStartup.addListener(reconcile)
  chrome.permissions.onRemoved.addListener(reconcile)
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (
      sender.id !== chrome.runtime.id ||
      !sender.url?.startsWith(chrome.runtime.getURL('')) ||
      !isRecordLike(message) ||
      message.type !== MESSAGE_TYPE ||
      typeof message.enabled !== 'boolean'
    )
      return
    const provider = SEARCH_RECOVERY_PROVIDERS.find((provider) => provider.id === message.provider)
    if (!provider) return
    void update({ provider: provider.id, enabled: message.enabled }).then(
      () => respond({ ok: true }),
      () => respond({ ok: false })
    )
    return true
  })
}
