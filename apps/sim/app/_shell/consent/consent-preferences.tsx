'use client'

import { useConsentManager } from '@c15t/nextjs/headless'
import { Label, Switch } from '@sim/emcn'
import type { ConsentCategory } from '@/lib/consent/constants'

/**
 * Inline link chrome for the consent surfaces, matching `PROSE_TYPE.link` on the
 * legal pages. Copied rather than imported because both consumers sit outside
 * the landing route group that owns that token, and defined here — the module
 * they already share — so the copy exists once.
 */
export const CONSENT_LINK_CLASS =
  'text-[var(--text-primary)] underline underline-offset-2 transition-colors hover:text-[var(--text-body)]'

interface ConsentCategoryCopy {
  title: string
  description: string
}

/**
 * Sim's own wording per category. The runtime ships generic descriptions; these
 * say what the cookies actually do here.
 *
 * Typed by name rather than by {@link ConsentCategory} because the runtime's
 * union is wider than the three categories we configure — a policy that adds
 * one server-side falls back to the runtime's description instead of
 * disappearing. The `satisfies` still requires an entry for each of ours.
 */
const CONSENT_CATEGORY_COPY: Record<string, ConsentCategoryCopy | undefined> = {
  necessary: {
    title: 'Necessary',
    description: 'Sign-in and security. Always on.',
  },
  measurement: {
    title: 'Analytics',
    description: 'Shows us how Sim is used so we can make it better.',
  },
  marketing: {
    title: 'Marketing',
    description: 'Measures campaigns and personalizes ads on other sites.',
  },
} satisfies Record<ConsentCategory, ConsentCategoryCopy>

/** The runtime's category union, without re-declaring it. */
type ConsentCategoryName = Parameters<ReturnType<typeof useConsentManager>['setSelectedConsent']>[0]

interface ConsentPreferencesProps {
  /**
   * Called after a switch stages its new value, for a surface that commits per
   * toggle. `revert` puts the category back, for a commit that then fails. The
   * banner omits this and commits from its own footer instead.
   */
  onChange?: (change: { name: ConsentCategoryName; revert: () => void }) => void
  /** Locks every switch, e.g. while a commit is in flight. */
  disabled?: boolean
}

/**
 * The per-category consent switches, shared by the two surfaces that offer
 * them: the banner's expanded state and the Privacy settings page. Both write
 * to `selectedConsents`; whether that is then committed is the caller's, via
 * {@link ConsentPreferencesProps.onChange}.
 *
 * Must be rendered inside a `ConsentStoreProvider`.
 */
export function ConsentPreferences({ onChange, disabled = false }: ConsentPreferencesProps) {
  const { consents, selectedConsents, setSelectedConsent, getDisplayedConsents } =
    useConsentManager()

  /**
   * The store's own selector, not a hand-rolled filter over `consentTypes`: the
   * shipped defaults mark every category except `necessary` as `display: false`,
   * so filtering on that flag silently renders a one-row list.
   */
  const categories = getDisplayedConsents()

  return (
    <ul className='flex flex-col gap-3'>
      {categories.map((type) => {
        const copy = CONSENT_CATEGORY_COPY[type.name]
        const inputId = `consent-${type.name}`
        return (
          <li key={type.name} className='flex items-start justify-between gap-3'>
            <div className='flex min-w-0 flex-col gap-1'>
              <Label htmlFor={inputId}>{copy?.title ?? type.name}</Label>
              <p className='text-[var(--text-muted)] text-caption leading-4'>
                {copy?.description ?? type.description}
              </p>
            </div>
            <Switch
              id={inputId}
              checked={selectedConsents[type.name] ?? consents[type.name] ?? false}
              disabled={type.disabled || disabled}
              onCheckedChange={(checked) => {
                setSelectedConsent(type.name, checked)
                onChange?.({
                  name: type.name,
                  revert: () => setSelectedConsent(type.name, !checked),
                })
              }}
            />
          </li>
        )
      })}
    </ul>
  )
}
