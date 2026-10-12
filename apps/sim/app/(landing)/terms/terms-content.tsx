import { type LegalPageConfig, ProseLink } from '@/app/(landing)/components/prose-page'

/** Terms of Service content rendered by the shared legal-page layout. */
export const TERMS_CONFIG: LegalPageConfig = {
  title: 'Terms of Service',
  description:
    'The terms and conditions for using Sim, the open-source AI workspace: subscription plans, data ownership, and acceptable use.',
  lastUpdated: 'October 5, 2026',
  intro: [
    {
      kind: 'paragraph',
      content:
        'Please read these Terms of Service ("Terms") carefully before using the Sim-hosted platform and related hosted features (the "Service") operated by Sim Studio, Inc. ("us", "we", or "our").',
    },
    {
      kind: 'paragraph',
      content:
        'By accessing or using the Service, you agree to be bound by these Terms. If you disagree with any part of the terms, you may not access the Service.',
    },
  ],
  sections: [
    {
      id: 'accounts',
      heading: '1. Accounts',
      blocks: [
        {
          kind: 'paragraph',
          content:
            'Subject to the existing-account transition in Section 16, you must be at least 18 years old, meet any higher minimum age required by applicable law, and have legal capacity to enter into these Terms to create an account for or use Sim-hosted services. By creating an account or using Sim-hosted services, you represent and warrant that you meet these requirements. Individuals under 18 are not permitted to create an account or use Sim-hosted services, even with permission from a parent or guardian.',
        },
        {
          kind: 'paragraph',
          content:
            'If you use the Service on behalf of a company or other legal entity, you represent and warrant that you have authority to bind that entity to these Terms. In that case, references to "you" and "your" refer to that entity, and each individual using the Service on its behalf must meet the eligibility requirements above.',
        },
        {
          kind: 'paragraph',
          content:
            'These eligibility requirements apply to Sim-hosted accounts and services. They do not modify rights granted under any separate license applicable to Sim software that you self-host.',
        },
        {
          kind: 'paragraph',
          content:
            'When you create an account with us, you must provide accurate, complete, and current information. Failure to do so constitutes a breach of these Terms and may result in suspension or termination under Section 10.',
        },
        {
          kind: 'paragraph',
          content:
            'You are responsible for safeguarding the password that you use to access the Service and for any activities or actions under your password.',
        },
        {
          kind: 'paragraph',
          content:
            'You agree not to disclose your password to any third party. You must notify us immediately upon becoming aware of any breach of security or unauthorized use of your account.',
        },
      ],
    },
    {
      id: 'license',
      heading: '2. License to Use Service',
      blocks: [
        {
          kind: 'paragraph',
          content:
            'Subject to these Terms, your subscription plan and any separate written agreement with us, we grant you a limited, non-exclusive, non-transferable license to access and use the Service for your business or personal purposes. This includes building and operating workflows, integrations and applications for your customers or other users through sharing, API, chat and embedding features made available under your plan and described in our documentation.',
        },
        {
          kind: 'paragraph',
          content:
            'You are responsible for your applications and workflows, for having authority to process the data and take the actions you instruct the Service to perform, and for providing notices and obtaining permissions required by applicable law. Allowing others to access a Sim-hosted deployment does not waive the eligibility requirements in Section 1 or the acceptable-use requirements in Section 9.',
        },
        {
          kind: 'paragraph',
          content:
            'You may not resell, sublicense or provide the hosted Sim platform itself as a standalone or white-label service without our written authorization, or circumvent account, seat or usage limits. This restriction does not prohibit the permitted customer-facing workflows and applications described above.',
        },
        {
          kind: 'paragraph',
          content:
            'Software distributed under a separate open-source or other software license is governed by that license. These Terms do not reduce rights granted by that license; access to Sim-hosted services remains subject to these Terms.',
        },
      ],
    },
    {
      id: 'subscription',
      heading: '3. Subscription Plans & Payment Terms',
      blocks: [
        {
          kind: 'paragraph',
          content:
            "We offer Free, Pro, Max, and Enterprise subscription plans. Paid plans include a base subscription fee plus usage-based charges for inference and other services that exceed your plan's included limits.",
        },
        {
          kind: 'paragraph',
          content:
            'You agree to pay all fees associated with your account. Your base subscription fee is charged at the beginning of each billing cycle (monthly or annually). Inference overages are charged incrementally every $50 during your billing period, which may result in multiple invoices within a single billing cycle. Payment is due upon receipt of invoice. If you fail to pay amounts properly due, we may suspend or terminate your access to paid features in accordance with Section 10.',
        },
        {
          kind: 'paragraph',
          content:
            "We may change pricing for a paid subscription on at least 30 days' notice. A price change takes effect at the first renewal occurring at least 30 days after that notice, unless a separate written agreement or applicable law provides otherwise.",
        },
      ],
    },
    {
      id: 'auto-renewal',
      heading: '4. Auto-Renewal & Cancellation',
      blocks: [
        {
          kind: 'paragraph',
          content: (
            <>
              {
                'Paid subscriptions automatically renew for successive billing periods of the length selected at purchase unless you cancel before the renewal date. You can cancel renewal through your account settings or by contacting us at '
              }
              <ProseLink href='mailto:legal@sim.ai'>legal@sim.ai</ProseLink>
              {'.'}
            </>
          ),
        },
        {
          kind: 'paragraph',
          content:
            'Cancellation of renewal takes effect at the end of the current billing period. Until then, you retain paid access unless you separately request earlier account closure or access is suspended or terminated under Section 10. Cancelling renewal does not, by itself, close your account or request deletion of Your Data. Simply stopping use does not cancel a paid subscription.',
        },
        {
          kind: 'paragraph',
          content:
            'Except as required by applicable law, expressly agreed in writing, or provided in Section 10 for termination by us without your breach, we do not provide refunds for partial billing periods. Cancellation does not remove responsibility for usage charges or other fees properly incurred before cancellation takes effect.',
        },
        {
          kind: 'paragraph',
          content:
            'Nothing in these Terms excludes a statutory withdrawal, cancellation, refund or other remedy that cannot lawfully be excluded. Where a separate request or consent is legally required to start supplying a service or digital content during a withdrawal period, accepting these Terms alone does not constitute that request or consent or a waiver of the withdrawal right.',
        },
        {
          kind: 'paragraph',
          content: 'Account closure, export and deletion are addressed in Sections 5 and 10.',
        },
      ],
    },
    {
      id: 'data-ownership',
      heading: '5. Data Ownership & Retention',
      blocks: [
        {
          kind: 'paragraph',
          content:
            'You retain the ownership rights you have in the data, content and information you submit to the Service ("Your Data"). User Content described in Section 7 is part of Your Data. You grant us a limited, non-exclusive license to host, reproduce, process, transmit and display Your Data only as necessary to provide, maintain, secure and support the Service and carry out your instructions, including integrations, sharing and model calls you enable, or to comply with applicable law. You must have the rights and authority necessary for that processing.',
        },
        {
          kind: 'paragraph',
          content: (
            <>
              {'Our handling of personal data is described in our '}
              <ProseLink href='https://www.sim.ai/privacy'>Privacy Policy</ProseLink>
              {
                '. This license does not expand the processing permissions stated there, constitute consent where separate consent is required, or waive data protection rights. Information about use of the Service is handled for the purposes and on the legal bases described in that policy; the license above is not a general permission to reuse customer content for unrelated product development.'
              }
            </>
          ),
        },
        {
          kind: 'paragraph',
          content:
            "Nothing in these Terms permits Sim, or providers processing Your Data on Sim's behalf, to use Your Data to train or improve generalized or shared AI models. Google API data remains subject to the Google Data Limited Use restrictions described in our Privacy Policy. Where you connect an independent provider using your own credentials, its processing is also governed by your arrangement with that provider; this does not reduce Sim's own obligations or authorize a use that applicable law or provider rules prohibit.",
        },
        {
          kind: 'paragraph',
          content:
            'Where we process personal data on your behalf, that processing is subject to your documented instructions and any data processing addendum in force between us. An applicable data processing addendum controls a conflict concerning that processing. These Terms are not a substitute for a data processing agreement required by law.',
        },
        {
          kind: 'paragraph',
          content: (
            <>
              {
                'Retention and deletion. Retention periods and deletion triggers differ by data category, as described in our Privacy Policy and any applicable data processing addendum, subject to applicable law. Cancellation of subscription renewal is not an account-deletion request. You may request account closure or deletion separately as described in Section 10, and may make privacy or deletion requests at '
              }
              <ProseLink href='mailto:privacy@sim.ai'>privacy@sim.ai</ProseLink>
              {
                '. We may reasonably verify your identity and authority before fulfilling a request.'
              }
            </>
          ),
        },
        {
          kind: 'paragraph',
          content: (
            <>
              {
                'Post-closure export. For 30 days after account closure or termination, you may request an export of Your Data that remains in our possession by contacting '
              }
              <ProseLink href='mailto:privacy@sim.ai'>privacy@sim.ai</ProseLink>
              {
                ', including where ordinary account access has ended. We will provide the export subject to reasonable identity and authority verification and applicable legal restrictions. This request window does not postpone an earlier deletion you request, a shorter applicable data-category retention period, deletion required by law, or deletion required by an applicable data processing addendum. Data already deleted under those rules cannot be exported. We recommend exporting data you need before requesting closure or deletion.'
              }
            </>
          ),
        },
        {
          kind: 'paragraph',
          content:
            'The export window is not a promise that every data category or copy is retained for 30 days or erased on the same day. Some records, such as transaction or security records, may have different justified retention periods under the Privacy Policy, an applicable data processing addendum and law. Backups and downstream-provider copies remain subject to applicable deletion obligations; their existence does not create an unrestricted right to retain or reuse Your Data.',
        },
      ],
    },
    {
      id: 'intellectual-property',
      heading: '6. Intellectual Property',
      blocks: [
        {
          kind: 'paragraph',
          content:
            'Except for Your Data, third-party materials and software governed by a separate license, the Service and its original content, features and functionality are the property of Sim Studio, Inc. or its licensors and are protected by copyright, trademark and other applicable laws. Rights in separately licensed software remain governed by its applicable license as described in Section 2.',
        },
        {
          kind: 'paragraph',
          content:
            'Our trademarks and trade dress may not be used in connection with a product or service without the prior written consent of Sim Studio, Inc., except as permitted by applicable law.',
        },
      ],
    },
    {
      id: 'user-content',
      heading: '7. User Content',
      blocks: [
        {
          kind: 'paragraph',
          content:
            'Our Service allows you to post, link, store, share and otherwise make available certain information, text, graphics, videos, or other material ("User Content"). You are responsible for the User Content that you post on or through the Service, including its legality, reliability, and appropriateness.',
        },
        {
          kind: 'paragraph',
          content:
            'By posting User Content on or through the Service, you represent and warrant that:',
        },
        {
          kind: 'list',
          items: [
            'The User Content is yours (you own it) or you have the right to use it and grant us the rights and license as provided in these Terms.',
            'The posting of your User Content on or through the Service does not violate the privacy rights, publicity rights, copyrights, contract rights or any other rights of any person.',
          ],
        },
        {
          kind: 'paragraph',
          content:
            'We may suspend or terminate accounts for copyright infringement in accordance with Section 10 and applicable law.',
        },
      ],
    },
    {
      id: 'third-party-services',
      heading: '8. Third-Party Services',
      blocks: [
        {
          kind: 'paragraph',
          content:
            'The Service may integrate with third-party services, including Google Workspace, cloud storage and AI model providers. You are responsible for having authority to connect the accounts and services you choose and for complying with their applicable terms. Your use of an independent third-party service may be subject to its terms and privacy policy.',
        },
        {
          kind: 'paragraph',
          content:
            "We do not control independent third-party services and do not warrant their continued availability or functionality. This does not exclude responsibility that Sim has under applicable law, an applicable agreement, or its Privacy Policy for providers processing data on Sim's behalf. Third-party terms do not reduce your rights against Sim where those rights cannot lawfully be excluded.",
        },
        {
          kind: 'paragraph',
          content:
            "AI outputs may be inaccurate, incomplete or unsuitable for a particular purpose. Review outputs and workflow behavior before relying on them or allowing them to affect external systems or other people. You are responsible for the instructions, permissions and actions you authorize through your workflows. Do not use AI output as the sole basis for a decision producing legal or similarly significant effects on an individual without the safeguards required by applicable law. This paragraph does not transfer Sim's own legal obligations to you or exclude mandatory consumer remedies.",
        },
      ],
    },
    {
      id: 'acceptable-use',
      heading: '9. Acceptable Use',
      blocks: [
        { kind: 'paragraph', content: 'You agree not to use the Service:' },
        {
          kind: 'list',
          items: [
            'In any way that violates any applicable national or international law or regulation.',
            'For the purpose of exploiting, harming, or attempting to exploit or harm minors in any way.',
            'To transmit, or procure the sending of, unsolicited or unlawful advertising or promotional material, including spam or chain letters.',
            'To impersonate or attempt to impersonate Sim Studio, Inc., a Sim employee, another user, or any other person or entity.',
            'In any way that infringes upon the rights of others, or in any way is illegal, threatening, fraudulent, or harmful.',
            "To engage in any other conduct that restricts or inhibits anyone's use or enjoyment of the Service, or which, as determined by us, may harm Sim Studio, Inc. or users of the Service or expose them to liability.",
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
          content: (
            <>
              {
                'Closure by you. You may request account closure through an available account-closure control or by contacting '
              }
              <ProseLink href='mailto:legal@sim.ai'>legal@sim.ai</ProseLink>
              {
                '. An account-closure request is also a request to cancel subscription renewal, and no renewal charge will be made after closure takes effect. Fees and usage charges properly incurred before closure remain payable, subject to applicable law. Simply stopping use does not close your account or cancel renewal. If you only want to stop renewal while retaining access until the end of the billing period, follow Section 4.'
              }
            </>
          ),
        },
        {
          kind: 'paragraph',
          content:
            'Suspension or termination for cause. We may suspend or terminate access for a material breach of these Terms, failure to pay amounts properly due, unlawful use, or a reasonably identified fraud, security or other serious risk to the Service or others, or where required by law. Where lawful and reasonably practicable, we will notify you of the reason and provide an opportunity to resolve a remediable issue. We may act immediately where notice or delay would create a risk, frustrate an investigation, or violate law.',
        },
        {
          kind: 'paragraph',
          content:
            "Termination without your breach. If we end your access for our convenience or discontinue the paid Service you purchased without a breach by you, we will give at least 30 days' prior notice, unless earlier action is required by law or reasonably necessary to address an urgent security risk. Whenever we terminate your access without a breach by you, including termination for legal or risk-based reasons under the preceding paragraph, we will refund the unused portion of prepaid subscription fees for the period after termination takes effect, unless payment is prohibited by law. The right to act immediately in those circumstances does not remove this refund commitment. Charges for usage already incurred are not refunded unless required by law. Any additional mandatory refund or other remedy remains available.",
        },
        {
          kind: 'paragraph',
          content:
            'Effect of closure or termination. Ordinary access to the Service ends when closure or termination takes effect, subject to the export-request process in Section 5. Retention and deletion follow Section 5; termination does not extinguish your statutory data protection rights. Accrued payment obligations, applicable ownership rights and the provisions on liability and dispute resolution survive only to the extent their nature requires and applicable law permits. No survival provision authorizes retaining data longer than otherwise permitted.',
        },
      ],
    },
    {
      id: 'limitation-of-liability',
      heading: '11. Limitation of Liability',
      blocks: [
        {
          kind: 'paragraph',
          content:
            'Nothing in these Terms excludes or limits liability that cannot lawfully be excluded or limited. This includes liability for fraud or fraudulent misrepresentation, willful misconduct, death or personal injury caused by negligence where protected by applicable law, and any other non-excludable liability or mandatory consumer or data protection remedy.',
        },
        {
          kind: 'paragraph',
          content:
            'Subject to the paragraph above, to the maximum extent permitted by applicable law, Sim Studio, Inc. and its directors, employees, agents, suppliers and affiliates will not be liable for indirect, incidental, special, consequential or punitive damages arising out of or relating to the Service, including loss of profits, business opportunities, goodwill or data to the extent those losses fall within an excluded category under applicable law. This applies whether the claim is based on contract, tort or another legal theory and whether the possibility of the loss was disclosed to us.',
        },
        {
          kind: 'paragraph',
          content:
            'This section does not remove a refund expressly promised in these Terms or a separate written agreement, excuse Sim from its own binding data protection obligations, or exclude compensation or other remedies that applicable law requires to remain available.',
        },
      ],
    },
    {
      id: 'disclaimer',
      heading: '12. Disclaimer',
      blocks: [
        {
          kind: 'paragraph',
          content:
            'Except for express commitments in these Terms or a separate written agreement, and to the extent permitted by applicable law, the Service is provided on an "AS IS" and "AS AVAILABLE" basis. To that extent, we disclaim implied warranties of merchantability, fitness for a particular purpose, non-infringement and warranties arising from a course of performance.',
        },
        {
          kind: 'paragraph',
          content:
            'We do not guarantee that the Service will be uninterrupted or error-free, that every defect will be corrected, or that AI outputs or other results will meet your requirements. These statements do not override an express service commitment or exclude statutory requirements concerning reasonable care and skill, conformity, security or other rights that cannot lawfully be excluded.',
        },
      ],
    },
    {
      id: 'indemnification',
      heading: '13. Indemnification',
      blocks: [
        {
          kind: 'paragraph',
          content:
            "If you use the Service for business purposes, to the extent permitted by law you agree to defend and indemnify Sim Studio, Inc. and its officers, directors, employees and agents against third-party claims and resulting damages, liabilities and reasonable legal costs arising from your material breach of these Terms, your unlawful use of the Service, or an allegation that Your Data infringes a third party's rights. This does not apply to the extent a claim results from Sim's breach of these Terms, negligence, fraud or willful misconduct.",
        },
        {
          kind: 'paragraph',
          content:
            "We will promptly notify you of a claim, allow you to control its defense with competent counsel, and provide reasonable cooperation at your expense. Delay in notice reduces your obligations only to the extent it materially prejudices your defense. You may not settle a claim in a way that admits fault by, imposes a non-monetary obligation on, or fails to release an indemnified party without that party's prior written consent, which will not be unreasonably withheld.",
        },
        {
          kind: 'paragraph',
          content:
            'This contractual indemnity does not apply to individuals using the Service primarily for personal, family or household purposes. It does not require anyone to pay fees or costs that a court or arbitrator cannot lawfully award, or override the consumer protections in Section 15.',
        },
      ],
    },
    {
      id: 'governing-law',
      heading: '14. Governing Law',
      blocks: [
        {
          kind: 'paragraph',
          content:
            'These Terms are governed by the laws of the State of California and applicable United States federal law, without applying conflict-of-law rules that would displace that choice, except where mandatory law requires otherwise. The Federal Arbitration Act governs Section 15 to the extent it applies.',
        },
        {
          kind: 'paragraph',
          content:
            "Subject to Section 15, disputes that may be heard in court will be brought in the state or federal courts located in San Francisco, California, and the parties consent to those courts' jurisdiction. This does not restrict a qualifying small-claims action in another competent small-claims court or a consumer's right to bring proceedings in a court available under mandatory law.",
        },
        {
          kind: 'paragraph',
          content:
            'If you are a consumer, this choice of law and courts does not deprive you of protections or remedies that cannot be excluded under the law applicable to you, including mandatory protections in your country of habitual residence. Nothing in these Terms prevents complaints to regulators, the exercise of statutory privacy rights, or use of an applicable Data Privacy Framework complaint or recourse mechanism.',
        },
        {
          kind: 'paragraph',
          content:
            'Our failure to enforce a provision is not a waiver of it. If a provision is unenforceable, it will be limited or severed to the extent permitted by law, and the remaining provisions will continue in effect, subject to the specific treatment of arbitration and class-waiver provisions in Section 15. A separate written agreement between you and Sim controls to the extent it expressly overrides these Terms for the services it covers.',
        },
      ],
    },
    {
      id: 'arbitration',
      heading: '15. Arbitration Agreement',
      blocks: [
        {
          kind: 'callout',
          content:
            'PLEASE READ THIS SECTION CAREFULLY. WHERE ENFORCEABLE AND UNLESS YOU OPT OUT, IT REQUIRES BOTH YOU AND SIM TO RESOLVE COVERED DISPUTES THROUGH BINDING ARBITRATION RATHER THAN A COURT OR JURY TRIAL, AND LIMITS CLASS PROCEEDINGS. IT DOES NOT WAIVE RIGHTS OR REMEDIES THAT CANNOT LAWFULLY BE WAIVED.',
        },
        {
          kind: 'paragraph',
          content:
            'Scope and exceptions. You and Sim Studio, Inc. agree to arbitrate disputes arising out of or relating to the Service or these Terms. Either party may instead bring an individual claim in a competent small-claims court or seek court relief for infringement or misuse of intellectual property rights. Claims that applicable law does not permit to be subjected to pre-dispute arbitration are excluded to that extent. This section does not prevent regulatory complaints or participation in applicable Data Privacy Framework complaint, independent recourse or arbitration procedures.',
        },
        {
          kind: 'paragraph',
          content: (
            <>
              {
                'Rules and procedure. The Federal Arbitration Act applies to the extent applicable. Arbitration will be administered by JAMS before one neutral arbitrator under the '
              }
              <ProseLink href='https://www.jamsadr.com/rules-comprehensive-arbitration'>
                JAMS Comprehensive Arbitration Rules and Procedures
              </ProseLink>
              {', as modified by this section. If you are a consumer as defined by JAMS, the '}
              <ProseLink href='https://www.jamsadr.com/consumer-minimum-standards'>
                JAMS Consumer Minimum Standards
              </ProseLink>
              {
                ' also apply and control any conflict that would reduce their protections. A consumer is generally an individual acquiring the Service primarily for personal, family or household purposes. Applicable mandatory law controls any remaining conflict.'
              }
            </>
          ),
        },
        {
          kind: 'paragraph',
          content:
            'Each party may have legal representation and a reasonable opportunity to participate in selecting a neutral arbitrator and exchange relevant, non-privileged information. The location or method of a consumer hearing must not prevent the consumer from accessing arbitration; JAMS will determine an appropriate accessible arrangement under its standards and applicable law. The arbitrator may award all relief available under applicable law for an arbitrable claim and will issue a reasoned written award. A court, not the arbitrator, will decide disputes about formation, enforceability or the scope of this arbitration agreement, including the class-action waiver, notwithstanding any contrary delegation in the incorporated rules.',
        },
        {
          kind: 'paragraph',
          content:
            "Consumer fees. If a consumer initiates arbitration, the consumer will pay no more than $250 in JAMS filing or administrative fees, or a lower amount required by applicable law or JAMS policy. Sim will pay the remaining JAMS and arbitrator fees. If Sim initiates arbitration against a consumer, Sim will pay all JAMS and arbitrator fees. Each party bears its own lawyer's fees unless applicable law permits an award; a consumer will not be required to pay Sim's fees merely because the consumer does not prevail. For non-consumer disputes, costs are governed by the applicable JAMS rules and law.",
        },
        {
          kind: 'paragraph',
          content:
            "Individual proceedings and non-waivable relief. To the extent permitted by law, covered claims must be brought in an individual capacity, not as a plaintiff or class member in a class, collective or representative proceeding. This does not waive a right to public injunctive relief or any other remedy that cannot lawfully be waived. If a particular claim or request for relief cannot lawfully be arbitrated on an individual basis, it may proceed in a competent court to the extent required by law; other arbitrable claims remain subject to this section. Class arbitration requires both parties' express written agreement after the dispute arises.",
        },
        {
          kind: 'paragraph',
          content: (
            <>
              {'Opt-out. You may opt out of this revised arbitration agreement by emailing '}
              <ProseLink href='mailto:legal@sim.ai'>legal@sim.ai</ProseLink>
              {
                ' with your name, the email address associated with your account if any, and a clear statement that you opt out. Send the notice within 30 days after you accept this version of the Terms or, for an existing account, within 30 days after we notify you of this revised arbitration agreement, whichever is later. A valid earlier opt-out remains effective. Opting out does not affect the rest of these Terms.'
              }
            </>
          ),
        },
        {
          kind: 'paragraph',
          content:
            'Existing disputes and provider availability. These revisions do not apply retroactively to a dispute that arose before the revised agreement became effective for you; any applicable prior agreement and mandatory law govern that dispute. If JAMS is unavailable to administer a covered dispute and the parties cannot agree on another provider, the dispute may proceed in a competent court, subject to applicable law and any court order. No provision limits a remedy available because a party fails to pay fees or comply with its arbitration obligations.',
        },
      ],
    },
    {
      id: 'changes',
      heading: '16. Changes to Terms',
      blocks: [
        {
          kind: 'paragraph',
          content:
            "We may update these Terms and will identify the updated version and its effective date. For changes that materially adversely affect existing users' rights or obligations, we will provide at least 30 days' advance notice by email or a prominent notice through the Service, unless a shorter period is reasonably necessary to comply with law or address an urgent security risk. In that case, we will explain the reason and give as much notice as reasonably possible. Price changes remain subject to Section 3, and arbitration changes and opt-out rights are addressed in Section 15.",
        },
        {
          kind: 'paragraph',
          content:
            'Changes apply prospectively. Continued use after the notified effective date constitutes acceptance only where permitted by applicable law. Where affirmative acceptance is required, we will obtain it before applying the change. If you do not agree to a change, you may cancel renewal under Section 4 or request account closure under Section 10; simply stopping use does not cancel billing.',
        },
        {
          kind: 'paragraph',
          content:
            'The minimum-age requirement in Section 1 applies to new accounts created on or after the date that requirement is first published. For accounts created before that date, the requirement applies 30 days after we notify the account holder of it, unless applicable law requires it to apply sooner. This transition does not permit any use that is otherwise unlawful.',
        },
      ],
    },
    {
      id: 'copyright-policy',
      heading: '17. Copyright Policy',
      blocks: [
        {
          kind: 'paragraph',
          content:
            'We respect the intellectual property of others and ask that users of our Service do the same. If you believe that one of our users is, through the use of our Service, unlawfully infringing the copyright(s) in a work, please send a notice to our designated Copyright Agent, including the following information:',
        },
        {
          kind: 'list',
          items: [
            'Your physical or electronic signature;',
            'Identification of the copyrighted work(s) that you claim to have been infringed;',
            'Identification of the material on our services that you claim is infringing;',
            'Your address, telephone number, and e-mail address;',
            'A statement that you have a good-faith belief that the disputed use is not authorized by the copyright owner, its agent, or the law; and',
            "A statement, made under the penalty of perjury, that the above information in your notice is accurate and that you are the copyright owner or authorized to act on the copyright owner's behalf.",
          ],
        },
        {
          kind: 'paragraph',
          content: (
            <>
              {'Our Copyright Agent can be reached at: '}
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
              {'If you have any questions about these Terms, please contact us at: '}
              <ProseLink href='mailto:legal@sim.ai'>legal@sim.ai</ProseLink>
            </>
          ),
        },
      ],
    },
  ],
}
