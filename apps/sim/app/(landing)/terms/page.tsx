'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { getEnv } from '@/lib/core/config/env'
import { LegalLayout } from '@/app/(landing)/components'

export default function TermsOfService() {
  useEffect(() => {
    const termsUrl = getEnv('NEXT_PUBLIC_TERMS_URL')
    if (termsUrl?.startsWith('http')) {
      window.location.href = termsUrl
    }
  }, [])
  return (
    <LegalLayout title='Terms of Service'>
      <section>
        <p className='mb-4'>Last Updated: October 11, 2025</p>
        <p>
          Please read these Terms of Service ("Terms") carefully before using the Sim platform (the
          "Service") operated by Sim, Inc ("us", "we", or "our").
        </p>
        <p className='mt-4'>
          By accessing or using the Service, you agree to be bound by these Terms. If you disagree
          with any part of the terms, you may not access the Service.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>1. Accounts</h2>
        <p className='mb-4'>
          When you create an account with us, you must provide accurate, complete, and current
          information. Failure to do so constitutes a breach of the Terms, which may result in
          immediate termination of your account on our Service.
        </p>
        <p className='mb-4'>
          You are responsible for safeguarding the password that you use to access the Service and
          for any activities or actions under your password.
        </p>
        <p>
          You agree not to disclose your password to any third party. You must notify us immediately
          upon becoming aware of any breach of security or unauthorized use of your account.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>2. License to Use Service</h2>
        <p className='mb-4'>
          Subject to your compliance with these Terms, we grant you a limited, non-exclusive,
          non-transferable, revocable license to access and use the Service for your internal
          business or personal purposes.
        </p>
        <p>
          This license does not permit you to resell, redistribute, or make the Service available to
          third parties, or to use the Service to build a competitive product or service.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>3. Subscription Plans & Payment Terms</h2>
        <p className='mb-4'>
          We offer Free, Pro, Team, and Enterprise subscription plans. Paid plans include a base
          subscription fee plus usage-based charges for inference and other services that exceed
          your plan's included limits.
        </p>
        <p className='mb-4'>
          You agree to pay all fees associated with your account. Your base subscription fee is
          charged at the beginning of each billing cycle (monthly or annually). Inference overages
          are charged incrementally every $50 during your billing period, which may result in
          multiple invoices within a single billing cycle. Payment is due upon receipt of invoice.
          If payment fails, we may suspend or terminate your access to paid features.
        </p>
        <p>
          We reserve the right to change our pricing with 30 days' notice to paid subscribers. Price
          changes will take effect at your next renewal.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>4. Auto-Renewal & Cancellation</h2>
        <p className='mb-4'>
          Paid subscriptions automatically renew at the end of each billing period unless you cancel
          before the renewal date. You can cancel your subscription at any time through your account
          settings or by contacting us.
        </p>
        <p className='mb-4'>
          Cancellations take effect at the end of the current billing period. You will retain access
          to paid features until that time. We do not provide refunds for partial billing periods.
        </p>
        <p>
          Upon cancellation or termination, you may export your data within 30 days. After 30 days,
          we may delete your data in accordance with our data retention policies.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>5. Data Ownership & Retention</h2>
        <p className='mb-4'>
          You retain all ownership rights to data, content, and information you submit to the
          Service ("Your Data"). You grant us a limited license to process, store, and transmit Your
          Data solely to provide and improve the Service as described in our Privacy Policy.
        </p>
        <p>
          We retain Your Data while your account is active and for 30 days after account termination
          or cancellation. You may request data export or deletion at any time through your account
          settings.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>6. Intellectual Property</h2>
        <p className='mb-4'>
          The Service and its original content, features, and functionality are and will remain the
          exclusive property of Sim, Inc and its licensors. The Service is protected by copyright,
          trademark, and other laws of both the United States and foreign countries.
        </p>
        <p>
          Our trademarks and trade dress may not be used in connection with any product or service
          without the prior written consent of Sim, Inc.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>7. User Content</h2>
        <p className='mb-4'>
          Our Service allows you to post, link, store, share and otherwise make available certain
          information, text, graphics, videos, or other material ("User Content"). You are
          responsible for the User Content that you post on or through the Service, including its
          legality, reliability, and appropriateness.
        </p>
        <p className='mb-4'>
          By posting User Content on or through the Service, you represent and warrant that:
        </p>
        <ul className='mb-4 list-disc space-y-2 pl-6'>
          <li>
            The User Content is yours (you own it) or you have the right to use it and grant us the
            rights and license as provided in these Terms.
          </li>
          <li>
            The posting of your User Content on or through the Service does not violate the privacy
            rights, publicity rights, copyrights, contract rights or any other rights of any person.
          </li>
        </ul>
        <p>
          We reserve the right to terminate the account of any user found to be infringing on a
          copyright.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>8. Third-Party Services</h2>
        <p className='mb-4'>
          The Service may integrate with third-party services (such as Google Workspace, cloud
          storage providers, and AI model providers). Your use of third-party services is subject to
          their respective terms and privacy policies.
        </p>
        <p>
          We are not responsible for the availability, functionality, or actions of third-party
          services. Any issues with third-party integrations should be directed to the respective
          provider.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>9. Acceptable Use</h2>
        <p className='mb-4'>You agree not to use the Service:</p>
        <ul className='mb-4 list-disc space-y-2 pl-6'>
          <li>
            In any way that violates any applicable national or international law or regulation.
          </li>
          <li>
            For the purpose of exploiting, harming, or attempting to exploit or harm minors in any
            way.
          </li>
          <li>
            To transmit, or procure the sending of, any advertising or promotional material,
            including any "junk mail", "chain letter," "spam," or any other similar solicitation.
          </li>
          <li>
            To impersonate or attempt to impersonate Sim, Inc, a Sim employee, another user, or any
            other person or entity.
          </li>
          <li>
            In any way that infringes upon the rights of others, or in any way is illegal,
            threatening, fraudulent, or harmful.
          </li>
          <li>
            To engage in any other conduct that restricts or inhibits anyone's use or enjoyment of
            the Service, or which, as determined by us, may harm Sim, Inc or users of the Service or
            expose them to liability.
          </li>
        </ul>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>10. Termination</h2>
        <p className='mb-4'>
          We may terminate or suspend your account immediately, without prior notice or liability,
          for any reason whatsoever, including without limitation if you breach the Terms.
        </p>
        <p>
          Upon termination, your right to use the Service will immediately cease. If you wish to
          terminate your account, you may simply discontinue using the Service.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>11. Limitation of Liability</h2>
        <p className='mb-4'>
          In no event shall Sim, Inc, nor its directors, employees, partners, agents, suppliers, or
          affiliates, be liable for any indirect, incidental, special, consequential or punitive
          damages, including without limitation, loss of profits, data, use, goodwill, or other
          intangible losses, resulting from:
        </p>
        <ul className='list-disc space-y-2 pl-6'>
          <li>Your access to or use of or inability to access or use the Service;</li>
          <li>Any conduct or content of any third party on the Service;</li>
          <li>Any content obtained from the Service; and</li>
          <li>
            Unauthorized access, use or alteration of your transmissions or content, whether based
            on warranty, contract, tort (including negligence) or any other legal theory, whether or
            not we have been informed of the possibility of such damage.
          </li>
        </ul>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>12. Disclaimer</h2>
        <p className='mb-4'>
          Your use of the Service is at your sole risk. The Service is provided on an "AS IS" and
          "AS AVAILABLE" basis. The Service is provided without warranties of any kind, whether
          express or implied, including, but not limited to, implied warranties of merchantability,
          fitness for a particular purpose, non-infringement or course of performance.
        </p>
        <p>Sim, Inc, its subsidiaries, affiliates, and its licensors do not warrant that:</p>
        <ul className='mb-4 list-disc space-y-2 pl-6'>
          <li>
            The Service will function uninterrupted, secure or available at any particular time or
            location;
          </li>
          <li>Any errors or defects will be corrected;</li>
          <li>The Service is free of viruses or other harmful components; or</li>
          <li>The results of using the Service will meet your requirements.</li>
        </ul>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>13. Indemnification</h2>
        <p>
          You agree to indemnify, defend, and hold harmless Sim, Inc and its officers, directors,
          employees, and agents from any claims, damages, losses, liabilities, and expenses
          (including reasonable attorneys' fees) arising from your use of the Service, your
          violation of these Terms, or your violation of any rights of another party.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>14. Governing Law</h2>
        <p>
          These Terms shall be governed and construed in accordance with the laws of the United
          States, without regard to its conflict of law provisions.
        </p>
        <p className='mt-4'>
          Our failure to enforce any right or provision of these Terms will not be considered a
          waiver of those rights. If any provision of these Terms is held to be invalid or
          unenforceable by a court, the remaining provisions of these Terms will remain in effect.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>15. Arbitration Agreement</h2>
        <p className='mb-4'>
          Please read the following arbitration agreement carefully. It requires you to arbitrate
          disputes with Sim, Inc, its parent companies, subsidiaries, affiliates, successors and
          assigns and all of their respective officers, directors, employees, agents, and
          representatives (collectively, the "Company Parties") and limits the manner in which you
          can seek relief from the Company Parties.
        </p>
        <p className='mb-4'>
          You agree that any dispute between you and any of the Company Parties relating to the
          Site, the Service or these Terms will be resolved by binding arbitration, rather than in
          court, except that (1) you and the Company Parties may assert individualized claims in
          small claims court if the claims qualify, remain in such court and advance solely on an
          individual, non-class basis; and (2) you or the Company Parties may seek equitable relief
          in court for infringement or other misuse of intellectual property rights.
        </p>
        <p className='mb-4'>
          The Federal Arbitration Act governs the interpretation and enforcement of this Arbitration
          Agreement. The arbitration will be conducted by JAMS, an established alternative dispute
          resolution provider.
        </p>
        <p className='mb-4 border-[var(--brand-primary-hex)] border-l-4 bg-[var(--brand-primary-hex)]/10 p-3'>
          YOU AND COMPANY AGREE THAT EACH OF US MAY BRING CLAIMS AGAINST THE OTHER ONLY ON AN
          INDIVIDUAL BASIS AND NOT ON A CLASS, REPRESENTATIVE, OR COLLECTIVE BASIS. ONLY INDIVIDUAL
          RELIEF IS AVAILABLE, AND DISPUTES OF MORE THAN ONE CUSTOMER OR USER CANNOT BE ARBITRATED
          OR CONSOLIDATED WITH THOSE OF ANY OTHER CUSTOMER OR USER.
        </p>
        <p className='mb-4'>
          You have the right to opt out of the provisions of this Arbitration Agreement by sending a
          timely written notice of your decision to opt out to:{' '}
          <Link
            href='mailto:legal@sim.ai'
            className='text-[var(--brand-primary-hex)] underline hover:text-[var(--brand-primary-hover-hex)]'
          >
            legal@sim.ai{' '}
          </Link>
          within 30 days after first becoming subject to this Arbitration Agreement.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>16. Changes to Terms</h2>
        <p>
          We reserve the right, at our sole discretion, to modify or replace these Terms at any
          time. If a revision is material, we will try to provide at least 30 days' notice prior to
          any new terms taking effect. What constitutes a material change will be determined at our
          sole discretion.
        </p>
        <p className='mt-4'>
          By continuing to access or use our Service after those revisions become effective, you
          agree to be bound by the revised terms. If you do not agree to the new terms, please stop
          using the Service.
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>17. Copyright Policy</h2>
        <p className='mb-4'>
          We respect the intellectual property of others and ask that users of our Service do the
          same. If you believe that one of our users is, through the use of our Service, unlawfully
          infringing the copyright(s) in a work, please send a notice to our designated Copyright
          Agent, including the following information:
        </p>
        <ul className='mb-4 list-disc space-y-2 pl-6'>
          <li>Your physical or electronic signature;</li>
          <li>Identification of the copyrighted work(s) that you claim to have been infringed;</li>
          <li>Identification of the material on our services that you claim is infringing;</li>
          <li>Your address, telephone number, and e-mail address;</li>
          <li>
            A statement that you have a good-faith belief that the disputed use is not authorized by
            the copyright owner, its agent, or the law; and
          </li>
          <li>
            A statement, made under the penalty of perjury, that the above information in your
            notice is accurate and that you are the copyright owner or authorized to act on the
            copyright owner's behalf.
          </li>
        </ul>
        <p>
          Our Copyright Agent can be reached at:{' '}
          <Link
            href='mailto:copyright@sim.ai'
            className='text-[var(--brand-primary-hex)] underline hover:text-[var(--brand-primary-hover-hex)]'
          >
            copyright@sim.ai
          </Link>
        </p>
      </section>

      <section>
        <h2 className='mb-4 font-semibold text-2xl'>18. Contact Us</h2>
        <p>
          If you have any questions about these Terms, please contact us at:{' '}
          <Link
            href='mailto:legal@sim.ai'
            className='text-[var(--brand-primary-hex)] underline hover:text-[var(--brand-primary-hover-hex)]'
          >
            legal@sim.ai
          </Link>
        </p>
      </section>
    </LegalLayout>
  )
}
