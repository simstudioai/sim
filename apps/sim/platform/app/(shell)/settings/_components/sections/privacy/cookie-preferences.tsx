'use client'

import styles from '@/platform/app/(shell)/settings/_components/sections/privacy/cookie-preferences.module.css'
import { Switch } from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import { CookieConsentProvider, useCookieCategories } from '@/platform/lib/data/cookie-consent'

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

interface CookiePreferencesProps {
  policyHref: string
}

export default function CookiePreferences({ policyHref }: CookiePreferencesProps) {
  return (
    <CookieConsentProvider>
      <CookieCategories policyHref={policyHref} />
    </CookieConsentProvider>
  )
}
