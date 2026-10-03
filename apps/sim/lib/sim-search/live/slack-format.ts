/** Provider labels are enough for display; search never waits for directory lookups. */
export function slackConversationName(name: string, channelId = ''): string {
  const normalized = name.replace(/^#/, '').trim()
  if (normalized.startsWith('mpdm-')) {
    const members = normalized.slice(5).replace(/-\d+$/, '').split('--').filter(Boolean)
    return members.length ? `Group DM · ${members.map(displayHandle).join(', ')}` : 'Group DM'
  }
  if (channelId.startsWith('D'))
    return normalized && normalized !== channelId
      ? `DM · ${displayHandle(normalized)}`
      : 'Direct message'
  return normalized && normalized !== channelId ? `#${normalized}` : 'Slack conversation'
}

function displayHandle(value: string): string {
  return value.replace(/[._]/g, ' ').replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
}

/** Slack escapes only these three entities in message text. */
function decodeSlackText(value: string): string {
  return value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
}

export function slackPlainText(
  text: string,
  users: ReadonlyMap<string, string> = new Map()
): string {
  return decodeSlackText(
    text
      .replace(
        /<@([A-Z0-9]+)(?:\|([^>]+))?>/g,
        (_tag, id: string, label?: string) => `@${label || users.get(id) || 'Slack member'}`
      )
      .replace(/<#([A-Z0-9]+)(?:\|([^>]+))?>/g, (_tag, id: string, label?: string) =>
        slackConversationName(label ?? '', id)
      )
      .replace(
        /<!subteam\^[A-Z0-9]+(?:\|([^>]+))?>/g,
        (_tag, label?: string) => label || 'Slack group'
      )
      .replace(/<!(here|channel|everyone)>/g, '@$1')
      .replace(/<!date\^[^|>]+\|([^>]+)>/g, '$1')
      .replace(/<(https?:\/\/[^|>]+)(?:\|([^>]+))?>/g, (_tag, url: string, label?: string) =>
        label && label !== url ? `${label} (${url})` : url
      )
  )
}

/** Derive the conversation destination only from a provider-returned Slack permalink. */
export function slackConversationUrl(permalink: string, channelId: string): string | undefined {
  if (!/^[CDG][A-Z0-9]+$/.test(channelId)) return undefined
  try {
    const url = new URL(permalink)
    if (
      url.protocol !== 'https:' ||
      !url.hostname.endsWith('.slack.com') ||
      url.username ||
      url.password
    )
      return undefined
    return `${url.origin}/archives/${channelId}`
  } catch {
    return undefined
  }
}
