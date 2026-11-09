'use client'

import { Button } from '@sim/emcn/button'
import { SettingsRow } from '@sim/emcn/settings-section'
import { Switch } from '@sim/emcn/switch'
import { PlatformSurface } from '@sim/emcn-platform/surface/platform-surface'
import Link from 'next/link'
import styles from '@/app/(product)/_components/consent-banner/consent-banner.module.css'
import { useConsentBanner } from '@/platform/shared/cookie-consent'

/**
 * Hosted cookie consent on the product root: a non-modal card docked opposite the notification tray
 * that never dims or blocks the page. Customize expands the same card into the category switches.
 * Accept and reject carry the same weight, as GDPR requires.
 */
export function ConsentBanner() {
  const { visible, expanded, allowedActions, categories, stage, customize, choose, save } =
    useConsentBanner()
  if (!visible) return null
  return (
    <PlatformSurface theme='system'>
      <section
        aria-label='Cookie preferences'
        className={styles.banner}
        data-material='floating'
        data-elevation='control'
      >
        <div className={styles.copy}>
          <span data-type='T059'>Cookies</span>
          <p className={styles.description} data-type='T052'>
            Necessary cookies keep Sim working. Optional cookies help us understand usage, measure
            campaigns, and personalize ads on other sites. You can change or withdraw consent at any
            time in Privacy settings or through our <Link href='/cookie-policy'>Cookie Policy</Link>
            .
          </p>
        </div>
        {expanded && (
          <div className={styles.categories}>
            {categories.map((category) => (
              <SettingsRow
                key={category.name}
                label={category.title}
                description={category.description}
              >
                <Switch
                  label={category.title}
                  checked={category.checked}
                  disabled={category.locked}
                  onCheckedChange={(checked) => stage(category.name, checked)}
                />
              </SettingsRow>
            ))}
          </div>
        )}
        <div className={styles.footer}>
          <div className={styles.actions}>
            {!expanded && allowedActions.includes('customize') && (
              <Button size='compact' variant='quiet' onClick={() => customize()}>
                Customize
              </Button>
            )}
          </div>
          <div className={styles.actions}>
            {allowedActions.includes('reject') && (
              <Button size='compact' onClick={() => void choose('reject')}>
                Reject all
              </Button>
            )}
            {allowedActions.includes('accept') && (
              <Button size='compact' onClick={() => void choose('accept')}>
                Accept all
              </Button>
            )}
            {expanded && (
              <Button size='compact' variant='primary' onClick={() => void save()}>
                Save
              </Button>
            )}
          </div>
        </div>
      </section>
    </PlatformSurface>
  )
}
