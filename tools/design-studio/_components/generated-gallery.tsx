'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { StudioEntry, StudioManifest } from '@studio/_lib/manifest'
import Link from 'next/link'

interface GeneratedGalleryProps {
  manifest: StudioManifest
  stale: boolean
  ledgerStale: boolean
  mode: 'components' | 'extras'
}

interface StudioTreatment {
  key: string
  family: string
  title: string
  entries: StudioEntry[]
}

interface NavigationGroup {
  name: string
  treatments: StudioTreatment[]
}

interface TreatmentSelection {
  entryId?: string
  variants: Record<string, string>
}

const REVIEW_FAMILY_NAMES: Record<string, string> = {
  'central-artwork': 'Product artwork',
  'central-colour': 'Colours',
  'central-colour-assignment': 'Runtime colours',
  'central-radius': 'Corner radii',
  'central-typography': 'EMCN typography',
  'component-chrome': 'Component styling',
  'emcn-recipe-override': 'EMCN styling overrides',
  'local-alpha': 'Local opacity',
  'local-control': 'Local controls',
  'local-typography': 'Local typography',
  'local-visual-primitive': 'Visual primitives',
  'mixed-product-artwork': 'Mixed artwork',
  'repeated-treatment': 'Repeated treatments',
  'runtime-style': 'Runtime styling',
  'runtime-style-customer-brand': 'Customer branding',
  'runtime-style-editor-tooltip': 'Editor tooltips',
  'shared-product-recipe': 'Shared product recipes',
  'stock-shadow': 'Stock shadows',
  'styled-native-control': 'Styled native controls',
}

const ELEMENT_ROLE_NAMES: Record<string, string> = {
  a: 'Link',
  button: 'Button',
  div: 'Surface',
  h1: 'Heading',
  h2: 'Heading',
  img: 'Image',
  input: 'Input',
  span: 'Text',
  textarea: 'Text area',
}

function formatFamily(family: string): string {
  if (REVIEW_FAMILY_NAMES[family]) return REVIEW_FAMILY_NAMES[family]
  return family.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatExportName(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
}

function formatExtraName(name: string): string {
  const [owner, target] = name.split(' / ')
  const ownerName = formatExportName(owner.replaceAll('_', ' '))
  if (target?.startsWith('@sim/emcn#')) {
    return `${ownerName} · ${formatExportName(target.slice('@sim/emcn#'.length))}`
  }
  if (target) {
    const element = target.split(' / ')[0]
    if (owner === 'css') return `CSS · ${element.slice(0, 40)}`
    return `${ownerName} · ${ELEMENT_ROLE_NAMES[element] ?? formatExportName(element)}`
  }
  return formatExportName(name.replaceAll('_', ' '))
}

function sourceFileName(file: string): string {
  return file.split('/').at(-1) ?? file
}

function extraShortValue(entry: StudioEntry): string {
  if (entry.family.includes('artwork')) return 'Product artwork'
  const value = entry.value ?? entry.fixture?.sample?.values[0]
  if (!value) return sourceFileName(entry.source.file)
  if (/^[a-f0-9]{32,}$/i.test(value)) return 'Source fingerprint'
  return value.length > 52 ? `${value.slice(0, 49)}…` : value
}

function treatmentKey(entry: StudioEntry): string {
  const fixture = entry.fixture
  if (fixture?.type === 'sample' && fixture.sample) {
    const sample = fixture.sample
    if (sample.className || sample.values.length) {
      return JSON.stringify(['sample', sample.kind, sample.tag, sample.className, sample.values])
    }
    return JSON.stringify([
      'source-location',
      entry.source.file,
      entry.source.line,
      sample.kind,
      sample.property,
      sample.value,
    ])
  }
  if (entry.id.startsWith('shadow-extra:') || entry.id.startsWith('typography-extra:')) {
    return entry.id
  }
  if (fixture?.type === 'extra') return `source-component:${fixture.id}`
  return entry.id
}

function groupExtras(entries: StudioEntry[]): StudioTreatment[] {
  const groups = new Map<string, StudioEntry[]>()
  for (const entry of entries) {
    const key = treatmentKey(entry)
    const group = groups.get(key) ?? []
    group.push(entry)
    groups.set(key, group)
  }
  return [...groups].map(([key, members]) => {
    const names = new Set(members.map((member) => member.name))
    const locations = new Set(
      members.map((member) => `${member.source.file}:${member.source.line}`)
    )
    const sample = members[0].fixture?.sample
    const title =
      names.size > 1 && locations.size > 1 && sample?.className
        ? `${formatExportName(sample.tag)} · ${extraShortValue(members[0])}`
        : formatExtraName(members[0].name)
    return { key, family: members[0].family, title, entries: members }
  })
}

function groupComponents(entries: StudioEntry[]): StudioTreatment[] {
  const groups = new Map<string, StudioEntry[]>()
  const ownerGroups = new Map<string, string>()
  for (const entry of entries.filter((item) => !item.variant)) {
    // Structural exports can share a composite preview. Variants belong to the
    // section for their owning export rather than creating another section.
    const key =
      entry.status === 'ready' && entry.previewFingerprint
        ? `${entry.family}:${entry.previewFingerprint}`
        : entry.id
    const group = groups.get(key) ?? []
    group.push(entry)
    groups.set(key, group)
    ownerGroups.set(entry.id, key)
  }
  for (const entry of entries.filter((item) => item.variant)) {
    const ownerId = entry.id.slice(0, entry.id.lastIndexOf(':'))
    const key = ownerGroups.get(ownerId) ?? entry.id
    const group = groups.get(key) ?? []
    group.push(entry)
    groups.set(key, group)
  }
  return [...groups].map(([key, members]) => {
    const exports = members.filter((member) => !member.variant)
    const named = exports.length ? exports : members
    return {
      key,
      family: members[0].family,
      title:
        named.length > 1 && members[0].family !== 'Icons'
          ? formatFamily(members[0].family)
          : named.length > 1
            ? named.map((member) => formatExportName(member.name)).join(' / ')
            : formatExportName(named[0].name),
      entries: members,
    }
  })
}

function componentNavigationGroup(treatment: StudioTreatment): string {
  if (treatment.entries.every((entry) => entry.kind === 'icon')) return 'Icons'
  if (
    treatment.entries.some((entry) =>
      entry.source.file.startsWith('packages/emcn/src/components/charts/')
    )
  ) {
    return 'Charts'
  }
  return 'Components'
}

interface SourceSitesProps {
  entries: StudioEntry[]
}

interface EntryLocationsProps {
  entry: StudioEntry
  className: string
}

function EntryLocations({ entry, className }: EntryLocationsProps) {
  return (
    <div className={className}>
      <p className='break-all'>
        Defined: {entry.source.file}:{entry.source.line}
      </p>
      {entry.usages.map((site, index) => (
        <p key={`${site.file}:${site.line}:${index}`} className='break-all'>
          {site.relationship ?? 'direct'}: {site.file}:{site.line}
        </p>
      ))}
      {!entry.usages.length ? <p>No direct product render sites found.</p> : null}
    </div>
  )
}

function SourceSites({ entries }: SourceSitesProps) {
  const entry = entries[0]
  if (entries.length > 1) {
    return (
      <details className='border-[var(--border)] border-t px-5 py-3'>
        <summary className='cursor-pointer text-[var(--text-secondary)] text-xs'>
          Exports and uses ({entries.length})
        </summary>
        <div className='mt-3 space-y-2 text-xs'>
          {entries.map((item) => (
            <details key={item.id} className='rounded-md border border-[var(--border)] px-3 py-2'>
              <summary className='cursor-pointer text-[var(--text-body)]'>
                {item.name} · {item.usages.length} uses
              </summary>
              <EntryLocations
                entry={item}
                className='mt-2 space-y-1 font-mono text-[11px] text-[var(--text-muted)]'
              />
            </details>
          ))}
        </div>
      </details>
    )
  }
  return (
    <details className='border-[var(--border)] border-t px-5 py-3'>
      <summary className='cursor-pointer text-[var(--text-secondary)] text-xs'>
        Source and uses ({entry.usages.length})
      </summary>
      <EntryLocations
        entry={entry}
        className='mt-3 space-y-1 font-mono text-[11px] text-[var(--text-body)]'
      />
    </details>
  )
}

interface ExtraPanelProps {
  entries: StudioEntry[]
  id: string
}

function ExtraSourcePanel({ entries, id }: ExtraPanelProps) {
  const files = new Map<string, Set<number>>()
  for (const site of entries.flatMap((entry) => [entry.source, ...entry.usages])) {
    const lines = files.get(site.file) ?? new Set<number>()
    lines.add(site.line)
    files.set(site.file, lines)
  }
  const locationCount = [...files.values()].reduce((total, lines) => total + lines.size, 0)

  return (
    <details
      id={id}
      className='group scroll-mt-24 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]'
    >
      <summary className='flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 [&::-webkit-details-marker]:hidden'>
        <span className='min-w-0'>
          <span className='block font-medium text-[var(--text-primary)] text-sm'>
            Where it appears
          </span>
          <span className='mt-1 block truncate text-[var(--text-muted)] text-xs'>
            {files.size} {files.size === 1 ? 'file' : 'files'} · {locationCount}{' '}
            {locationCount === 1 ? 'location' : 'locations'} ·{' '}
            {sourceFileName(entries[0].source.file)}
          </span>
        </span>
        <span
          aria-hidden='true'
          className='text-[var(--text-muted)] transition-transform group-open:rotate-90'
        >
          ›
        </span>
      </summary>
      <div className='space-y-3 border-[var(--border)] border-t px-5 py-4'>
        {[...files].map(([file, lines]) => (
          <div key={file} className='min-w-0'>
            <p className='font-medium text-[var(--text-body)] text-xs'>{sourceFileName(file)}</p>
            <p className='mt-1 break-all font-mono text-[11px] text-[var(--text-muted)]'>{file}</p>
            <p className='mt-1 text-[var(--text-secondary)] text-xs'>
              {lines.size === 1 ? 'Line' : 'Lines'} {[...lines].sort((a, b) => a - b).join(', ')}
            </p>
          </div>
        ))}
      </div>
    </details>
  )
}

function ExtraEvidencePanel({ entries, id }: ExtraPanelProps) {
  const groups = new Map<string, StudioEntry[]>()
  for (const entry of entries) {
    const signals = groups.get(entry.family) ?? []
    signals.push(entry)
    groups.set(entry.family, signals)
  }

  return (
    <details
      id={id}
      className='group scroll-mt-24 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]'
    >
      <summary className='flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 [&::-webkit-details-marker]:hidden'>
        <span className='min-w-0'>
          <span className='block font-medium text-[var(--text-primary)] text-sm'>
            Why it was detected
          </span>
          <span className='mt-1 block text-[var(--text-muted)] text-xs'>
            {entries.length} {entries.length === 1 ? 'signal' : 'signals'} across {groups.size}{' '}
            {groups.size === 1 ? 'rule' : 'rules'}
          </span>
        </span>
        <span
          aria-hidden='true'
          className='text-[var(--text-muted)] transition-transform group-open:rotate-90'
        >
          ›
        </span>
      </summary>
      <div className='space-y-5 border-[var(--border)] border-t px-5 py-4'>
        {[...groups].map(([family, signals]) => (
          <div key={family}>
            <div className='flex items-center justify-between gap-3'>
              <h4 className='font-medium text-[var(--text-primary)] text-xs'>
                {formatFamily(family)}
              </h4>
              <span className='text-[11px] text-[var(--text-muted)]'>{signals.length}</span>
            </div>
            <div className='mt-2 divide-y divide-[var(--border)]'>
              {signals.map((signal) => (
                <div key={signal.id} className='py-3 first:pt-1 last:pb-0'>
                  <p className='break-words font-mono text-[var(--text-body)] text-xs'>
                    {extraShortValue(signal)}
                  </p>
                  <p className='mt-1 text-[var(--text-muted)] text-xs'>
                    {sourceFileName(signal.source.file)}:{signal.source.line}
                  </p>
                  {signal.rationale ? (
                    <p className='mt-2 text-[var(--text-secondary)] text-xs leading-relaxed'>
                      {signal.rationale}
                    </p>
                  ) : null}
                  <details className='mt-2 text-[11px] text-[var(--text-muted)]'>
                    <summary className='w-fit cursor-pointer hover:text-[var(--text-primary)]'>
                      Technical details
                    </summary>
                    <div className='mt-2 space-y-1 break-all font-mono'>
                      <p>
                        {signal.source.file}:{signal.source.line}
                      </p>
                      {signal.value ? <p>Value: {signal.value}</p> : null}
                      <p>ID: {signal.id}</p>
                      {signal.decision && signal.decision !== 'unreviewed' ? (
                        <p>
                          {signal.decision === 'scanner-classified'
                            ? 'Scanner classification'
                            : 'Prior review'}
                          : {signal.decision}
                        </p>
                      ) : null}
                    </div>
                  </details>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  )
}

interface PreviewSurfaceProps {
  entry: StudioEntry
  fixtureUrl: string | null
}

function PreviewSurface({ entry, fixtureUrl }: PreviewSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [nearViewport, setNearViewport] = useState(false)
  const [readyFrame, setReadyFrame] = useState<{ frame: HTMLIFrameElement; url: string } | null>(
    null
  )
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const hasFixture = Boolean(fixtureUrl)
  const compact = entry.kind === 'extra' && entry.fixture?.type === 'sample'

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface || !hasFixture) return
    if (!('IntersectionObserver' in window)) {
      setNearViewport(true)
      return
    }
    const observer = new IntersectionObserver(
      ([record]) => {
        setNearViewport(record.isIntersecting)
        if (!record.isIntersecting) setReadyFrame(null)
      },
      { rootMargin: '600px 0px' }
    )
    observer.observe(surface)
    return () => observer.disconnect()
  }, [hasFixture])

  const liveReady =
    hasFixture && nearViewport && readyFrame?.url === fixtureUrl && readyFrame.frame.isConnected
  const liveFailed = hasFixture && failedUrl === fixtureUrl

  const checkFrame = (frame: HTMLIFrameElement, url: string, attempt = 0) => {
    if (!frame.isConnected) return
    try {
      const document = frame.contentDocument
      if (document?.querySelector('[data-studio-unavailable]')) {
        setFailedUrl(url)
        return
      }
      if (document?.querySelector('[data-studio-fixture]')) {
        void document.fonts.ready.then(
          () => {
            if (frame.isConnected) setReadyFrame({ frame, url })
          },
          () => {
            if (frame.isConnected) setFailedUrl(url)
          }
        )
        return
      }
    } catch {
      setFailedUrl(url)
      return
    }
    if (attempt < 50) {
      window.setTimeout(() => checkFrame(frame, url, attempt + 1), 100)
    } else {
      setFailedUrl(url)
    }
  }

  return (
    <div ref={surfaceRef}>
      <div
        className={`relative flex items-center justify-center overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-5 sm:p-6 ${compact ? 'min-h-[330px]' : 'min-h-[410px]'}`}
      >
        {hasFixture && nearViewport && !liveFailed && fixtureUrl ? (
          <iframe
            key={fixtureUrl}
            title={`${entry.name} interactive preview`}
            src={fixtureUrl}
            onLoad={(event) => checkFrame(event.currentTarget, fixtureUrl)}
            onError={() => setFailedUrl(fixtureUrl)}
            tabIndex={liveReady ? 0 : -1}
            aria-hidden={!liveReady}
            className={`${compact ? 'h-[280px]' : 'h-[360px]'} w-full border-0 ${liveReady ? '' : 'pointer-events-none absolute opacity-0'}`}
          />
        ) : null}
        {!liveReady ? (
          liveFailed ? (
            <div className='text-center text-[var(--text-muted)] text-sm' role='status'>
              <p>The live fixture could not be loaded.</p>
              <button
                type='button'
                onClick={() => setFailedUrl(null)}
                className='mt-3 rounded-md border border-[var(--border)] px-3 py-2 text-[var(--text-primary)]'
              >
                Retry preview
              </button>
            </div>
          ) : hasFixture && nearViewport ? (
            <div className='flex items-center gap-3 text-[var(--text-muted)] text-sm' role='status'>
              <span
                aria-hidden='true'
                className='size-5 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--text-primary)]'
              />
              Loading preview…
            </div>
          ) : hasFixture ? null : (
            <p className='max-w-md text-center text-[var(--text-muted)] text-sm'>
              A source-backed fixture is required before this treatment can be previewed.
            </p>
          )
        ) : null}
      </div>
    </div>
  )
}

interface TreatmentDetailProps {
  treatment: StudioTreatment
  theme: 'light' | 'dark'
  size: 16 | 20
  requestedState: string
  anchor: string
  selectedEntryId?: string
  selectedVariants?: Record<string, string>
  onSelectEntry: (id: string) => void
  onSelectVariant: (axis: string, value: string) => void
}

function previewProvenance(entry: StudioEntry): string {
  if (entry.kind === 'extra') {
    return entry.previewKind === 'source-component'
      ? 'Live product source'
      : 'Indicative live preview from detected styling'
  }
  if (entry.fixture?.type === 'icon') {
    return 'Production EMCN icon through the generic fixture adapter'
  }
  if (entry.previewKind === 'source-style-sample') {
    return 'Indicative sample using classes or values extracted from product source'
  }
  if (entry.previewKind === 'indicative-sample') {
    return 'Indicative sample; the source has no standalone visual fixture'
  }
  return entry.fixture
    ? 'Production source mounted with fixed fixture data'
    : 'Source fixture still required'
}

function TreatmentDetail({
  treatment,
  theme,
  size,
  requestedState,
  anchor,
  selectedEntryId,
  selectedVariants,
  onSelectEntry,
  onSelectVariant,
}: TreatmentDetailProps) {
  const { entries } = treatment
  const exports = entries.filter((item) => !item.variant)
  const defaultEntry = exports.find((item) => item.status === 'ready') ?? exports[0] ?? entries[0]
  const selectedEntry = entries.find((item) => item.id === selectedEntryId) ?? defaultEntry
  const isExtra = selectedEntry.kind === 'extra'
  const ownerId = selectedEntry.variant
    ? selectedEntry.id.slice(0, selectedEntry.id.lastIndexOf(':'))
    : selectedEntry.id
  const owner = exports.find((item) => item.id === ownerId) ?? defaultEntry
  const entry = isExtra ? selectedEntry : owner
  const axes = new Map<string, StudioEntry[]>()
  for (const item of entries) {
    if (!item.variant || !item.id.startsWith(`${owner.id}:`)) continue
    const options = axes.get(item.variant.axis) ?? []
    options.push(item)
    axes.set(item.variant.axis, options)
  }
  const requestedVariants =
    selectedVariants ??
    (selectedEntry.variant ? { [selectedEntry.variant.axis]: selectedEntry.variant.value } : {})
  const activeVariants: Record<string, string> = {}
  for (const [axis, options] of axes) {
    const value = requestedVariants[axis]
    if (value && options.some((option) => option.variant?.value === value && !!option.fixture)) {
      activeVariants[axis] = value
    }
  }
  const stateAvailable =
    requestedState === 'default' || Boolean(entry.states?.includes(requestedState))
  const previewState = stateAvailable ? requestedState : 'default'
  const selectedKey = `${theme}-${size}${previewState === 'default' ? '' : `-${previewState}`}`
  const failedCount = entries.filter((item) => item.status !== 'ready').length
  const stateUnavailable = !stateAvailable
  const sourceFileCount = isExtra ? new Set(entries.map((item) => item.source.file)).size : 0
  const ownedSignals = [
    ...new Map(
      exports.flatMap((item) => item.signals ?? []).map((signal) => [signal.id, signal])
    ).values(),
  ]
  const fixtureQuery = entry.fixture
    ? new URLSearchParams({
        kind: entry.fixture.type,
        id: entry.fixture.id,
        theme,
        size: String(size),
        state: previewState,
        ...(entry.kind === 'component' ? { interactive: '1' } : {}),
        ...(Object.keys(activeVariants).length ? { variants: JSON.stringify(activeVariants) } : {}),
        ...(entry.fixture.sample ? { sample: JSON.stringify(entry.fixture.sample) } : {}),
      }).toString()
    : null

  return (
    <article className='min-w-0'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div className='min-w-0'>
          <p className='text-[var(--text-muted)] text-xs uppercase tracking-widest'>
            {formatFamily(treatment.family)} ·{' '}
            {entry.kind === 'extra' ? 'Detected treatment' : 'EMCN'}
          </p>
          <h2 className='mt-3 break-words font-season text-3xl text-[var(--text-primary)] sm:text-4xl'>
            {treatment.title}
          </h2>
          <p className='mt-3 max-w-3xl text-[var(--text-body)] text-sm leading-relaxed'>
            {isExtra
              ? (entry.rationale ??
                `A visual treatment detected in ${sourceFileName(entry.source.file)}.`)
              : exports.length > 1
                ? `${exports.length} public exports share this preview. Choose an export to inspect its variants, then open the source list for product uses.`
                : `Source-backed preview of ${entry.name}, with its definition and product uses below.`}
          </p>
          {isExtra ? (
            <div className='mt-5 flex flex-wrap items-center gap-2 text-[var(--text-secondary)] text-xs'>
              <span className='rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1'>
                {entries.length} {entries.length === 1 ? 'signal' : 'signals'}
              </span>
              <span className='rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1'>
                {sourceFileCount} {sourceFileCount === 1 ? 'file' : 'files'}
              </span>
              <span className='rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1'>
                {entry.previewKind === 'source-component' ? 'Product source' : 'Indicative sample'}
              </span>
            </div>
          ) : null}
        </div>
        <span className='rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1 text-[var(--text-secondary)] text-xs'>
          {entry.status !== 'ready'
            ? entry.status === 'needs-fixture'
              ? 'Needs fixture'
              : 'Fixture check failed'
            : failedCount
              ? `${failedCount} fixture gaps`
              : 'Fixture ready'}
        </span>
      </div>

      <section id={`${anchor}-preview`} className='mt-10 scroll-mt-8'>
        <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
          <h3 className='font-season text-xl'>Preview</h3>
          {fixtureQuery ? (
            <a
              href={`/fixture?${fixtureQuery}`}
              className='rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text-body)] text-xs hover:text-[var(--text-primary)]'
            >
              Open live fixture ↗
            </a>
          ) : null}
        </div>
        {entry.kind === 'component' && (exports.length > 1 || axes.size > 0) ? (
          <div className='mb-5 flex flex-wrap items-end gap-3'>
            {exports.length > 1 ? (
              <label className='flex min-w-40 flex-col gap-1 text-[var(--text-secondary)] text-xs'>
                Export
                <select
                  value={owner.id}
                  onChange={(event) => onSelectEntry(event.target.value)}
                  className='rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text-primary)]'
                >
                  {exports.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {[...axes].map(([axis, options]) => (
              <label
                key={axis}
                className='flex min-w-36 flex-col gap-1 text-[var(--text-secondary)] text-xs'
              >
                {axis}
                <select
                  value={activeVariants[axis] ?? ''}
                  onChange={(event) => onSelectVariant(axis, event.target.value)}
                  className='rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text-primary)]'
                >
                  <option value=''>
                    Default
                    {options[0].variant?.defaultValue
                      ? ` (${options[0].variant.defaultValue})`
                      : ''}
                  </option>
                  {options.map((option) => (
                    <option
                      key={option.id}
                      value={option.variant?.value}
                      disabled={!option.fixture}
                    >
                      {option.variant?.value}
                      {!option.fixture ? ' · Needs fixture' : ''}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {axes.size > 1 ? (
              <p className='pb-2 text-[var(--text-muted)] text-xs'>
                Options combine in the live preview. The scan records each choice against the
                defaults.
              </p>
            ) : null}
          </div>
        ) : null}
        <PreviewSurface
          entry={entry}
          fixtureUrl={fixtureQuery ? `/fixture?${fixtureQuery}` : null}
        />
        <div className='mt-3 flex flex-wrap items-center justify-between gap-x-5 gap-y-1 text-[var(--text-muted)] text-xs'>
          <span>{previewProvenance(entry)}</span>
          {!isExtra ? (
            <span>
              {stateUnavailable
                ? `${requestedState} state unavailable; showing default`
                : selectedKey}
            </span>
          ) : null}
        </div>
      </section>

      {isExtra ? (
        <div className='mt-8 grid items-start gap-3 md:grid-cols-2'>
          <ExtraSourcePanel entries={entries} id={`${anchor}-source`} />
          <ExtraEvidencePanel entries={entries} id={`${anchor}-signals`} />
        </div>
      ) : (
        <section id={`${anchor}-source`} className='mt-12 scroll-mt-8'>
          <h3 className='font-season text-xl'>Source and product uses</h3>
          <p className='mt-2 break-all font-mono text-[var(--text-muted)] text-xs'>
            {entry.source.file}:{entry.source.line}
          </p>
          <div className='mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)]'>
            <SourceSites entries={exports.length ? exports : [entry]} />
          </div>
        </section>
      )}

      {!isExtra && ownedSignals.length ? (
        <section id={`${anchor}-signals`} className='mt-12 scroll-mt-8'>
          <h3 className='font-season text-xl'>Signals in EMCN source</h3>
          <p className='mt-2 text-[var(--text-muted)] text-sm'>
            Scanner signals associated with the source of this export.
          </p>
          <div className='mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)]'>
            {ownedSignals.map((signal) => (
              <p
                key={signal.id}
                className='border-[var(--border)] border-b px-5 py-4 text-[var(--text-body)] text-xs last:border-0'
              >
                {signal.kind}: {signal.value} · {signal.source.file}:{signal.source.line}
              </p>
            ))}
          </div>
        </section>
      ) : null}
    </article>
  )
}

/** Displays one immutable local scan run, including incomplete coverage. */
export function GeneratedGallery({ manifest, stale, ledgerStale, mode }: GeneratedGalleryProps) {
  const [query, setQuery] = useState('')
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [size, setSize] = useState<16 | 20>(16)
  const [captureState, setCaptureState] = useState('default')
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [selections, setSelections] = useState<Record<string, TreatmentSelection>>({})
  const [mobileBrowse, setMobileBrowse] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const navigationInProgress = useRef(false)
  const visibleKeys = useRef<Set<string>>(new Set())
  const entries = mode === 'components' ? manifest.components : manifest.extras
  const treatments = useMemo(
    () => (mode === 'extras' ? groupExtras(entries) : groupComponents(entries)),
    [entries, mode]
  )
  const anchors = useMemo(
    () => new Map(treatments.map((treatment, index) => [treatment.key, `treatment-${index}`])),
    [treatments]
  )
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase()
    return text
      ? treatments.filter((treatment) =>
          [
            treatment.title,
            ...treatment.entries.map(
              (entry) => `${entry.name} ${entry.family} ${entry.source.file} ${entry.value ?? ''}`
            ),
          ].some((value) => value.toLowerCase().includes(text))
        )
      : treatments
  }, [treatments, query])
  const navigationGroups = useMemo((): NavigationGroup[] => {
    const grouped = new Map<string, StudioTreatment[]>()
    for (const treatment of filtered) {
      const groupName =
        mode === 'components' ? componentNavigationGroup(treatment) : formatFamily(treatment.family)
      const members = grouped.get(groupName) ?? []
      members.push(treatment)
      grouped.set(groupName, members)
    }
    const order = mode === 'components' ? ['Components', 'Charts', 'Icons'] : []
    return [...grouped]
      .sort(([left], [right]) => {
        if (mode === 'extras' && left === formatFamily('central-artwork')) return -1
        if (mode === 'extras' && right === formatFamily('central-artwork')) return 1
        return mode === 'components'
          ? order.indexOf(left) - order.indexOf(right)
          : left.localeCompare(right)
      })
      .map(([name, members]) => ({
        name,
        treatments: members.sort((left, right) => left.title.localeCompare(right.title)),
      }))
  }, [filtered, mode])
  const ordered = useMemo(
    () => navigationGroups.flatMap((group) => group.treatments),
    [navigationGroups]
  )
  const activeTreatment = ordered.find((treatment) => treatment.key === activeKey) ?? ordered[0]
  const activeAnchor = activeTreatment ? anchors.get(activeTreatment.key) : undefined
  const activeExtraGroup =
    mode === 'extras' && activeTreatment ? formatFamily(activeTreatment.family) : null
  const [openExtraGroup, setOpenExtraGroup] = useState<string | null>(activeExtraGroup)
  const previousActiveExtraGroup = useRef(activeExtraGroup)
  const hasSignals = Boolean(
    activeTreatment?.entries.some((entry) => entry.kind === 'extra' || entry.signals?.length)
  )

  useEffect(() => {
    visibleKeys.current = new Set(filtered.map((treatment) => treatment.key))
  }, [filtered])

  useEffect(() => {
    if (activeExtraGroup !== previousActiveExtraGroup.current) {
      setOpenExtraGroup(activeExtraGroup)
      previousActiveExtraGroup.current = activeExtraGroup
    }
  }, [activeExtraGroup])

  useEffect(() => {
    const syncFromHash = () => {
      let hash: string
      try {
        hash = decodeURIComponent(window.location.hash.slice(1))
      } catch {
        return
      }
      if (!hash || hash === 'run') return
      const target = treatments.find(
        (treatment) =>
          hash === anchors.get(treatment.key) ||
          hash.startsWith(`${anchors.get(treatment.key)}-`) ||
          treatment.entries.some((entry) => entry.id === hash)
      )
      if (!target) return
      const anchor = anchors.get(target.key)
      if (!anchor) return
      const destination = hash === `${anchor}-source` ? anchor : hash
      if (destination !== hash) window.history.replaceState(null, '', `#${destination}`)
      navigationInProgress.current = true
      if (!visibleKeys.current.has(target.key)) setQuery('')
      const linkedEntry = target.entries.find((entry) => entry.id === hash)
      if (linkedEntry) {
        const ownerId = linkedEntry.variant
          ? linkedEntry.id.slice(0, linkedEntry.id.lastIndexOf(':'))
          : linkedEntry.id
        setSelections((previous) => ({
          ...previous,
          [target.key]: {
            entryId: ownerId,
            variants: linkedEntry.variant
              ? { [linkedEntry.variant.axis]: linkedEntry.variant.value }
              : {},
          },
        }))
      }
      setActiveKey(target.key)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          document
            .getElementById(destination.startsWith(`${anchor}-`) ? destination : anchor)
            ?.scrollIntoView({ block: 'start', behavior: 'auto' })
          window.setTimeout(() => {
            navigationInProgress.current = false
            window.dispatchEvent(new Event('scroll'))
          }, 100)
        })
      )
    }
    syncFromHash()
    window.addEventListener('hashchange', syncFromHash)
    window.addEventListener('popstate', syncFromHash)
    return () => {
      window.removeEventListener('hashchange', syncFromHash)
      window.removeEventListener('popstate', syncFromHash)
    }
  }, [treatments, anchors])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setMobileBrowse(true)
        if (window.matchMedia('(min-width: 1024px)').matches) searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  useEffect(() => {
    if (mobileBrowse) searchRef.current?.focus()
  }, [mobileBrowse])

  useEffect(() => {
    if (!ordered.length) return
    let frame = 0
    const updateActive = () => {
      frame = 0
      if (navigationInProgress.current) return
      const line = 120
      let current = ordered[0]
      for (const treatment of ordered) {
        const anchor = anchors.get(treatment.key)
        const section = anchor ? document.getElementById(anchor) : null
        if (!section || section.getBoundingClientRect().top > line) break
        current = treatment
      }
      setActiveKey((previous) => (previous === current.key ? previous : current.key))
      const anchor = anchors.get(current.key)
      if (!anchor) return
      const runSection = document.getElementById('run')
      if (
        window.location.hash === '#run' &&
        runSection &&
        runSection.getBoundingClientRect().top <= line
      ) {
        return
      }
      const currentHash = window.location.hash.slice(1)
      if (currentHash !== anchor && !currentHash.startsWith(`${anchor}-`)) {
        window.history.replaceState(null, '', `#${anchor}`)
      }
    }
    const scheduleUpdate = () => {
      if (!frame) frame = requestAnimationFrame(updateActive)
    }
    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)
    scheduleUpdate()
    return () => {
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [ordered, anchors])

  useEffect(() => {
    if (!activeAnchor) return
    const item = sidebarRef.current?.querySelector<HTMLElement>(
      `[data-studio-nav="${activeAnchor}"]`
    )
    const sidebar = sidebarRef.current
    if (!item || !sidebar) return
    const stickyHeader = sidebar.querySelector<HTMLElement>('[data-studio-sidebar-header]')
    const upperEdge =
      stickyHeader?.getBoundingClientRect().bottom ?? sidebar.getBoundingClientRect().top
    const lowerEdge = sidebar.getBoundingClientRect().bottom - 16
    const itemBounds = item.getBoundingClientRect()
    if (itemBounds.top < upperEdge + 8) sidebar.scrollTop -= upperEdge + 8 - itemBounds.top
    else if (itemBounds.bottom > lowerEdge) sidebar.scrollTop += itemBounds.bottom - lowerEdge
  }, [activeAnchor, openExtraGroup])

  const selectTreatment = (treatment: StudioTreatment) => {
    const anchor = anchors.get(treatment.key)
    if (!anchor) return
    navigationInProgress.current = true
    setActiveKey(treatment.key)
    setMobileBrowse(false)
    window.history.pushState(null, '', `#${anchor}`)
    document.getElementById(anchor)?.scrollIntoView({ block: 'start', behavior: 'auto' })
    window.setTimeout(() => {
      navigationInProgress.current = false
      window.dispatchEvent(new Event('scroll'))
    }, 100)
  }

  return (
    <div className='min-h-screen lg:grid lg:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(0,1fr)_210px]'>
      {mobileBrowse ? (
        <button
          type='button'
          aria-label='Close browse panel'
          onClick={() => setMobileBrowse(false)}
          className='fixed inset-0 z-30 bg-black/50 lg:hidden'
        />
      ) : null}
      <aside
        ref={sidebarRef}
        aria-label='Catalog navigation'
        className={`${mobileBrowse ? 'block' : 'hidden'} fixed inset-y-0 left-0 z-40 w-[280px] overflow-y-auto border-[var(--border)] border-r bg-[var(--surface-2)] lg:sticky lg:inset-auto lg:top-4 lg:my-4 lg:ml-4 lg:block lg:h-[calc(100vh-2rem)] lg:w-auto lg:rounded-2xl lg:border`}
      >
        <div
          data-studio-sidebar-header
          className='sticky top-0 z-10 bg-[var(--surface-2)] px-5 pt-5 pb-4'
        >
          <Link href='/components' className='flex items-center gap-3 font-season text-lg'>
            <span className='flex size-8 items-center justify-center rounded-lg bg-[var(--text-primary)] font-sans text-[var(--bg)] text-sm'>
              S
            </span>
            <span>
              Sim <span className='text-[var(--text-muted)]'>Studio</span>
            </span>
          </Link>
          <nav
            aria-label='Studio pages'
            className='mt-6 grid grid-cols-2 gap-1 rounded-lg bg-[var(--bg)] p-1 text-center text-xs'
          >
            <Link
              href='/components'
              aria-current={mode === 'components' ? 'page' : undefined}
              className={`rounded-md px-2 py-2 ${mode === 'components' ? 'bg-[var(--surface-2)] font-medium text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            >
              EMCN
            </Link>
            <Link
              href='/extras'
              aria-current={mode === 'extras' ? 'page' : undefined}
              className={`rounded-md px-2 py-2 ${mode === 'extras' ? 'bg-[var(--surface-2)] font-medium text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            >
              Extras
            </Link>
          </nav>
          <label className='mt-5 block text-[var(--text-muted)] text-xs'>
            Search catalog
            <span className='mt-2 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2'>
              <span aria-hidden='true'>⌕</span>
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  window.scrollTo({ top: 0, behavior: 'auto' })
                }}
                placeholder='Search names or files'
                className='min-w-0 flex-1 bg-transparent text-[var(--text-primary)] text-xs outline-none placeholder:text-[var(--text-muted)]'
              />
              <kbd className='text-[10px] text-[var(--text-muted)]'>⌘K</kbd>
            </span>
          </label>
          <p className='mt-3 text-[var(--text-muted)] text-xs'>
            {filtered.length} {mode === 'extras' ? 'treatments' : 'components and icons'} shown
          </p>
        </div>
        <nav
          aria-label={mode === 'components' ? 'EMCN components' : 'Extra treatments'}
          className='space-y-6 px-3 py-5'
        >
          {navigationGroups.map((group) => (
            <section key={group.name} aria-label={group.name}>
              {mode === 'extras' && !query.trim() ? (
                <button
                  type='button'
                  aria-expanded={openExtraGroup === group.name}
                  onClick={() =>
                    setOpenExtraGroup((current) => (current === group.name ? null : group.name))
                  }
                  className='flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left font-semibold text-[10px] text-[var(--text-muted)] uppercase tracking-[0.12em] hover:bg-[var(--bg)] hover:text-[var(--text-primary)]'
                >
                  <span>{group.name}</span>
                  <span className='flex items-center gap-2 tabular-nums'>
                    {group.treatments.length}
                    <span aria-hidden='true'>{openExtraGroup === group.name ? '−' : '+'}</span>
                  </span>
                </button>
              ) : (
                <h2 className='flex justify-between px-3 pb-2 font-semibold text-[10px] text-[var(--text-muted)] uppercase tracking-[0.12em]'>
                  <span>{group.name}</span>
                  {mode === 'extras' ? <span>{group.treatments.length}</span> : null}
                </h2>
              )}
              {mode === 'components' || query.trim() || openExtraGroup === group.name ? (
                <div className='mt-1 space-y-0.5'>
                  {group.treatments.map((treatment) => {
                    const anchor = anchors.get(treatment.key)
                    const representative = treatment.entries[0]
                    return (
                      <button
                        key={treatment.key}
                        type='button'
                        data-studio-nav={anchor}
                        aria-current={activeTreatment?.key === treatment.key ? 'true' : undefined}
                        title={treatment.title}
                        onClick={() => selectTreatment(treatment)}
                        className={`block w-full rounded-md border-l-2 px-3 py-2 text-left text-sm ${activeTreatment?.key === treatment.key ? 'border-[var(--text-primary)] bg-[var(--bg)] font-medium text-[var(--text-primary)]' : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg)] hover:text-[var(--text-primary)]'}`}
                      >
                        <span className='block truncate'>{treatment.title}</span>
                        {mode === 'extras' ? (
                          <span className='mt-0.5 block truncate text-[11px] text-[var(--text-muted)]'>
                            {representative.family.includes('artwork')
                              ? sourceFileName(representative.source.file)
                              : extraShortValue(representative)}
                            {treatment.entries.length > 1
                              ? ` · ${treatment.entries.length} signals`
                              : ''}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </section>
          ))}
          {!filtered.length ? (
            <p className='px-3 py-8 text-[var(--text-muted)] text-xs'>
              No matches in this catalog.
            </p>
          ) : null}
        </nav>
      </aside>

      <div className='min-w-0'>
        <div className='flex items-center justify-between border-[var(--border)] border-b px-5 py-3 lg:hidden'>
          <button
            type='button'
            onClick={() => setMobileBrowse(true)}
            className='rounded-md border border-[var(--border)] px-3 py-2 text-xs'
          >
            Browse
          </button>
          <span className='font-season'>Sim Studio</span>
          <span className='text-[var(--text-muted)] text-xs'>
            {mode === 'extras' ? 'Extras' : 'EMCN'}
          </span>
        </div>
        <main className='mx-auto max-w-[1060px] px-5 py-8 sm:px-8 lg:px-10 lg:py-12'>
          <div className='flex flex-wrap items-center gap-2 text-[var(--text-muted)] text-xs'>
            <span>Sim Studio</span>
            <span aria-hidden='true'>›</span>
            <span>{mode === 'extras' ? 'Extras' : 'EMCN components'}</span>
          </div>
          <h1 className='mt-7 font-season text-3xl sm:text-4xl'>
            {mode === 'extras' ? 'Extras' : 'EMCN components and icons'}
          </h1>
          <p className='mt-3 max-w-3xl text-[var(--text-body)] text-sm leading-relaxed'>
            {mode === 'extras'
              ? 'Browse live previews of styling detected outside EMCN. Open the source and evidence panels when you want to trace a treatment back to code.'
              : 'Browse EMCN components and icons. Component options come from the latest source scan; each section links to its definition and product uses.'}
          </p>
          <div className='mt-7 flex flex-wrap items-center gap-x-4 gap-y-2 border-[var(--border)] border-b pb-5 text-[var(--text-muted)] text-xs'>
            <span>
              {entries.length} {mode === 'extras' ? 'scanner signals' : 'exports and variants'}
            </span>
            <span>
              {treatments.length} {mode === 'extras' ? 'visual treatments' : 'component previews'}
            </span>
            <span>{entries.filter((entry) => entry.status !== 'ready').length} fixture gaps</span>
            <span className='ml-auto'>{manifest.status} run</span>
          </div>
          <div className='-mx-5 sm:-mx-8 lg:-mx-10 sticky top-0 z-20 flex flex-wrap items-end gap-3 border-[var(--border)] border-b bg-[var(--bg)] px-5 py-3 sm:px-8 lg:px-10'>
            <label className='flex flex-col gap-1 text-[var(--text-secondary)] text-xs'>
              Preview theme
              <select
                value={theme}
                onChange={(event) => setTheme(event.target.value as typeof theme)}
                className='rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'
              >
                <option value='dark'>Dark</option>
                <option value='light'>Light</option>
              </select>
            </label>
            <label className='flex flex-col gap-1 text-[var(--text-secondary)] text-xs'>
              Root text size
              <select
                value={size}
                onChange={(event) => setSize(Number(event.target.value) as typeof size)}
                className='rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'
              >
                <option value={16}>16px</option>
                <option value={20}>20px</option>
              </select>
            </label>
            {mode === 'components' ? (
              <label className='flex flex-col gap-1 text-[var(--text-secondary)] text-xs'>
                State
                <select
                  value={captureState}
                  onChange={(event) => setCaptureState(event.target.value)}
                  className='rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'
                >
                  <option value='default'>Default</option>
                  <option value='open'>Open</option>
                  <option value='focus'>Focus</option>
                  <option value='disabled'>Disabled</option>
                  <option value='error'>Error</option>
                </select>
              </label>
            ) : null}
            <span className='ml-auto pb-2 text-[var(--text-muted)] text-xs'>
              Scroll to browse · {ordered.length} sections
            </span>
          </div>
          {ordered.length ? (
            ordered.map((treatment) => {
              const anchor = anchors.get(treatment.key)
              if (!anchor) return null
              return (
                <section
                  key={treatment.key}
                  id={anchor}
                  data-studio-treatment
                  className={`scroll-mt-24 border-[var(--border)] border-b py-12 ${mode === 'components' ? '[contain-intrinsic-size:auto_1000px] [content-visibility:auto]' : ''}`}
                >
                  <TreatmentDetail
                    treatment={treatment}
                    theme={theme}
                    size={size}
                    requestedState={captureState}
                    anchor={anchor}
                    selectedEntryId={selections[treatment.key]?.entryId}
                    selectedVariants={selections[treatment.key]?.variants}
                    onSelectEntry={(id) =>
                      setSelections((previous) => ({
                        ...previous,
                        [treatment.key]: { entryId: id, variants: {} },
                      }))
                    }
                    onSelectVariant={(axis, value) =>
                      setSelections((previous) => {
                        const selection = previous[treatment.key]
                        const variants = { ...selection?.variants }
                        if (value) variants[axis] = value
                        else delete variants[axis]
                        return {
                          ...previous,
                          [treatment.key]: {
                            entryId: selection?.entryId,
                            variants,
                          },
                        }
                      })
                    }
                  />
                </section>
              )
            })
          ) : (
            <div className='mt-16 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-8 text-center text-[var(--text-muted)] text-sm'>
              No treatments match your search.
            </div>
          )}
          <section
            id='run'
            className='mt-14 min-h-[80vh] scroll-mt-24 border-[var(--border)] border-t pt-8'
          >
            <h2 className='font-season text-xl'>Current scan run</h2>
            <p className='mt-2 text-[var(--text-body)] text-sm'>
              {manifest.runId} ·{' '}
              {stale ? 'source revision changed; refresh needed' : 'source revision matches'} ·{' '}
              {manifest.ledgerHash
                ? ledgerStale
                  ? 'review notes changed; refresh needed'
                  : 'review notes match'
                : 'no review ledger supplied'}
            </p>
            <div className='mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[var(--text-muted)] text-xs'>
              <span>
                {entries.filter((entry) => entry.status === 'ready').length} fixtures verified
              </span>
              <span>{manifest.coverageFailures.length} inspection failures</span>
              {mode === 'components' ? (
                <span>{manifest.nonvisualExports.length} nonvisual exports classified</span>
              ) : (
                <span>
                  {manifest.ledgerHash
                    ? `${entries.filter((entry) => entry.decision === 'unreviewed').length} without a prior review note`
                    : 'no review ledger supplied'}
                </span>
              )}
            </div>
            <details className='mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-5 py-4 text-[var(--text-muted)] text-xs'>
              <summary className='cursor-pointer text-[var(--text-secondary)]'>
                Run identity and provenance
              </summary>
              <div className='mt-3 space-y-1 break-all font-mono'>
                <p>Source revision: {manifest.sourceRevision}</p>
                <p>Commit: {manifest.identity.commit}</p>
                <p>Scanner tree: {manifest.identity.treeHash}</p>
                <p>Fixture: {manifest.fixtureHash}</p>
                <p>Ledger: {manifest.ledgerHash || 'none'}</p>
                <p>Browser: {manifest.browser}</p>
              </div>
            </details>
            {mode === 'extras' &&
            (manifest.decisions.stale.length || manifest.decisions.ambiguous.length) ? (
              <details className='mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-5 py-4 text-[var(--text-body)] text-xs'>
                <summary className='cursor-pointer'>
                  Review decisions needing a new match (
                  {manifest.decisions.stale.length + manifest.decisions.ambiguous.length})
                </summary>
                {(['stale', 'ambiguous'] as const).map((kind) =>
                  manifest.decisions[kind].map((decision) => (
                    <div
                      key={`${kind}:${decision.fingerprint}`}
                      className='mt-3 border-[var(--border)] border-t pt-3'
                    >
                      <p className='break-all font-mono text-[var(--text-muted)]'>
                        {kind}: {decision.fingerprint}
                      </p>
                      <p className='mt-1'>
                        {decision.status}: {decision.rationale}
                      </p>
                      {decision.evidence ? (
                        <p className='mt-1 break-all'>Prior evidence: {decision.evidence}</p>
                      ) : null}
                    </div>
                  ))
                )}
              </details>
            ) : null}
            {manifest.coverageFailures.length ? (
              <details className='mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-5 py-4 text-[var(--text-body)] text-xs'>
                <summary className='cursor-pointer'>
                  Inspection failures ({manifest.coverageFailures.length})
                </summary>
                {manifest.coverageFailures.map((item) => (
                  <p key={item.file} className='mt-2 break-all'>
                    {item.file}: {item.reason}
                  </p>
                ))}
              </details>
            ) : null}
          </section>
        </main>
      </div>

      <aside
        aria-label='On this page'
        className='hidden border-[var(--border)] border-l px-6 py-12 2xl:block'
      >
        <nav className='sticky top-10 space-y-4 text-sm'>
          <p className='font-medium text-[var(--text-primary)]'>On this section</p>
          <p className='break-words text-[var(--text-muted)] text-xs'>{activeTreatment?.title}</p>
          {activeAnchor ? (
            <>
              <a
                href={`#${activeAnchor}`}
                className='block border-[var(--border)] border-l-2 pl-3 text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              >
                Overview
              </a>
              <a
                href={`#${activeAnchor}-preview`}
                className='block border-[var(--border)] border-l-2 pl-3 text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              >
                Preview
              </a>
              {hasSignals ? (
                <a
                  href={`#${activeAnchor}-signals`}
                  className='block border-[var(--border)] border-l-2 pl-3 text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                >
                  {mode === 'extras' ? 'Why it was detected' : 'Scanner signals'}
                </a>
              ) : null}
            </>
          ) : null}
          <a
            href='#run'
            className='block border-[var(--border)] border-l-2 pl-3 text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          >
            Scan run
          </a>
        </nav>
      </aside>
    </div>
  )
}
