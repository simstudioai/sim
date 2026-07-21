import { createHash } from 'node:crypto'
import type { ScenarioNamespaceDescriptor } from './scenario'

const EMAIL_DOMAIN = 'example.com'

export interface ScenarioNamespace extends ScenarioNamespaceDescriptor {
  email(label: string): string
  slug(label: string): string
  name(label: string): string
  invitationToken(label: string): string
  storageStateFilename(personaKey: string): string
}

/**
 * Namespaces only values the fixture controls. Production IDs are deliberately absent from this API.
 */
export function createScenarioNamespace(run: string, world: string): ScenarioNamespace {
  const normalizedRun = normalizePart(run, 'run')
  const normalizedWorld = normalizePart(world, 'world')
  const digest = hash(`${run}\0${world}`).slice(0, 8)
  const prefix = `e2e-${normalizedRun.slice(0, 10)}-${normalizedWorld.slice(0, 10)}-${digest}`

  return Object.freeze({
    run,
    world,
    prefix,
    email(label: string): string {
      return `${prefix}-${shortLabel(label, 11)}-${hash(label).slice(0, 8)}@${EMAIL_DOMAIN}`
    },
    slug(label: string): string {
      return `${prefix}-${shortLabel(label, 18)}-${hash(label).slice(0, 8)}`
    },
    name(label: string): string {
      return `E Two E ${humanize(world)} ${humanize(label)} ${alphabeticHash(
        `${prefix}\0${label}`
      )}`
    },
    invitationToken(label: string): string {
      const normalizedLabel = normalizeLabel(label).slice(0, 24)
      return `${prefix}.invite.${normalizedLabel}.${hash(`${prefix}\0${label}`).slice(0, 12)}`
    },
    storageStateFilename(personaKey: string): string {
      return `${prefix}-${shortLabel(personaKey, 20)}-${hash(personaKey).slice(0, 8)}.json`
    },
  })
}

function normalizePart(value: string, label: string): string {
  const normalized = normalizeLabel(value)
  if (!normalized) throw new Error(`Scenario namespace ${label} must contain a letter or number`)
  return normalized
}

function normalizeLabel(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!normalized) throw new Error('Namespaced value label must contain a letter or number')
  return normalized
}

function humanize(value: string): string {
  const normalized = normalizeLabel(value)
  return normalized
    .split('-')
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function shortLabel(value: string, length: number): string {
  return normalizeLabel(value).slice(0, length).replace(/-+$/, '')
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function alphabeticHash(value: string): string {
  return hash(value)
    .slice(0, 8)
    .replace(/[0-9a-f]/g, (character) =>
      String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(character, 16))
    )
}
