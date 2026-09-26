import { isRecordLike } from '@sim/utils/object'
import { StudioFixture } from '@studio/_components/studio-fixture'
import type { StudioSample } from '@studio/_lib/manifest'

interface FixturePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function parseJsonParam(raw: string, limit: number): unknown {
  if (!raw || raw.length >= limit) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function parseVariants(raw: string): Record<string, string> | undefined {
  const parsed = parseJsonParam(raw, 1000)
  if (!isRecordLike(parsed)) return undefined
  const entries = Object.entries(parsed)
  if (entries.length > 12) return undefined
  const variants: Record<string, string> = {}
  for (const [axis, selection] of entries) {
    if (!/^[a-zA-Z][\w-]*$/.test(axis) || typeof selection !== 'string' || selection.length > 100)
      return undefined
    variants[axis] = selection
  }
  return variants
}

function isStudioSample(value: unknown): value is StudioSample {
  return (
    isRecordLike(value) &&
    typeof value.kind === 'string' &&
    ['control', 'text', 'surface', 'swatch', 'runtime'].includes(value.kind) &&
    typeof value.tag === 'string' &&
    typeof value.className === 'string' &&
    Array.isArray(value.values) &&
    value.values.every((item: unknown) => typeof item === 'string') &&
    typeof value.property === 'string' &&
    typeof value.value === 'string'
  )
}

function parseSample(raw: string): StudioSample | undefined {
  const parsed = parseJsonParam(raw, 5000)
  return isStudioSample(parsed) ? parsed : undefined
}

/** Isolated, development-only capture surface for a single source-backed fixture. */
export default async function FixturePage({ searchParams }: FixturePageProps) {
  const params = await searchParams
  const value = (key: string) => {
    const input = params[key]
    return typeof input === 'string' ? input : ''
  }
  return (
    <StudioFixture
      kind={value('kind')}
      id={value('id')}
      theme={value('theme') === 'light' ? 'light' : 'dark'}
      rootSize={value('size') === '20' ? 20 : 16}
      state={value('state')}
      variants={parseVariants(value('variants'))}
      interactive={value('interactive') === '1'}
      sample={parseSample(value('sample'))}
      variant={
        value('axis') && value('value') ? { axis: value('axis'), value: value('value') } : undefined
      }
    />
  )
}
