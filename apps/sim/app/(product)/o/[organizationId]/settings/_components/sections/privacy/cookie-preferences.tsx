'use client'

import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { Switch } from '@sim/emcn/switch'
import { useInterfacePreferences } from '@/app/(product)/_components/session/interface-preferences'
import styles from '@/app/(product)/o/[organizationId]/settings/_components/sections/privacy/cookie-preferences.module.css'
import { cookieChoices, useCookieCategories } from '@/platform/shared/cookie-consent'

interface CookieListProps<Name extends string> {
  policyHref: string
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

function CookieList<Name extends string>({
  policyHref,
  categories,
  commit,
  saving,
}: CookieListProps<Name>) {
  return (
    <SettingsSection title='Cookies'>
      {categories.map((category) => (
        <SettingsRow key={category.name} label={category.title} description={category.description}>
          <Switch
            label={category.title}
            checked={category.checked}
            disabled={category.locked || saving}
            onCheckedChange={(checked) => void commit(category.name, checked)}
          />
        </SettingsRow>
      ))}
      <p className={styles.note} data-type='T060'>
        Your choice applies to this browser and is kept for 365 days. The{' '}
        <a href={policyHref} target='_blank' rel='noopener noreferrer'>
          Cookie Policy
        </a>{' '}
        lists what each category covers.
      </p>
    </SettingsSection>
  )
}

function CookieCategories({ policyHref }: { policyHref: string }) {
  const { categories, commit, saving } = useCookieCategories()
  return (
    <CookieList categories={categories} commit={commit} saving={saving} policyHref={policyHref} />
  )
}

function SessionCookieCategories({ policyHref }: { policyHref: string }) {
  const session = useInterfacePreferences()
  if (!session) throw new Error('Cookie choices need interface preferences')
  return (
    <CookieList
      policyHref={policyHref}
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

interface CookiePreferencesProps {
  policyHref: string
  fixture?: true
}

export default function CookiePreferences({ policyHref, fixture }: CookiePreferencesProps) {
  if (fixture) return <SessionCookieCategories policyHref={policyHref} />
  return <CookieCategories policyHref={policyHref} />
}
