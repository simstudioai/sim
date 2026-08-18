import { ConsentPreferencesLink } from '@/app/_shell/consent/consent-preferences-link'
import { type LegalPageConfig, ProseLink } from '@/app/(landing)/components/prose-page'

/** Shared column widths so the three cookie tables read as one aligned grid. */
const COOKIE_TABLE_WIDTHS = ['w-[24%]', 'w-[16%]', 'w-[45%]', 'w-[15%]']

/** The cookie-name column reads as code. */
const COOKIE_TABLE_CODE_COLUMNS = [0]

/**
 * Cookie Policy content — the inventory a consent banner has to stand on,
 * expressed as the typed {@link LegalPageConfig} that `ProsePage` renders, so it
 * shares its layout and rhythm with Terms and Privacy and cannot drift.
 *
 * The tables describe what Sim and its providers actually set, grouped by the
 * three categories the banner offers. Keep them in step with the banner's
 * categories (`lib/consent/constants`) and with the tags configured in Google
 * Tag Manager: naming a cookie the site no longer sets is as wrong as omitting
 * one it does.
 */
export const COOKIE_POLICY_CONFIG: LegalPageConfig = {
  title: 'Cookie Policy',
  description:
    'What cookies Sim sets, why, how long they last, and how to change your choice at any time.',
  lastUpdated: 'August 18, 2026',
  intro: [
    {
      kind: 'paragraph',
      content: (
        <>
          This Cookie Policy explains how Sim uses cookies and similar technologies on sim.ai and in
          the Sim application, what each one does, and the choices you have. It forms part of our{' '}
          <ProseLink href='/privacy'>Privacy Policy</ProseLink>, which describes how we handle
          personal data more broadly.
        </>
      ),
    },
    {
      kind: 'paragraph',
      content: (
        <>
          If you are in the EU, the UK, or another region where consent is required, we ask before
          setting anything that is not strictly necessary. You can{' '}
          <ConsentPreferencesLink>change your cookie choices</ConsentPreferencesLink> at any time.
        </>
      ),
    },
  ],
  sections: [
    {
      id: 'what-are-cookies',
      heading: 'What are cookies?',
      blocks: [
        {
          kind: 'paragraph',
          content: `A cookie is a small text file a site stores on your device so it can recognize your browser on a later request. Cookies are how a site keeps you signed in between pages, remembers a preference, or counts a visit.`,
        },
        {
          kind: 'list',
          items: [
            <>
              <strong>Session cookies</strong> are deleted when you close your browser.{' '}
              <strong>Persistent cookies</strong> stay until they expire or you delete them.
            </>,
            <>
              <strong>First-party cookies</strong> are set by the site you are visiting.{' '}
              <strong>Third-party cookies</strong> are set by another company whose code the site
              loads, such as an analytics or advertising provider.
            </>,
          ],
        },
        {
          kind: 'paragraph',
          content: `We also use technologies that behave like cookies without being one. Local storage and session storage keep data in your browser rather than sending it with each request; pixels (also called web beacons or tags) are tiny images or scripts that record that a page or email was opened. Where this policy says "cookies", it means all of these.`,
        },
      ],
    },
    {
      id: 'how-we-use-cookies',
      heading: 'How we use cookies',
      blocks: [
        {
          kind: 'paragraph',
          content: `We group cookies into the three categories the consent banner offers. Necessary cookies are always on because the service cannot run without them. The other two are off until you turn them on.`,
        },
        {
          kind: 'list',
          items: [
            <>
              <strong>Necessary</strong> — sign-in, session security, abuse prevention, and
              remembering the choice you made in the consent banner. These do not require consent
              because the service you asked for cannot be delivered without them.
            </>,
            <>
              <strong>Analytics</strong> — how many people use Sim, which pages and features they
              reach, and where errors happen, so we can improve the product. Measurement only; we do
              not use these to target advertising.
            </>,
            <>
              <strong>Marketing</strong> — measuring which campaigns bring builders to Sim and
              showing relevant ads on other sites.
            </>,
          ],
        },
      ],
    },
    {
      id: 'cookies-we-use',
      heading: 'Cookies we use',
      blocks: [
        {
          kind: 'paragraph',
          content: `Retention periods are the maximum lifetime set when the cookie is written; a cookie can be cleared sooner at any time. Third-party providers occasionally rename or re-scope their cookies, so treat the provider column as the authoritative reference for anything not set by Sim.`,
        },
        {
          kind: 'table',
          caption: 'Necessary',
          columns: ['Cookie', 'Provider', 'Purpose', 'Retention'],
          columnWidths: COOKIE_TABLE_WIDTHS,
          codeColumns: COOKIE_TABLE_CODE_COLUMNS,
          rows: [
            [
              'better-auth.session_token',
              'Sim',
              'Keeps you signed in and identifies your session.',
              '30 days',
            ],
            [
              'better-auth.session_data',
              'Sim',
              'Short-lived signed cache of your session so each page load does not re-read the database.',
              '5 minutes',
            ],
            [
              'c15t',
              'Sim (via c15t)',
              'Records the cookie choice you made so the banner is not shown again.',
              '365 days',
            ],
            [
              'sidebar_collapsed',
              'Sim',
              'Remembers whether the workspace sidebar is collapsed, so the layout does not jump on load.',
              '1 year',
            ],
            [
              '__cf_bm',
              'Cloudflare',
              'Bot-management check on requests to providers we load, such as HubSpot and X.',
              '30 minutes',
            ],
          ],
        },
        {
          kind: 'table',
          caption: 'Analytics',
          columns: ['Cookie', 'Provider', 'Purpose', 'Retention'],
          columnWidths: COOKIE_TABLE_WIDTHS,
          codeColumns: COOKIE_TABLE_CODE_COLUMNS,
          rows: [
            ['_ga', 'Google Analytics', 'Distinguishes one visitor from another.', '13 months'],
            [
              '_ga_*',
              'Google Analytics',
              'Holds the session state for a specific Analytics property.',
              '13 months',
            ],
            [
              '__hstc',
              'HubSpot',
              'Tracks visits across sessions for the main tracker.',
              '6 months',
            ],
            ['hubspotutk', 'HubSpot', 'Identifies a visitor across form submissions.', '6 months'],
            ['__hssc', 'HubSpot', 'Tracks the current session.', '30 minutes'],
            [
              '__hssrc',
              'HubSpot',
              'Detects whether the visitor restarted their browser.',
              'Session',
            ],
          ],
        },
        {
          kind: 'table',
          caption: 'Marketing',
          columns: ['Cookie', 'Provider', 'Purpose', 'Retention'],
          columnWidths: COOKIE_TABLE_WIDTHS,
          codeColumns: COOKIE_TABLE_CODE_COLUMNS,
          rows: [
            [
              'guest_id',
              'X (Twitter)',
              'Identifies a browser to the X conversion pixel.',
              '13 months',
            ],
            [
              'guest_id_ads',
              'X (Twitter)',
              'Measures conversions from X advertising.',
              '13 months',
            ],
            [
              'guest_id_marketing',
              'X (Twitter)',
              'Measures the performance of X marketing campaigns.',
              '13 months',
            ],
            ['personalization_id', 'X (Twitter)', 'Personalizes the ads shown on X.', '13 months'],
            ['muc_ads', 'X (Twitter)', 'Measures ad conversions across X domains.', '13 months'],
            ['_gcl_*', 'Google Ads', 'Attributes a sign-up to the ad that led to it.', '90 days'],
          ],
        },
      ],
    },
    {
      id: 'your-choices',
      heading: 'Your choices',
      blocks: [
        {
          kind: 'paragraph',
          content: (
            <>
              Where consent is required, the banner appears on your first visit with accept and
              reject offered equally, and "Customize" lets you turn each category on or off
              individually. To revisit that decision later — including withdrawing consent you
              already gave —{' '}
              <ConsentPreferencesLink>change your cookie choices</ConsentPreferencesLink>. We ask
              again after 365 days.
            </>
          ),
        },
        {
          kind: 'paragraph',
          content: `Independently of the banner, every major browser lets you block or delete cookies from its privacy settings, and can be set to clear them each time you close it. Blocking necessary cookies will sign you out and prevent parts of Sim from working.`,
        },
        {
          kind: 'paragraph',
          content: `We honor Global Privacy Control (GPC). If your browser or an extension sends a GPC signal, we treat it as an instruction to opt out of analytics and marketing cookies without your having to use the banner.`,
        },
        {
          kind: 'paragraph',
          content: (
            <>
              You can also opt out with the providers directly:{' '}
              <ProseLink href='https://tools.google.com/dlpage/gaoptout'>
                Google Analytics
              </ProseLink>
              , <ProseLink href='https://myadcenter.google.com'>Google Ads</ProseLink>,{' '}
              <ProseLink href='https://x.com/settings/privacy_and_safety'>X (Twitter)</ProseLink>,
              and <ProseLink href='https://legal.hubspot.com/privacy-policy'>HubSpot</ProseLink>.
            </>
          ),
        },
      ],
    },
    {
      id: 'third-party-cookies',
      heading: 'Third-party cookies',
      blocks: [
        {
          kind: 'paragraph',
          content: `Some cookies above are set by companies we work with rather than by Sim. We choose these providers and decide when their code loads, but the data they collect is also governed by their own policies, which we cannot change on your behalf.`,
        },
        {
          kind: 'paragraph',
          content: (
            <>
              The providers currently in use are{' '}
              <ProseLink href='https://policies.google.com/technologies/cookies'>Google</ProseLink>{' '}
              (Analytics, Tag Manager, and Ads),{' '}
              <ProseLink href='https://legal.hubspot.com/privacy-policy'>HubSpot</ProseLink>,{' '}
              <ProseLink href='https://x.com/en/privacy'>X (Twitter)</ProseLink>,{' '}
              <ProseLink href='https://ahrefs.com/privacy'>Ahrefs</ProseLink>, and{' '}
              <ProseLink href='https://www.cloudflare.com/privacypolicy/'>Cloudflare</ProseLink>.
            </>
          ),
        },
      ],
    },
    {
      id: 'changes-to-this-policy',
      heading: 'Changes to this policy',
      blocks: [
        {
          kind: 'paragraph',
          content: `We update this policy when the cookies we set change, and we revise the "Last updated" date above whenever we do. If a change materially widens what we collect, we will ask for your consent again rather than rely on a choice you made under the previous version.`,
        },
      ],
    },
    {
      id: 'contact',
      heading: 'Contact',
      blocks: [
        {
          kind: 'paragraph',
          content: (
            <>
              Questions about this policy, or about how we use cookies, can go to{' '}
              <ProseLink href='mailto:privacy@sim.ai'>privacy@sim.ai</ProseLink>.
            </>
          ),
        },
      ],
    },
  ],
}
