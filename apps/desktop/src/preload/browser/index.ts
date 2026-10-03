import { generateId } from '@sim/utils/id'
import { ipcRenderer } from 'electron'
import {
  collectLoginFields,
  findLoginTarget,
  focusedInput,
  isFillable,
  type LoginTarget,
  sameTarget,
  targetSignature,
} from '@/preload/browser/forms'
import type {
  CredentialFillRequest,
  CredentialFillStatus,
  CredentialFormReport,
} from '@/shared/browser-credentials'

const RESCAN_DELAY_MS = 250
const INITIAL_RESCAN_DELAYS_MS = [250, 750, 1_500, 3_000] as const
let target: LoginTarget | null = null
let signature = ''
let targetId: string | null = null
let lastReported = ''
let timer: ReturnType<typeof setTimeout> | null = null
let initialScansScheduled = false
let filling = false
const observer = new MutationObserver(scheduleRescan)

function scan(): void {
  const { fields, roots } = collectLoginFields()
  const next = findLoginTarget(fields)
  const nextSignature = targetSignature(next)
  if (!sameTarget(target, next) || signature !== nextSignature) {
    targetId = next ? generateId() : null
  }
  target = next
  signature = nextSignature
  observer.disconnect()
  for (const root of roots) {
    if (root === document && !document.documentElement) continue
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'type',
        'autocomplete',
        'name',
        'id',
        'disabled',
        'readonly',
        'class',
        'style',
        'hidden',
        'inert',
        'aria-hidden',
      ],
    })
  }
}

function report(): void {
  scan()
  const focused = focusedInput()
  const rect =
    focused && (focused === target?.username || focused === target?.password)
      ? focused.getBoundingClientRect()
      : null
  const visible =
    rect && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
  const state: CredentialFormReport = {
    origin: location.origin,
    targetId,
    hasLoginForm: target !== null,
    hasPasswordField: target?.password != null,
    bounds: visible ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
  }
  const fingerprint = JSON.stringify(state)
  if (fingerprint === lastReported) return
  lastReported = fingerprint
  ipcRenderer.send('browser-credentials:form-state', state)
}

function scheduleRescan(): void {
  if (timer !== null || filling) return
  timer = setTimeout(() => {
    timer = null
    report()
  }, RESCAN_DELAY_MS)
}

function initialize(): void {
  report()
  if (initialScansScheduled) return
  initialScansScheduled = true
  for (const delay of INITIAL_RESCAN_DELAYS_MS) setTimeout(report, delay)
}

/** Native setters plus composed events reach framework listeners across shadow boundaries. */
function setFieldValue(field: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('Input value setter unavailable')
  setter.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
  field.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
}

async function fill(payload: CredentialFillRequest): Promise<CredentialFillStatus> {
  if (payload.origin !== location.origin || payload.targetId !== targetId || filling)
    return 'stale-target'
  const intended = target
  scan()
  if (!intended || payload.targetId !== targetId || !sameTarget(intended, target))
    return 'stale-target'
  const intendedSignature = signature
  const writes: Array<[HTMLInputElement, string]> = []
  if (intended.username && payload.username) writes.push([intended.username, payload.username])
  if (intended.password && payload.password) writes.push([intended.password, payload.password])
  if (!writes.length) return 'failed'
  filling = true
  try {
    for (const [field, value] of writes) {
      if (
        !isFillable(field) ||
        targetSignature(intended) !== intendedSignature ||
        !sameTarget(intended, findLoginTarget(collectLoginFields().fields))
      )
        return 'stale-target'
      setFieldValue(field, value)
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    return writes.every(([field, value]) => isFillable(field) && field.value === value)
      ? 'filled'
      : 'failed'
  } catch {
    return 'failed'
  } finally {
    filling = false
    scheduleRescan()
  }
}

ipcRenderer.on('browser-credentials:fill', (_event, payload: CredentialFillRequest) => {
  void fill(payload).then((status) => {
    ipcRenderer.send('browser-credentials:fill-result', { requestId: payload.requestId, status })
  })
})
ipcRenderer.on('browser-credentials:rescan', () => {
  target = null
  targetId = null
  lastReported = ''
  scheduleRescan()
})

document.addEventListener('focusin', () => {
  report()
  ipcRenderer.send('browser-credentials:picker', 'open')
})
document.addEventListener(
  'pointerdown',
  (event) => {
    const input = event.composedPath().find((node) => node instanceof HTMLInputElement)
    if (input) {
      setTimeout(() => {
        report()
        ipcRenderer.send('browser-credentials:picker', 'open')
      }, 0)
    } else ipcRenderer.send('browser-credentials:picker', 'dismiss')
  },
  true
)
document.addEventListener(
  'keydown',
  (event) => {
    if (!event.isTrusted) return
    if (event.key === 'Escape') ipcRenderer.send('browser-credentials:picker', 'dismiss')
    const focused = focusedInput()
    if (
      event.key === 'ArrowDown' &&
      focused &&
      (focused === target?.username || focused === target?.password)
    ) {
      ipcRenderer.send('browser-credentials:picker', 'focus')
    }
  },
  true
)
document.addEventListener('scroll', scheduleRescan, true)
window.addEventListener('resize', scheduleRescan)
document.addEventListener('readystatechange', scheduleRescan)
document.addEventListener('DOMContentLoaded', initialize)
window.addEventListener('load', initialize)
window.addEventListener('pageshow', initialize)
scan()
