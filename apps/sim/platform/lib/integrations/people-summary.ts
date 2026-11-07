import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'

const list = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' })

export function peopleSummary(people: readonly IntegrationPerson[], total = people.length) {
  const shown = people.slice(0, 2)
  const remaining = Math.max(0, total - shown.length, people.length - shown.length)
  const labels = shown.map((person) => person.name)
  if (remaining > 0)
    labels.push(
      `${remaining.toLocaleString('en-US')} ${shown.length ? (remaining === 1 ? 'other' : 'others') : remaining === 1 ? 'person' : 'people'}`
    )
  if (!labels.length) return undefined
  return {
    people: shown,
    parts: list.formatToParts(labels),
    label: list.format(labels),
  }
}
