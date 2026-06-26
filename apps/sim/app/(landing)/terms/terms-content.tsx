import { type LegalPageConfig, ProseLink } from '@/app/(landing)/components/prose-page'

/**
 * Terms of Service content — the verbatim legal text, expressed as the typed
 * {@link LegalPageConfig} that {@link ProsePage} renders. The text is ported
 * unchanged from the prior Terms document; only the layout and inline-link
 * chrome are re-authored onto the landing primitives.
 */
export const TERMS_CONFIG: LegalPageConfig = {
  title: 'Terms of Service',
  description:
    'The terms and conditions for using Sim, the open-source AI workspace — subscription plans, data ownership, and acceptable use.',
  lastUpdated: 'October 11, 2025',
  intro: [
    {
      kind: 'paragraph',
      content: `Please read these Terms of Service ("Terms") carefully before using the Sim platform (the "Service") operated by Sim, Inc ("us", "we", or "our").`,
    },
    {
      kind: 'paragraph',
      content: `By accessing or using the Service, you agree to be bound by these Terms. If you disagree with any part of the terms, you may not access the Service.`,
    },
  ],
  sections: [
    {
      id: 'accounts',
      heading: '1. Accounts',
      blocks: [
        {
          kind: 'paragraph',
          content: `When you create an account with us, you must provide accurate, complete, and current information. Failure to do so constitutes a breach of the Terms, which may result in immediate termination of your account on our Service.`,
        },
        {
          kind: 'paragraph',
          content: `You are responsible for safeguarding the password that you use to access the Service and for any activities or actions under your password.`,
        },
        {
          kind: 'paragraph',
          content: `You agree not to disclose your password to any third party. You must notify us immediately upon becoming aware of any breach of security or unauthorized use of your account.`,
        },
      ],
    },
    {
      id: 'license',
      heading: '2. License to Use Service',
      blocks: [
        {
          kind: 'paragraph',
          content: `Subject to your compliance with these Terms, we grant you a limited, non-exclusive, non-transferable, revocable license to access and use the Service for your internal business or personal purposes.`,
        },
        {
          kind: 'paragraph',
          content: `This license does not permit you to resell, redistribute, or make the Service available to third parties, or to use the Service to build a competitive product or service.`,
        },
      ],
    },
    {
      id: 'subscription',
      heading: '3. Subscription Plans & Payment Terms',
      blocks: [
        {
          kind: 'paragraph',
          content: `We offer Free, Pro, Max, and Enterprise subscription plans. Paid plans include a base subscription fee plus usage-based charges for inference and other services that exceed your plan's included limits.`,
        },
        {
          kind: 'paragraph',
          content: `You agree to pay all fees associated with your account. Your base subscription fee is charged at the beginning of each billing cycle (monthly or annually). Inference overages are charged incrementally every $50 during your billing period, which may result in multiple invoices within a single billing cycle. Payment is due upon receipt of invoice. If payment fails, we may suspend or terminate your access to paid features.`,
        },
        {
          kind: 'paragraph',
          content: `We reserve the right to change our pricing with 30 days' notice to paid subscribers. Price changes will take effect at your next renewal.`,
        },
      ],
    },
    {
      id: 'auto-renewal',
      heading: '4. Auto-Renewal & Cancellation',
      blocks: [
        {
          kind: 'paragraph',
          content: `Paid subscriptions automatically renew at the end of each billing period unless you cancel before the renewal date. You can cancel your subscription at any time through your account settings or by contacting us.`,
        },
        {
          kind: 'paragraph',
          content: `Cancellations take effect at the end of the current billing period. You will retain access to paid features until that time. We do not provide refunds for partial billing periods.`,
        },
        {
          kind: 'paragraph',
          content: `Upon cancellation or termination, you may export your data within 30 days. After 30 days, we may delete your data in accordance with our data retention policies.`,
        },
      ],
    },
    {
      id: 'data-ownership',
      heading: '5. Data Ownership & Retention',
      blocks: [
        {
          kind: 'paragraph',
          content: `You retain all ownership rights to data, content, and information you submit to the Service ("Your Data"). You grant us a limited license to process, store, and transmit Your Data solely to provide and improve the Service as described in our Privacy Policy.`,
        },
        {
          kind: 'paragraph',
          content: `We retain Your Data while your account is active and for 30 days after account termination or cancellation. You may request data export or deletion at any time through your account settings.`,
        },
      ],
    },
    {
      id: 'intellectual-property',
      heading: '6. Intellectual Property',
      blocks: [
        {
          kind: 'paragraph',
          content: `The Service and its original content, features, and functionality are and will remain the exclusive property of Sim, Inc and its licensors. The Service is protected by copyright, trademark, and other laws of both the United States and foreign countries.`,
        },
        {
          kind: 'paragraph',
          content: `Our trademarks and trade dress may not be used in connection with any product or service without the prior written consent of Sim, Inc.`,
        },
      ],
    },
    {
      id: 'user-content',
      heading: '7. User Content',
      blocks: [
        {
          kind: 'paragraph',
          content: `Our Service allows you to post, link, store, share and otherwise make available certain information, text, graphics, videos, or other material ("User Content"). You are responsible for the User Content that you post on or through the Service, including its legality, reliability, and appropriateness.`,
        },
        {
          kind: 'paragraph',
          content: `By posting User Content on or through the Service, you represent and warrant that:`,
        },
        {
          kind: 'list',
          items: [
            `The User Content is yours (you own it) or you have the right to use it and grant us the rights and license as provided in these Terms.`,
            `The posting of your User Content on or through the Service does not violate the privacy rights, publicity rights, copyrights, contract rights or any other rights of any person.`,
          ],
        },
        {
          kind: 'paragraph',
          content: `We reserve the right to terminate the account of any user found to be infringing on a copyright.`,
        },
      ],
    },
    {
      id: 'third-party-services',
      heading: '8. Third-Party Services',
      blocks: [
        {
          kind: 'paragraph',
          content: `The Service may integrate with third-party services (such as Google Workspace, cloud storage providers, and AI model providers). Your use of third-party services is subject to their respective terms and privacy policies.`,
        },
        {
          kind: 'paragraph',
          content: `We are not responsible for the availability, functionality, or actions of third-party services. Any issues with third-party integrations should be directed to the respective provider.`,
        },
      ],
    },
    {
      id: 'acceptable-use',
      heading: '9. Acceptable Use',
      blocks: [
        { kind: 'paragraph', content: `You agree not to use the Service:` },
        {
          kind: 'list',
          items: [
            `In any way that violates any applicable national or international law or regulation.`,
            `For the purpose of exploiting, harming, or attempting to exploit or harm minors in any way.`,
            `To transmit, or procure the sending of, any advertising or promotional material, including any "junk mail", "chain letter," "spam," or any other similar solicitation.`,
            `To impersonate or attempt to impersonate Sim, Inc, a Sim employee, another user, or any other person or entity.`,
            `In any way that infringes upon the rights of others, or in any way is illegal, threatening, fraudulent, or harmful.`,
            `To engage in any other conduct that restricts or inhibits anyone's use or enjoyment of the Service, or which, as determined by us, may harm Sim, Inc or users of the Service or expose them to liability.`,
          ],
        },
      ],
    },
    {
      id: 'termination',
      heading: '10. Termination',
      blocks: [
        {
          kind: 'paragraph',
          content: `We may terminate or suspend your account immediately, without prior notice or liability, for any reason whatsoever, including without limitation if you breach the Terms.`,
        },
        {
          kind: 'paragraph',
          content: `Upon termination, your right to use the Service will immediately cease. If you wish to terminate your account, you may simply discontinue using the Service.`,
        },
      ],
    },
    {
      id: 'limitation-of-liability',
      heading: '11. Limitation of Liability',
      blocks: [
        {
          kind: 'paragraph',
          content: `In no event shall Sim, Inc, nor its directors, employees, partners, agents, suppliers, or affiliates, be liable for any indirect, incidental, special, consequential or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses, resulting from:`,
        },
        {
          kind: 'list',
          items: [
            `Your access to or use of or inability to access or use the Service;`,
            `Any conduct or content of any third party on the Service;`,
            `Any content obtained from the Service; and`,
            `Unauthorized access, use or alteration of your transmissions or content, whether based on warranty, contract, tort (including negligence) or any other legal theory, whether or not we have been informed of the possibility of such damage.`,
          ],
        },
      ],
    },
    {
      id: 'disclaimer',
      heading: '12. Disclaimer',
      blocks: [
        {
          kind: 'paragraph',
          content: `Your use of the Service is at your sole risk. The Service is provided on an "AS IS" and "AS AVAILABLE" basis. The Service is provided without warranties of any kind, whether express or implied, including, but not limited to, implied warranties of merchantability, fitness for a particular purpose, non-infringement or course of performance.`,
        },
        {
          kind: 'paragraph',
          content: `Sim, Inc, its subsidiaries, affiliates, and its licensors do not warrant that:`,
        },
        {
          kind: 'list',
          items: [
            `The Service will function uninterrupted, secure or available at any particular time or location;`,
            `Any errors or defects will be corrected;`,
            `The Service is free of viruses or other harmful components; or`,
            `The results of using the Service will meet your requirements.`,
          ],
        },
      ],
    },
    {
      id: 'indemnification',
      heading: '13. Indemnification',
      blocks: [
        {
          kind: 'paragraph',
          content: `You agree to indemnify, defend, and hold harmless Sim, Inc and its officers, directors, employees, and agents from any claims, damages, losses, liabilities, and expenses (including reasonable attorneys' fees) arising from your use of the Service, your violation of these Terms, or your violation of any rights of another party.`,
        },
      ],
    },
    {
      id: 'governing-law',
      heading: '14. Governing Law',
      blocks: [
        {
          kind: 'paragraph',
          content: `These Terms shall be governed and construed in accordance with the laws of the United States, without regard to its conflict of law provisions.`,
        },
        {
          kind: 'paragraph',
          content: `Our failure to enforce any right or provision of these Terms will not be considered a waiver of those rights. If any provision of these Terms is held to be invalid or unenforceable by a court, the remaining provisions of these Terms will remain in effect.`,
        },
      ],
    },
    {
      id: 'arbitration',
      heading: '15. Arbitration Agreement',
      blocks: [
        {
          kind: 'paragraph',
          content: `Please read the following arbitration agreement carefully. It requires you to arbitrate disputes with Sim, Inc, its parent companies, subsidiaries, affiliates, successors and assigns and all of their respective officers, directors, employees, agents, and representatives (collectively, the "Company Parties") and limits the manner in which you can seek relief from the Company Parties.`,
        },
        {
          kind: 'paragraph',
          content: `You agree that any dispute between you and any of the Company Parties relating to the Site, the Service or these Terms will be resolved by binding arbitration, rather than in court, except that (1) you and the Company Parties may assert individualized claims in small claims court if the claims qualify, remain in such court and advance solely on an individual, non-class basis; and (2) you or the Company Parties may seek equitable relief in court for infringement or other misuse of intellectual property rights.`,
        },
        {
          kind: 'paragraph',
          content: `The Federal Arbitration Act governs the interpretation and enforcement of this Arbitration Agreement. The arbitration will be conducted by JAMS, an established alternative dispute resolution provider.`,
        },
        {
          kind: 'callout',
          content: `YOU AND COMPANY AGREE THAT EACH OF US MAY BRING CLAIMS AGAINST THE OTHER ONLY ON AN INDIVIDUAL BASIS AND NOT ON A CLASS, REPRESENTATIVE, OR COLLECTIVE BASIS. ONLY INDIVIDUAL RELIEF IS AVAILABLE, AND DISPUTES OF MORE THAN ONE CUSTOMER OR USER CANNOT BE ARBITRATED OR CONSOLIDATED WITH THOSE OF ANY OTHER CUSTOMER OR USER.`,
        },
        {
          kind: 'paragraph',
          content: (
            <>
              You have the right to opt out of the provisions of this Arbitration Agreement by
              sending a timely written notice of your decision to opt out to:{' '}
              <ProseLink href='mailto:legal@sim.ai'>legal@sim.ai</ProseLink> within 30 days after
              first becoming subject to this Arbitration Agreement.
            </>
          ),
        },
      ],
    },
    {
      id: 'changes',
      heading: '16. Changes to Terms',
      blocks: [
        {
          kind: 'paragraph',
          content: `We reserve the right, at our sole discretion, to modify or replace these Terms at any time. If a revision is material, we will try to provide at least 30 days' notice prior to any new terms taking effect. What constitutes a material change will be determined at our sole discretion.`,
        },
        {
          kind: 'paragraph',
          content: `By continuing to access or use our Service after those revisions become effective, you agree to be bound by the revised terms. If you do not agree to the new terms, please stop using the Service.`,
        },
      ],
    },
    {
      id: 'copyright-policy',
      heading: '17. Copyright Policy',
      blocks: [
        {
          kind: 'paragraph',
          content: `We respect the intellectual property of others and ask that users of our Service do the same. If you believe that one of our users is, through the use of our Service, unlawfully infringing the copyright(s) in a work, please send a notice to our designated Copyright Agent, including the following information:`,
        },
        {
          kind: 'list',
          items: [
            `Your physical or electronic signature;`,
            `Identification of the copyrighted work(s) that you claim to have been infringed;`,
            `Identification of the material on our services that you claim is infringing;`,
            `Your address, telephone number, and e-mail address;`,
            `A statement that you have a good-faith belief that the disputed use is not authorized by the copyright owner, its agent, or the law; and`,
            `A statement, made under the penalty of perjury, that the above information in your notice is accurate and that you are the copyright owner or authorized to act on the copyright owner's behalf.`,
          ],
        },
        {
          kind: 'paragraph',
          content: (
            <>
              Our Copyright Agent can be reached at:{' '}
              <ProseLink href='mailto:copyright@sim.ai'>copyright@sim.ai</ProseLink>
            </>
          ),
        },
      ],
    },
    {
      id: 'contact',
      heading: '18. Contact Us',
      blocks: [
        {
          kind: 'paragraph',
          content: (
            <>
              If you have any questions about these Terms, please contact us at:{' '}
              <ProseLink href='mailto:legal@sim.ai'>legal@sim.ai</ProseLink>
            </>
          ),
        },
      ],
    },
  ],
}
