'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { getEnv } from '@/lib/env'
import { LegalLayout } from '@/app/(landing)/components'

export default function PrivacyPolicy() {
  useEffect(() => {
    const privacyUrl = getEnv('NEXT_PUBLIC_PRIVACY_URL')
    if (privacyUrl?.startsWith('http')) {
      window.location.href = privacyUrl
    }
  }, [])
  return (
    <LegalLayout title='Privacy Policy'>
      <section>
        <p className='mb-4'>Last Updated: October 11, 2025</p>
        <p>
          This Privacy Policy describes how Sim ("we", "us", "our", or "the Service") collects,
          uses, discloses, and protects personal data — including data obtained from Google APIs
          (including Google Workspace APIs) — and your rights and controls regarding that data.
        </p>
        <p className='mt-4'>
          By using or accessing the Service, you confirm that you have read and understood this
          Privacy Policy, and you consent to the collection, use, and disclosure of your information
          as described herein.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>Interpretation and Definitions</h2>
        <h3 className='mb-2 font-medium text-xl'>Interpretation</h3>
        <p className='mb-4'>
          Under the following conditions, the meanings of words with capitalized first letters are
          defined. The following definitions have the same meaning whether they are written in
          singular or plural form.
        </p>

        <h3 className='mb-2 font-medium text-xl'>Definitions</h3>
        <p className='mb-4'>For the purposes of this Privacy Policy:</p>
        <ul className='mb-4 list-disc space-y-2 pl-6'>
          <li>
            <strong>Application</strong> or <strong>Service</strong> means the Sim web or mobile
            application or related services.
          </li>
          <li>
            <strong>Account</strong> means a unique account created for You to access our Service or
            parts of our Service.
          </li>
          <li>
            <strong>Affiliate</strong> means an entity that controls, is controlled by or is under
            common control with a party, where "control" means ownership of 50% or more of the
            shares, equity interest or other securities entitled to vote for election of directors
            or other managing authority.
          </li>
          <li>
            <strong>Business</strong>, for the purpose of the CCPA (California Consumer Privacy
            Act), refers to the Company as the legal entity that collects Consumers' personal
            information and determines the purposes and means of the processing of Consumers'
            personal information, or on behalf of which such information is collected and that
            alone, or jointly with others, determines the purposes and means of the processing of
            consumers' personal information, that does business in the State of California.
          </li>
          <li>
            <strong>Company</strong> (referred to as either "the Company", "We", "Us" or "Our" in
            this Agreement) refers to Sim. For the purpose of the GDPR, the Company is the Data
            Controller.
          </li>
          <li>
            <strong>Cookies</strong> are small files that are placed on Your computer, mobile device
            or any other device by a website, containing the details of Your browsing history on
            that website among its many uses.
          </li>
          <li>
            <strong>Country</strong> refers to: Quebec, Canada
          </li>
          <li>
            <strong>Data Controller</strong>, for the purposes of the GDPR (General Data Protection
            Regulation), refers to the Company as the legal person which alone or jointly with
            others determines the purposes and means of the processing of Personal Data.
          </li>
          <li>
            <strong>Device</strong> means any device that can access the Service such as a computer,
            a cellphone or a digital tablet.
          </li>
          <li>
            <strong>Do Not Track (DNT)</strong> is a concept that has been promoted by US regulatory
            authorities, in particular the U.S. Federal Trade Commission (FTC), for the Internet
            industry to develop and implement a mechanism for allowing internet users to control the
            tracking of their online activities across websites.
          </li>
          <li>
            <strong>Personal Data</strong> (or "Personal Information") is any information that
            relates to an identified or identifiable individual. For the purposes for GDPR, Personal
            Data means any information relating to You such as a name, an identification number,
            location data, online identifier or to one or more factors specific to the physical,
            physiological, genetic, mental, economic, cultural or social identity. For the purposes
            of the CCPA, Personal Data means any information that identifies, relates to, describes
            or is capable of being associated with, or could reasonably be linked, directly or
            indirectly, with You.
          </li>
          <li>
            <strong>Google Data</strong> means any data, content, or metadata obtained via Google
            APIs (including Google Workspace APIs).
          </li>
          <li>
            <strong>Generalized AI/ML model</strong> means an AI or ML model intended to be broadly
            trained across multiple users, not specific to a single user's data or behavior.
          </li>
          <li>
            <strong>User-facing features</strong> means features directly visible or used by the
            individual user through the app UI.
          </li>
          <li>
            <strong>Sale</strong>, for the purpose of the CCPA (California Consumer Privacy Act),
            means selling, renting, releasing, disclosing, disseminating, making available,
            transferring, or otherwise communicating orally, in writing, or by electronic or other
            means, a Consumer's Personal information to another business or a third party for
            monetary or other valuable consideration.
          </li>
          <li>
            <strong>Service Provider</strong> means any natural or legal person who processes the
            data on behalf of the Company. It refers to third-party companies or individuals
            employed by the Company to facilitate the Service, to provide the Service on behalf of
            the Company, to perform services related to the Service or to assist the Company in
            analyzing how the Service is used. For the purpose of the GDPR, Service Providers are
            considered Data Processors.
          </li>
          <li>
            <strong>Third-party Social Media Service</strong> refers to any website or any social
            network website through which a User can log in or create an account to use the Service.
          </li>
          <li>
            <strong>Usage Data</strong> refers to data collected automatically, either generated by
            the use of the Service or from the Service infrastructure itself (for example, the
            duration of a page visit).
          </li>
          <li>
            <strong>Website</strong> refers to Sim, accessible from sim.ai
          </li>
          <li>
            <strong>You</strong> means the individual accessing or using the Service, or the
            company, or other legal entity on behalf of which such individual is accessing or using
            the Service, as applicable. Under GDPR (General Data Protection Regulation), You can be
            referred to as the Data Subject or as the User as you are the individual using the
            Service.
          </li>
        </ul>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>1. Information We Collect</h2>
        <h3 className='mb-2 font-medium text-xl'>Personal Data You Provide</h3>
        <p className='mb-4'>
          When you sign up, link accounts, or use features, you may provide Personal Data such as:
        </p>
        <ul className='mb-4 list-disc space-y-2 pl-6'>
          <li>Name and email address</li>
          <li>Phone number and mailing address</li>
          <li>Profile picture, settings, and preferences</li>
          <li>Content you upload (e.g., documents, files) within Sim</li>
          <li>Any data you explicitly input or connect, including via Google integrations</li>
        </ul>

        <h3 className='mb-2 font-medium text-xl'>Google Data via API Scopes</h3>
        <p className='mb-4'>
          If you choose to connect your Google account (e.g., Google Workspace, Gmail, Drive,
          Calendar, Contacts), we may request specific scopes. Types of Google Data we may access
          include:
        </p>
        <ul className='mb-4 list-disc space-y-2 pl-6'>
          <li>Basic profile (name, email)</li>
          <li>Drive files and documents</li>
          <li>Calendar events</li>
          <li>Contacts</li>
          <li>Gmail messages (only if explicitly requested for a specific feature)</li>
          <li>Other Google Workspace content or metadata as needed per feature</li>
        </ul>
        <p className='mb-4'>
          We only request the minimal scopes necessary for the features you enable. We do not
          request scopes for unimplemented features.
        </p>

        <h3 className='mb-2 font-medium text-xl'>Usage Data</h3>
        <p className='mb-4'>
          We may also collect information on how the Service is accessed and used ("Usage Data").
          This Usage Data may include information such as your computer's Internet Protocol address
          (e.g. IP address), browser type, browser version, the pages of our Service that you visit,
          the time and date of your visit, the time spent on those pages, unique device identifiers
          and other diagnostic data.
        </p>
        <p className='mb-4'>
          When You access the Service by or through a mobile device, We may collect certain
          information automatically, including, but not limited to, the type of mobile device You
          use, Your mobile device unique ID, the IP address of Your mobile device, Your mobile
          operating system, the type of mobile Internet browser You use, unique device identifiers
          and other diagnostic data.
        </p>
        <p className='mb-4'>
          We may also collect information that Your browser sends whenever You visit our Service or
          when You access the Service by or through a mobile device.
        </p>

        <h3 className='mb-2 font-medium text-xl'>Tracking & Cookies Data</h3>
        <p className='mb-4'>
          We use cookies and similar tracking technologies to track the activity on our Service and
          hold certain information.
        </p>
        <p className='mb-4'>
          Cookies are files with small amount of data which may include an anonymous unique
          identifier. Cookies are sent to your browser from a website and stored on your device.
          Tracking technologies also used are beacons, tags, and scripts to collect and track
          information and to improve and analyze our Service.
        </p>
        <p>
          You can instruct your browser to refuse all cookies or to indicate when a cookie is being
          sent. However, if you do not accept cookies, you may not be able to use some portions of
          our Service.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>2. How We Use Your Information</h2>
        <p className='mb-4'>We use the collected data for various purposes:</p>
        <ul className='list-disc space-y-2 pl-6'>
          <li>To provide and maintain our Service</li>
          <li>To notify you about changes to our Service</li>
          <li>
            To allow you to participate in interactive features of our Service when you choose to do
            so
          </li>
          <li>To provide customer care and support</li>
          <li>To provide analysis or valuable information so that we can improve the Service</li>
          <li>To monitor the usage of the Service</li>
          <li>To detect, prevent and address technical issues</li>
          <li>To manage Your Account</li>
          <li>For the performance of a contract</li>
          <li>
            To contact You by email, telephone calls, SMS, or other equivalent forms of electronic
            communication
          </li>
          <li>
            To enable and support user-enabled integrations with Google services (e.g., syncing
            files or calendar) and provide personalization, suggestions, and user-specific
            automation for that individual user.
          </li>
          <li>
            To detect and prevent fraud, abuse, or security incidents and to comply with legal
            obligations.
          </li>
        </ul>
        <p className='mt-4'>
          <strong>Importantly:</strong> any Google Data used within Sim is used only for features
          tied to that specific user (user-facing features), and <strong>never</strong> for
          generalized AI/ML training or shared model improvement across users.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>3. Transfer Of Data</h2>
        <p className='mb-4'>
          Your information, including Personal Information, may be transferred to — and maintained
          on — computers located outside of your state, province, country or other governmental
          jurisdiction where the data protection laws may differ than those from your jurisdiction.
        </p>
        <p className='mb-4'>
          If you are located outside United States and choose to provide information to us, please
          note that we transfer the data, including Personal Information, to United States and
          process it there.
        </p>
        <p>
          Your consent to this Privacy Policy followed by your submission of such information
          represents your agreement to that transfer.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>4. Disclosure Of Data</h2>

        <h3 className='mb-2 font-medium text-xl'>Business Transactions</h3>
        <p className='mb-4'>
          If the Company is involved in a merger, acquisition or asset sale, Your Personal Data may
          be transferred. We will provide notice before Your Personal Data is transferred and
          becomes subject to a different Privacy Policy.
        </p>

        <h3 className='mb-2 font-medium text-xl'>Law Enforcement</h3>
        <p className='mb-4'>
          Under certain circumstances, the Company may be required to disclose Your Personal Data if
          required to do so by law or in response to valid requests by public authorities (e.g. a
          court or a government agency).
        </p>

        <h3 className='mb-2 font-medium text-xl'>Legal Requirements</h3>
        <p className='mb-4'>
          Sim may disclose your Personal Information in the good faith belief that such action is
          necessary to:
        </p>
        <ul className='list-disc space-y-2 pl-6'>
          <li>To comply with a legal obligation</li>
          <li>To protect and defend the rights or property of Sim</li>
          <li>To prevent or investigate possible wrongdoing in connection with the Service</li>
          <li>To protect the personal safety of users of the Service or the public</li>
          <li>To protect against legal liability</li>
        </ul>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>5. Security Of Data</h2>
        <p className='mb-4'>
          The security of your data is important to us, but remember that no method of transmission
          over the Internet, or method of electronic storage is 100% secure. While we strive to use
          commercially acceptable means to protect your Personal Information, we cannot guarantee
          its absolute security.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>6. Service Providers</h2>
        <p className='mb-4'>
          We may employ third party companies and individuals to facilitate our Service ("Service
          Providers"), to provide the Service on our behalf, to perform Service-related services or
          to assist us in analyzing how our Service is used.
        </p>
        <p>
          These third parties have access to your Personal Information only to perform these tasks
          on our behalf and are obligated not to disclose or use it for any other purpose.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>7. Analytics</h2>
        <p className='mb-4'>
          We may aggregate or anonymize non-Google data (not tied to personal identity) for internal
          analytics, product improvement, usage trends, or performance monitoring. This data cannot
          be tied back to individual users and is not used for generalized AI/ML training with
          Google Data.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>8. Behavioral Remarketing</h2>
        <p className='mb-4'>
          The Company uses remarketing services to advertise on third party websites to You after
          You visited our Service. We and Our third-party vendors use cookies to inform, optimize
          and serve ads based on Your past visits to our Service.
        </p>
        <h3 className='mb-2 font-medium text-xl'>Google Ads (AdWords)</h3>
        <p className='mb-4'>
          Google Ads remarketing service is provided by Google Inc. You can opt-out of Google
          Analytics for Display Advertising and customize the Google Display Network ads by visiting
          the Google Ads Settings page.
        </p>

        <h3 className='mb-2 font-medium text-xl'>Twitter</h3>
        <p className='mb-4'>
          Twitter remarketing service is provided by Twitter Inc. You can opt-out from Twitter's
          interest-based ads by following their instructions.
        </p>

        <h3 className='mb-2 font-medium text-xl'>Facebook</h3>
        <p className='mb-4'>
          Facebook remarketing service is provided by Facebook Inc. You can learn more about
          interest-based advertising from Facebook by visiting their Privacy Policy.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>9. Payments</h2>
        <p className='mb-4'>
          We may provide paid products and/or services within the Service. In that case, we may use
          third-party services for payment processing (e.g. payment processors).
        </p>
        <p className='mb-4'>
          We will not store or collect Your payment card details. That information is provided
          directly to Our third-party payment processors whose use of Your personal information is
          governed by their Privacy Policy. These payment processors adhere to the standards set by
          PCI-DSS as managed by the PCI Security Standards Council, which is a joint effort of
          brands like Visa, Mastercard, American Express and Discover. PCI-DSS requirements help
          ensure the secure handling of payment information.
        </p>
        <h3 className='mb-2 font-medium text-xl'>Payment processors we work with:</h3>
        <ul className='mb-4 list-disc space-y-2 pl-6'>
          <li>Stripe</li>
        </ul>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>
          10. Use of Google / Workspace APIs & Data — Limited Use
        </h2>
        <h3 className='mb-2 font-medium text-xl'>Affirmative Statement & Compliance</h3>
        <p className='mb-4'>
          Sim’s use, storage, processing, and transfer of Google Data (raw or derived) strictly
          adheres to the Google API Services User Data Policy, including the Limited Use
          requirements, and to the Google Workspace API user data policy (when applicable). We
          explicitly affirm that:
        </p>
        <ul className='mb-4 list-disc space-y-2 pl-6'>
          <li>
            Sim does not use, transfer, or allow Google Data to be used to train, improve, or
            develop generalized or non-personalized AI/ML models.
          </li>
          <li>
            Any processing of Google Data is limited to providing or improving user-facing features
            visible in the app UI.
          </li>
          <li>
            We do not allow third parties to access Google Data for purposes of training or model
            improvement.
          </li>
          <li>Transfers of Google Data are disallowed except in limited permitted cases.</li>
        </ul>

        <h3 className='mb-2 font-medium text-xl'>Permitted Transfers & Data Use</h3>
        <p className='mb-4'>
          We may only transfer Google Data (raw or derived) to third parties under the following
          limited conditions and always aligned with user disclosures and consent:
        </p>
        <ul className='mb-4 list-disc space-y-2 pl-6'>
          <li>To provide or improve user-facing features (with the user's explicit consent)</li>
          <li>For security, abuse investigation, or system integrity</li>
          <li>To comply with laws or legal obligations</li>
          <li>
            As part of a merger, acquisition, divestiture, or sale of assets, with explicit user
            consent
          </li>
        </ul>

        <h3 className='mb-2 font-medium text-xl'>Human Access Restrictions</h3>
        <p className='mb-4'>
          We restrict human review of Google Data strictly. No employee, contractor, or agent may
          view Google Data unless one of the following is true:
        </p>
        <ul className='mb-4 list-disc space-y-2 pl-6'>
          <li>
            The user gave explicit, documented consent to view specific items (e.g., "Let customer
            support view this email/file").
          </li>
          <li>It is necessary for security, abuse investigation, or legal process.</li>
          <li>
            Data is aggregated, anonymized, and used for internal operations only (without
            re-identification).
          </li>
        </ul>

        <h3 className='mb-2 font-medium text-xl'>Scope Minimization & Justification</h3>
        <p className='mb-4'>
          We only request scopes essential to features you opt into; we do not request broad or
          unused permissions. For each Google API scope we request, we maintain internal
          documentation justifying why that scope is needed and why narrower scopes are
          insufficient. Where possible, we follow incremental authorization and request additional
          scopes only when needed in context.
        </p>

        <h3 className='mb-2 font-medium text-xl'>Secure Handling & Storage</h3>
        <ul className='mb-4 list-disc space-y-2 pl-6'>
          <li>Google Data is encrypted in transit (TLS/HTTPS) and at rest.</li>
          <li>Access controls, role-based permissions, logging, and auditing protect data.</li>
          <li>
            OAuth tokens and credentials are stored securely (e.g., encrypted vault, hardware or
            secure key management).
          </li>
          <li>We regularly review security practices and infrastructure.</li>
          <li>
            If a security incident affects Google Data, we will notify Google as required and
            cooperate fully.
          </li>
        </ul>

        <h3 className='mb-2 font-medium text-xl'>Retention & Deletion</h3>
        <p className='mb-4'>We retain data only as long as necessary for the purposes disclosed:</p>
        <ul className='mb-4 list-disc space-y-2 pl-6'>
          <li>
            <strong>Account Data:</strong> Retained during active account + 30 days after deletion
            request
          </li>
          <li>
            <strong>Google API Data:</strong> Retained during feature use + 7 days after revocation
            or account deletion
          </li>
          <li>
            <strong>Usage Logs:</strong> 90 days for analytics; up to 1 year for security
            investigations
          </li>
          <li>
            <strong>Transaction Records:</strong> Up to 7 years for legal and tax compliance
          </li>
        </ul>
        <p className='mb-4'>
          When you revoke access, delete your account, or stop using a feature, we remove associated
          data within the timeframes above. You may request deletion via in-app settings or by
          contacting us; we will comply promptly.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>11. Links To Other Sites</h2>
        <p className='mb-4'>
          Our Service may contain links to other sites that are not operated by us. If you click on
          a third party link, you will be directed to that third party's site. We strongly advise
          you to review the Privacy Policy of every site you visit.
        </p>
        <p>
          We have no control over and assume no responsibility for the content, privacy policies or
          practices of any third party sites or services.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>12. Children's Privacy</h2>
        <p className='mb-4'>
          Our Service does not address anyone under the age of 18 ("Children").
        </p>
        <p className='mb-4'>
          We do not knowingly collect personally identifiable information from anyone under the age
          of 18. If you are a parent or guardian and you are aware that your Children has provided
          us with Personal Information, please contact us. If we become aware that we have collected
          Personal Information from children without verification of parental consent, we take steps
          to remove that information from our servers.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>13. Changes To This Privacy Policy</h2>
        <p className='mb-4'>
          We may update our Privacy Policy from time to time. We will notify you of any changes by
          posting the new Privacy Policy on this page.
        </p>
        <p className='mb-4'>
          We will let you know via email and/or a prominent notice on our Service, prior to the
          change becoming effective and update the "Last updated" date at the top of this Privacy
          Policy.
        </p>
        <p>
          You are advised to review this Privacy Policy periodically for any changes. Changes to
          this Privacy Policy are effective when they are posted on this page.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>
          14. Your Data Protection Rights Under General Data Protection Regulation (GDPR)
        </h2>
        <p className='mb-4'>
          If you are a resident of the European Economic Area (EEA), you have certain data
          protection rights. Sim aims to take reasonable steps to allow you to correct, amend,
          delete, or limit the use of your Personal Information.
        </p>
        <p className='mb-4'>
          If you wish to be informed what Personal Information we hold about you and if you want it
          to be removed from our systems, please contact us.
        </p>
        <p className='mb-4'>
          In certain circumstances, you have the following data protection rights:
        </p>
        <ul className='mb-4 list-disc space-y-2 pl-6'>
          <li>The right to access, update or to delete the information we have on you.</li>
          <li>
            The right of rectification. You have the right to have your information rectified if
            that information is inaccurate or incomplete.
          </li>
          <li>
            The right to object. You have the right to object to our processing of your Personal
            Information.
          </li>
          <li>
            The right of restriction. You have the right to request that we restrict the processing
            of your personal information.
          </li>
          <li>
            The right to data portability. You have the right to be provided with a copy of the
            information we have on you in a structured, machine-readable and commonly used format.
          </li>
          <li>
            The right to withdraw consent. You also have the right to withdraw your consent at any
            time where Sim relied on your consent to process your personal information.
          </li>
        </ul>
        <p className='mb-4'>
          Please note that we may ask you to verify your identity before responding to such
          requests.
        </p>
        <p className='mb-4 border-[var(--brand-primary-hex)] border-l-4 bg-[var(--brand-primary-hex)]/10 p-3'>
          You have the right to complain to a Data Protection Authority about our collection and use
          of your Personal Information. For more information, please contact your local data
          protection authority in the European Economic Area (EEA).
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>15. California Privacy Rights</h2>
        <p className='mb-4'>
          If you are a California resident, you have specific rights under the California Consumer
          Privacy Act (CCPA) and California Privacy Rights Act (CPRA), including the right to know
          what personal information we collect, the right to delete your information, and the right
          to opt-out of the sale or sharing of your personal information.
        </p>

        <h3 className='mb-2 font-medium text-xl'>Do Not Sell or Share My Personal Information</h3>
        <p className='mb-4'>
          We do not sell your personal information for monetary consideration. However, some data
          sharing practices (such as analytics or advertising services) may be considered a "sale"
          or "share" under CCPA/CPRA. You have the right to opt-out of such data sharing. To
          exercise this right, contact us at{' '}
          <Link
            href='mailto:privacy@sim.ai'
            className='text-[var(--brand-primary-hex)] underline hover:text-[var(--brand-primary-hover-hex)]'
          >
            privacy@sim.ai
          </Link>
          .
        </p>

        <h3 className='mb-2 font-medium text-xl'>Global Privacy Control (GPC)</h3>
        <p className='mb-4'>
          We recognize and honor Global Privacy Control (GPC) signals. When your browser sends a GPC
          signal, we will treat it as a valid request to opt-out of the sale or sharing of your
          personal information.
        </p>

        <h3 className='mb-2 font-medium text-xl'>Shine The Light Law</h3>
        <p className='mb-4'>
          California Civil Code Section 1798.83 permits California residents to request information
          about categories of personal information we disclosed to third parties for direct
          marketing purposes in the preceding calendar year.
        </p>
        <p>
          To make a request under CCPA or the Shine The Light law, please submit your request using
          the contact information provided below.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>16. Vulnerability Disclosure Policy</h2>

        <h3 className='mb-2 font-medium text-xl'>Introduction</h3>
        <p className='mb-4'>
          Sim is dedicated to preserving data security by preventing unauthorized disclosure of
          information. This policy was created to provide security researchers with instructions for
          conducting vulnerability discovery activities and to provide information on how to report
          vulnerabilities that have been discovered. This policy explains which systems and sorts of
          activity are covered, how to send vulnerability reports, and how long we require you to
          wait before publicly reporting vulnerabilities identified.
        </p>

        <h3 className='mb-2 font-medium text-xl'>Guidelines</h3>
        <p className='mb-4'>We request that you:</p>
        <ul className='mb-4 list-disc space-y-2 pl-6'>
          <li>
            Notify us as soon as possible after you discover a real or potential security issue.
          </li>
          <li>
            Provide us a reasonable amount of time to resolve the issue before you disclose it
            publicly.
          </li>
          <li>
            Make every effort to avoid privacy violations, degradation of user experience,
            disruption to production systems, and destruction or manipulation of data.
          </li>
          <li>
            Only use exploits to the extent necessary to confirm a vulnerability's presence. Do not
            use an exploit to compromise or obtain data, establish command line access and/or
            persistence, or use the exploit to "pivot" to other systems.
          </li>
          <li>
            Once you've established that a vulnerability exists or encounter any sensitive data
            (including personal data, financial information, or proprietary information or trade
            secrets of any party), you must stop your test, notify us immediately, and keep the data
            strictly confidential.
          </li>
          <li>Do not submit a high volume of low-quality reports.</li>
        </ul>

        <h3 className='mb-2 font-medium text-xl'>Authorization</h3>
        <p className='mb-4'>
          Security research carried out in conformity with this policy is deemed permissible. We'll
          work with you to swiftly understand and fix the problem, and Sim will not suggest or
          pursue legal action in connection with your study.
        </p>

        <h3 className='mb-2 font-medium text-xl'>Scope</h3>
        <p className='mb-4'>This policy applies to the following systems and services:</p>
        <ul className='mb-4 list-disc space-y-2 pl-6'>
          <li>sim.ai website</li>
          <li>Sim web application</li>
          <li>Sim API services</li>
        </ul>
        <p className='mb-4'>
          Any service that isn't explicitly specified above, such as related services, is out of
          scope and isn't allowed to be tested. Vulnerabilities discovered in third-party solutions
          Sim interacts with are not covered by this policy and should be reported directly to the
          solution vendor in accordance with their disclosure policy (if any). Before beginning your
          inquiry, email us at{' '}
          <Link
            href='mailto:security@sim.ai'
            className='text-[var(--brand-primary-hex)] underline hover:text-[var(--brand-primary-hover-hex)]'
          >
            security@sim.ai
          </Link>{' '}
          if you're unsure whether a system or endpoint is in scope.
        </p>

        <h3 className='mb-2 font-medium text-xl'>Types of testing</h3>
        <p className='mb-4'>The following test types are not authorized:</p>
        <ul className='mb-4 list-disc space-y-2 pl-6'>
          <li>Network denial of service (DoS or DDoS) tests</li>
          <li>
            Physical testing (e.g., office access, open doors, tailgating), social engineering
            (e.g., phishing, vishing), or any other non-technical vulnerability testing
          </li>
        </ul>

        <h3 className='mb-2 font-medium text-xl'>Reporting a vulnerability</h3>
        <p className='mb-4'>
          To report any security flaws, send an email to{' '}
          <Link
            href='mailto:security@sim.ai'
            className='text-[var(--brand-primary-hex)] underline hover:text-[var(--brand-primary-hover-hex)]'
          >
            security@sim.ai
          </Link>
          . The next business day, we'll acknowledge receipt of your vulnerability report and keep
          you updated on our progress. Reports can be anonymously submitted.
        </p>

        <h3 className='mb-2 font-medium text-xl'>Desirable information</h3>
        <p className='mb-4'>
          In order to process and react to a vulnerability report, we recommend to include the
          following information:
        </p>
        <ul className='mb-4 list-disc space-y-2 pl-6'>
          <li>Vulnerability description</li>
          <li>Place of discovery</li>
          <li>Potential Impact</li>
          <li>
            Steps required to reproduce a vulnerability (include scripts and screenshots if
            possible)
          </li>
        </ul>
        <p className='mb-4'>If possible, please provide your report in English.</p>

        <h3 className='mb-2 font-medium text-xl'>Our commitment</h3>
        <p className='mb-4'>
          If you choose to give your contact information, we promise to communicate with you in a
          transparent and timely manner. We will acknowledge receipt of your report within three
          business days. We will keep you informed on vulnerability confirmation and remedy to the
          best of our capabilities. We welcome a discussion of concerns and are willing to engage in
          a discourse.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>17. Contact & Dispute Resolution</h2>
        <p className='mb-4'>
          If you have questions, requests, or complaints regarding this Privacy Policy or our data
          practices, you may contact us at:
        </p>
        <ul className='mb-4 list-disc space-y-2 pl-6'>
          <li>
            Email:{' '}
            <Link
              href='mailto:privacy@sim.ai'
              className='text-[var(--brand-primary-hex)] underline hover:text-[var(--brand-primary-hover-hex)]'
            >
              privacy@sim.ai
            </Link>
          </li>
          <li>Mailing Address: Sim, 80 Langton St, San Francisco, CA 94133, USA</li>
        </ul>
        <p>We will respond to your request within a reasonable timeframe.</p>
      </section>
    </LegalLayout>
  )
}
