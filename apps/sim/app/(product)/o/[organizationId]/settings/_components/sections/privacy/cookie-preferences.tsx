'use client'

import { SettingsSection } from '@sim/emcn/settings-section'
import { useInterfacePreferences } from '@/app/(product)/_components/session/interface-preferences'
import { Muted } from '@/app/(product)/_components/settings-parts/settings-parts'
import { SwitchRow } from '@/app/(product)/_components/settings-parts/switch-row'
import styles from '@/app/(product)/o/[organizationId]/settings/_components/sections/privacy/cookie-preferences.module.css'
import { cookieChoices, useCookieCategories } from '@/platform/shared/cookie-consent'

const COOKIE_POLICY_HREF = '/cookie-policy'

interface CookieListProps<Name extends string> {
  categories: {
    name: Name
    title: string
    description: string
    locked: boolean
    checked: boolean
  }[]
  saving?: boolean
  commit: (name: Name, checked: boolean) => void
}

function CookieList<Name extends string>({ categories, commit, saving }: CookieListProps<Name>) {
  return (
    <>
      <SettingsSection title='Cookies'>
        {categories.map((category) => (
          <SwitchRow
            key={category.name}
            label={category.title}
            description={category.description}
            checked={category.checked}
            disabled={category.locked || saving}
            onCheckedChange={(checked) => void commit(category.name, checked)}
          />
        ))}
      </SettingsSection>
      <Muted>
        Your choice applies to this browser for 365 days. The{' '}
        <a
          className={styles.policy}
          href={COOKIE_POLICY_HREF}
          target='_blank'
          rel='noopener noreferrer'
        >
          Cookie Policy
        </a>{' '}
        lists what each category covers.
      </Muted>
    </>
  )
}

/** The hosted cookie choices, saved through the consent runtime. */
export function CookieCategories() {
  const { categories, commit, saving } = useCookieCategories()
  return <CookieList categories={categories} commit={commit} saving={saving} />
}

/** A fixture's cookie choices, kept for this interface session without the consent runtime. */
export function SessionCookieCategories() {
  const session = useInterfacePreferences()
  if (!session) throw new Error('Cookie choices need interface preferences')
  return (
    <CookieList
      categories={cookieChoices.map((choice) => ({
        ...choice,
        checked: choice.locked || Boolean(session.cookieChoices[choice.name]),
      }))}
      commit={(name, checked) =>
        session.setCookieChoices((previous) => ({ ...previous, [name]: checked }))
      }
    />
  )
}
