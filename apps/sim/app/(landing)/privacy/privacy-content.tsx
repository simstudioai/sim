import { Fragment, type ReactNode } from 'react'
import { type LegalPageConfig, ProseLink } from '@/app/(landing)/components/prose-page'

const INLINE_PATTERN =
  /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|https:\/\/[^\s)]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi

function richText(content: string): ReactNode {
  return content.split(INLINE_PATTERN).map((part, index) => {
    const key = `inline-${index}-${part}`
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={key}>{part.slice(2, -2)}</strong>
    }

    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (link) {
      return (
        <ProseLink key={key} href={link[2]}>
          {link[1]}
        </ProseLink>
      )
    }

    if (part.startsWith('https://')) {
      return (
        <ProseLink key={key} href={part}>
          {part}
        </ProseLink>
      )
    }

    if (part.includes('@')) {
      return (
        <ProseLink key={key} href={`mailto:${part}`}>
          {part}
        </ProseLink>
      )
    }

    return <Fragment key={key}>{part}</Fragment>
  })
}

export const PRIVACY_CONFIG: LegalPageConfig = {
  title: 'Privacy Policy',
  description: 'Sim Studio, Inc. · Operating the Sim platform (sim.ai)',
  lastUpdated: 'September 2, 2026',
  intro: [
    {
      kind: 'paragraph',
      content: richText(
        'This Privacy Policy describes how Sim ("we", "us", "our", or "the Service") collects, uses, discloses, and protects personal data, including data obtained from Google APIs (including Google Workspace APIs), and your rights and controls regarding that data. This Privacy Policy is provided for transparency and information purposes only, including to satisfy the information obligations in Articles 13 and 14 of the General Data Protection Regulation ("GDPR"). It does not create contractual obligations on you. Your use of the Service is governed by the [Terms of Service](https://sim.ai/terms).'
      ),
    },
  ],
  sections: [
    {
      id: 'interpretation-and-definitions',
      heading: 'Interpretation and Definitions',
      blocks: [
        { kind: 'subheading', text: 'Interpretation' },
        {
          kind: 'paragraph',
          content: richText(
            'Under the following conditions, the meanings of words with capitalized first letters are defined. The following definitions have the same meaning whether they are written in singular or plural form.'
          ),
        },
        { kind: 'subheading', text: 'Definitions' },
        { kind: 'paragraph', content: richText('For the purposes of this Privacy Policy:') },
        {
          kind: 'list',
          items: [
            richText(
              '**Application** means the Sim web or mobile application or related services.'
            ),
            richText(
              '**Account** means a unique account created for You to access our Service or parts of our Service.'
            ),
            richText(
              '**Affiliate** means an entity that controls, is controlled by, or is under common control with a party, where "control" means ownership of 50% or more of the shares, equity interest, or other securities entitled to vote for election of directors or other managing authority.'
            ),
            richText(
              '**Business**, for the purpose of the California Consumer Privacy Act ("CCPA"), refers to the Company as the legal entity that collects Consumers\' personal information and determines the purposes and means of processing that information, or on behalf of which that information is collected, and that does business in California.'
            ),
            richText(
              '**Company** (referred to as "the Company", "We", "Us", or "Our") refers to Sim Studio, Inc. For the purpose of the GDPR, the Company is the Data Controller when it determines the purposes and means of processing Personal Data.'
            ),
            richText(
              '**Cookies** are small files placed on Your computer, mobile device, or other device by a website, containing details of Your browsing history among their uses.'
            ),
            richText(
              '**Country** refers to the United States, specifically California. Sim Studio, Inc. is a Delaware corporation with its principal place of business at 80 Langton Street, San Francisco, CA 94103, USA.'
            ),
            richText(
              '**Data Controller**, for the purposes of the GDPR, refers to the person that alone or jointly with others determines the purposes and means of processing Personal Data.'
            ),
            richText(
              '**Device** means any device that can access the Service, such as a computer, cellphone, or digital tablet.'
            ),
            richText(
              '**Do Not Track (DNT)** is a concept promoted by U.S. regulatory authorities for mechanisms that allow internet users to control tracking of their online activities across websites.'
            ),
            richText(
              "**Personal Data** or **Personal Information** means information relating to an identified or identifiable individual. Under the GDPR, this includes information such as a name, identification number, location data, online identifier, or factors specific to a person's physical, physiological, genetic, mental, economic, cultural, or social identity. Under the CCPA, it includes information that identifies, relates to, describes, is capable of being associated with, or could reasonably be linked, directly or indirectly, with You."
            ),
            richText(
              '**Google Data** means any data, content, or metadata obtained via Google APIs, including Google Workspace APIs.'
            ),
            richText(
              "**Generalized AI/ML Model** means an AI or machine-learning model intended to be broadly trained across multiple users and not specific to a single user's data or behavior."
            ),
            richText(
              '**User-facing Features** means features directly visible or used by the individual user through the application interface.'
            ),
            richText(
              "**Sale**, for the purpose of the CCPA, means selling, renting, releasing, disclosing, disseminating, making available, transferring, or otherwise communicating a Consumer's Personal Information to another business or third party for monetary or other valuable consideration."
            ),
            richText(
              '**Service Provider** means a natural or legal person that processes data on behalf of the Company, including third parties engaged to facilitate, provide, support, or analyze the Service. For the purpose of the GDPR, Service Providers are Data Processors.'
            ),
            richText(
              '**Third-party Social Media Service** means a website or social network through which a User can log in to or create an Account for the Service.'
            ),
            richText(
              '**Usage Data** means data collected automatically, either generated through use of the Service or from the Service infrastructure itself.'
            ),
            richText('**Website** refers to Sim, accessible from sim.ai.'),
            richText(
              '**You** means the individual accessing or using the Service, or the company or other legal entity on whose behalf that individual accesses or uses the Service. Under the GDPR, You may be the Data Subject or User.'
            ),
          ],
        },
      ],
    },
    {
      id: 'information-we-collect',
      heading: '1. Information We Collect',
      blocks: [
        { kind: 'subheading', text: 'Personal Data You Provide' },
        {
          kind: 'paragraph',
          content: richText(
            'When you sign up, link accounts, or use features, you may provide Personal Data such as:'
          ),
        },
        {
          kind: 'list',
          items: [
            richText('Name and email address'),
            richText('Phone number and mailing address'),
            richText('Profile picture, settings, and preferences'),
            richText('Content you upload, including documents and files'),
            richText('Data you explicitly input or connect, including through Google integrations'),
          ],
        },
        { kind: 'subheading', text: 'Google Data via API Scopes' },
        {
          kind: 'paragraph',
          content: richText(
            'If you choose to connect your Google account, including Google Workspace, Gmail, Drive, Calendar, or Contacts, we may request specific scopes. Google Data we may access includes:'
          ),
        },
        {
          kind: 'list',
          items: [
            richText('Basic profile information, including name and email address'),
            richText('Drive files'),
            richText('Calendar events'),
            richText('Contacts'),
            richText('Gmail messages, only when explicitly requested for a specific feature'),
            richText('Other Google Workspace content or metadata needed for an enabled feature'),
          ],
        },
        {
          kind: 'paragraph',
          content: richText(
            'We request only the minimum scopes necessary for the features you enable. We do not request scopes for unimplemented features.'
          ),
        },
        { kind: 'subheading', text: 'Usage Data' },
        {
          kind: 'paragraph',
          content: richText(
            'We may collect information about how the Service is accessed and used. Usage Data may include your Internet Protocol address, browser type, browser version, pages visited, date and time of a visit, time spent on pages, unique Device identifiers, and other diagnostic data.'
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            'When You access the Service through a mobile Device, we may collect the Device type, unique Device identifier, Device Internet Protocol address, mobile operating system, mobile browser type, and other diagnostic data. We may also collect information that Your browser sends when You visit or access the Service.'
          ),
        },
        { kind: 'subheading', text: 'Tracking and Cookies Data' },
        {
          kind: 'paragraph',
          content: richText(
            'We use Cookies and similar tracking technologies, including beacons, tags, scripts, local storage, and pixels, to track activity and hold certain information. Where consent is required, non-essential Cookies are disabled until You make a choice through the cookie banner. Necessary Cookies remain enabled because the Service cannot operate without them. You may accept, reject, or customize non-essential Cookie categories and may later change or withdraw that choice.'
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            'The [Cookie Policy](https://sim.ai/cookie-policy) lists the Cookies set by Sim and its providers, their purposes, lifetimes, providers, and the methods for changing or withdrawing a choice.'
          ),
        },
      ],
    },
    {
      id: 'legal-bases',
      heading: '1A. Legal Bases for Processing',
      blocks: [
        {
          kind: 'paragraph',
          content: richText(
            'Where the GDPR applies, Sim relies on the legal bases in Article 6(1) as follows:'
          ),
        },
        {
          kind: 'table',
          columns: ['Processing activity', 'Personal data', 'Legal basis', 'Note'],
          rows: [
            [
              'Creating and operating an Account',
              'Name, email address, profile information, credentials, settings, and Account identifiers',
              'Contractual necessity — Article 6(1)(b)',
              'Required to create, authenticate, maintain, and administer the Account requested by You.',
            ],
            [
              'Delivering the Service and user-enabled integrations',
              'Customer content, workflow inputs and outputs, integration data, Google Data, support information, Device information, and Usage Data needed for delivery',
              'Contractual necessity — Article 6(1)(b)',
              'Required to provide the Service, integrations, and user-facing features You choose to enable.',
            ],
            [
              'Billing and payment administration',
              'Billing contact information, transaction details, subscription information, and payment status',
              'Contractual necessity — Article 6(1)(b)',
              'Required to administer paid products and services. Payment card details are provided directly to the payment processor and are not stored by Sim.',
            ],
            [
              'Product analytics and service improvement',
              'Usage Data, Device data, feature interactions, diagnostics, and aggregated or anonymized non-Google data',
              'Legitimate interests — Article 6(1)(f)',
              "Sim's interest is to understand use of the Service, improve reliability and features, and measure performance. Non-essential analytics Cookies are processed on consent where consent is required.",
            ],
            [
              'Abuse, fraud, and security monitoring',
              'Account identifiers, Internet Protocol addresses, Usage Data, logs, Device information, and security-event data',
              'Legitimate interests — Article 6(1)(f)',
              "Sim's interest is to protect users, the Service, systems, and data; prevent misuse; investigate incidents; and maintain service integrity.",
            ],
            [
              'Non-essential Cookies and similar technologies',
              'Online identifiers, Cookie identifiers, Device and browser information, and interaction data',
              'Consent — Article 6(1)(a)',
              'Consent may be changed or withdrawn at any time through the cookie preferences link. Necessary Cookies do not depend on consent where they are required to provide the requested Service.',
            ],
            [
              'Marketing communications',
              'Name, email address, communication preferences, and engagement data',
              'Consent — Article 6(1)(a)',
              'Consent may be withdrawn at any time through the unsubscribe method in the communication.',
            ],
            [
              'Behavioral remarketing',
              'Cookie and pixel identifiers, browser and Device data, campaign attribution, and website interaction data',
              'Consent — Article 6(1)(a)',
              'Marketing cookies and ad personalization require Marketing consent. Google Ads may load earlier with ad storage denied and send limited cookieless consent signals. Consent may be changed or withdrawn through the cookie preferences link.',
            ],
            [
              'Retaining transaction and tax records',
              'Billing records, transaction information, and related business records',
              'Legal obligation — Article 6(1)(c)',
              'Records are retained as required by applicable accounting, tax, and corporate laws.',
            ],
            [
              'Responding to lawful requests',
              'Personal Data within the scope of a binding legal request',
              'Legal obligation — Article 6(1)(c)',
              'Processing is limited to what applicable law or a valid legal process requires.',
            ],
          ],
        },
        {
          kind: 'paragraph',
          content: richText(
            'For processing based on legitimate interests, Sim performs a balancing assessment that considers the interest pursued, the necessity of the processing, and the rights and reasonable expectations of the affected individuals. You may object to that processing under Article 21 of the GDPR as described in section 14.'
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            'Sim does not rely on public interest under Article 6(1)(e) or vital interests under Article 6(1)(d) for any current processing. Sim does not process special-category data under Article 9 as part of providing the Service.'
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            "Where Sim processes customer content on behalf of a customer, Sim acts as a processor, the customer is the controller, and the customer determines the applicable legal basis. That processing is governed by the Data Processing Addendum and the customer's documented instructions."
          ),
        },
      ],
    },
    {
      id: 'how-we-use-information',
      heading: '2. How We Use Your Information',
      blocks: [
        {
          kind: 'paragraph',
          content: richText('We use collected data for the following purposes:'),
        },
        {
          kind: 'list',
          items: [
            richText('To provide and maintain the Service'),
            richText('To notify You about changes to the Service'),
            richText(
              'To allow You to participate in interactive features when You choose to do so'
            ),
            richText('To provide customer care and support'),
            richText('To provide analysis or information that helps us improve the Service'),
            richText('To monitor use of the Service'),
            richText('To detect, prevent, and address technical issues'),
            richText('To manage Your Account'),
            richText('To perform our contract with You'),
            richText(
              'To contact You by email, telephone, SMS, or equivalent electronic communications'
            ),
            richText(
              'To enable and support user-enabled integrations with Google services, including file or calendar synchronization, personalization, suggestions, and user-specific automation'
            ),
            richText('To detect and prevent fraud, abuse, and security incidents'),
            richText('To comply with legal obligations'),
          ],
        },
        {
          kind: 'paragraph',
          content: richText(
            'Any Google Data used within Sim is used only for features tied to that specific user and is not used for generalized AI/ML training or shared model improvement across users.'
          ),
        },
      ],
    },
    {
      id: 'transfer-of-data',
      heading: '3. Transfer Of Data',
      blocks: [
        {
          kind: 'paragraph',
          content: richText(
            "Your information, including Personal Data, may be transferred to and maintained on computers outside Your state, province, country, or other governmental jurisdiction, where data protection laws may differ. If You are outside the United States and provide information to us, we transfer the data to the United States and process it there. Sim's primary hosting region is AWS us-east-1 in the United States. The current Service Provider list is maintained on the Sub-processors page."
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            'Providing Personal Data does not by itself constitute consent to an international transfer. Where Sim relies on consent, that consent will be freely given, specific, informed, unambiguous, obtained separately through a positive action, and recorded.'
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            'International transfers from the European Economic Area or United Kingdom are made using applicable transfer safeguards, including:'
          ),
        },
        {
          kind: 'list',
          items: [
            richText(
              "The European Commission's Standard Contractual Clauses adopted by Implementing Decision (EU) 2021/914 and, for transfers from the United Kingdom, the UK International Data Transfer Addendum"
            ),
            richText(
              'Data Processing Addenda with each sub-processor that incorporate the applicable transfer clauses'
            ),
            richText('Transfer impact assessments where required'),
            richText(
              'Technical and organizational measures described in section 5, including encryption in transit and at rest, access controls, and logging'
            ),
          ],
        },
        {
          kind: 'paragraph',
          content: richText(
            'A copy of the applicable transfer clauses is available on request at privacy@sim.ai.'
          ),
        },
      ],
    },
    {
      id: 'data-privacy-framework',
      heading: '3A. Data Privacy Framework',
      blocks: [
        { kind: 'subheading', text: 'Participation and Scope' },
        {
          kind: 'paragraph',
          content: richText(
            'Sim Studio, Inc. complies with the EU-U.S. Data Privacy Framework (EU-U.S. DPF), the UK Extension to the EU-U.S. DPF, and the Swiss-U.S. Data Privacy Framework (Swiss-U.S. DPF) as set forth by the U.S. Department of Commerce. Sim Studio, Inc. has certified to the U.S. Department of Commerce that it adheres to the EU-U.S. Data Privacy Framework Principles (EU-U.S. DPF Principles) with regard to the processing of Personal Data received from the European Union in reliance on the EU-U.S. DPF and from the United Kingdom and Gibraltar in reliance on the UK Extension to the EU-U.S. DPF. Sim Studio, Inc. has certified to the U.S. Department of Commerce that it adheres to the Swiss-U.S. Data Privacy Framework Principles (Swiss-U.S. DPF Principles) with regard to the processing of Personal Data received from Switzerland in reliance on the Swiss-U.S. DPF. If there is any conflict between this Privacy Policy and the applicable DPF Principles, the DPF Principles govern. To learn more about the DPF program and view our certification, visit the [Data Privacy Framework website](https://www.dataprivacyframework.gov/) and [Data Privacy Framework List](https://www.dataprivacyframework.gov/list).'
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            "Sim subjects all Personal Data received from the European Union, the United Kingdom and Gibraltar, and Switzerland in reliance on the applicable part of the DPF program to the relevant DPF Principles. Sim Studio, Inc. has no other U.S. entities or U.S. subsidiaries covered by its certification. Sim's certification under the EU-U.S. DPF, the UK Extension to the EU-U.S. DPF, and the Swiss-U.S. DPF covers non-human-resources Personal Data only. Human-resources data is not covered by this certification."
          ),
        },
        { kind: 'subheading', text: 'Notice, Use, and Choice' },
        {
          kind: 'paragraph',
          content: richText(
            "Sections 1 and 2 describe the types of Personal Data Sim collects and the purposes for which Sim collects and uses it. Sim may disclose Personal Data to cloud hosting and infrastructure providers, authentication providers, customer-support providers, analytics and advertising providers, payment processors, integration providers, AI model providers, professional advisers, public authorities, and parties involved in a corporate transaction, in each case for the purposes described in sections 4, 6, 8, 9, and 10A. Service Providers acting on Sim's behalf may process Personal Data only for limited and specified purposes consistent with Sim's instructions."
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            "Where the DPF Principles require choice, You may opt out of the disclosure of covered Personal Data to a third party that is not acting as Sim's agent or its use for a purpose materially different from the purpose for which it was originally collected or subsequently authorized. You may exercise this choice by contacting privacy@sim.ai. Sim obtains affirmative express consent before disclosing sensitive Personal Data to a third party or using it for a purpose other than the purpose for which it was originally collected or subsequently authorized, except where the DPF Principles allow otherwise. Sim also treats Personal Data as sensitive when a third party identifies and treats it as sensitive."
          ),
        },
        { kind: 'subheading', text: 'Data Integrity, Purpose Limitation, and Security' },
        {
          kind: 'paragraph',
          content: richText(
            'Sim limits covered Personal Data to information relevant for the purposes of processing and does not process it in a way that is incompatible with those purposes unless subsequently authorized by the individual or otherwise permitted by the applicable DPF Principles. To the extent necessary for those purposes, Sim takes reasonable steps to ensure that covered Personal Data is reliable for its intended use, accurate, complete, and current. Sim retains covered Personal Data only for as long as it serves a processing purpose, subject to the exceptions permitted by the applicable DPF Principles. Section 5 describes the safeguards Sim uses to protect Personal Data against loss, misuse, and unauthorized access, disclosure, alteration, or destruction.'
          ),
        },
        { kind: 'subheading', text: 'Accountability for Onward Transfers' },
        {
          kind: 'paragraph',
          content: richText(
            "For onward transfers of covered Personal Data to a third party acting as a controller, Sim complies with the Notice and Choice Principles and requires the recipient by contract to process the data only for limited and specified purposes consistent with the consent provided and to provide the same level of protection as the applicable DPF Principles. For transfers to a third party acting as an agent, Sim transfers covered Personal Data only for limited and specified purposes, requires at least the same level of privacy protection as the applicable DPF Principles, takes reasonable and appropriate steps to ensure that the agent processes the data consistently with Sim's DPF obligations, and takes reasonable and appropriate steps to stop and remediate unauthorized processing upon notice."
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            'Sim remains liable under the applicable DPF Principles if an agent processes covered Personal Data in a manner inconsistent with the DPF Principles, unless Sim proves that it is not responsible for the event giving rise to the damage.'
          ),
        },
        { kind: 'subheading', text: 'Access and Public-Authority Requests' },
        {
          kind: 'paragraph',
          content: richText(
            'You may request access to covered Personal Data and ask Sim to correct, amend, or delete it where it is inaccurate or has been processed in violation of the applicable DPF Principles. The methods for submitting a request are described in sections 14 and 17. Sim may be required to disclose Personal Data in response to lawful requests by public authorities, including to meet national-security or law-enforcement requirements.'
          ),
        },
        { kind: 'subheading', text: 'Questions, Complaints, and Independent Recourse' },
        {
          kind: 'paragraph',
          content: richText(
            'In compliance with the EU-U.S. DPF, the UK Extension to the EU-U.S. DPF, and the Swiss-U.S. DPF, Sim commits to resolve DPF Principles-related complaints about its collection and use of Personal Data. Individuals in the European Union, the United Kingdom and Gibraltar, and Switzerland with inquiries or complaints regarding Personal Data received in reliance on the applicable DPF program should first contact Sim using the information in section 17. Sim will respond to a DPF Principles-related complaint within 45 days.'
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            "For unresolved complaints, Sim commits to cooperate with and comply with the advice of the panel established by the European Union data protection authorities, the United Kingdom Information Commissioner's Office and the Gibraltar Regulatory Authority, and the Swiss Federal Data Protection and Information Commissioner, as applicable. These independent recourse mechanisms are available at no cost to You. For more information about submitting a complaint, visit the [DPF complaint guidance](https://www.dataprivacyframework.gov/program-articles/How-to-Submit-a-Complaint-Relating-to-a-Participating-Organization%E2%80%99s-Compliance-with-the-DPF-Principles)."
          ),
        },
        { kind: 'subheading', text: 'Enforcement and Binding Arbitration' },
        {
          kind: 'paragraph',
          content: richText(
            "The Federal Trade Commission has jurisdiction over Sim Studio, Inc.'s compliance with the EU-U.S. DPF, the UK Extension to the EU-U.S. DPF, and the Swiss-U.S. DPF."
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            "Under certain conditions, You may invoke binding arbitration for residual claims regarding Sim's compliance with the applicable DPF Principles that have not been resolved through the other DPF mechanisms. For more information about the requirements and procedure for invoking binding arbitration, see [Annex I of the DPF Principles](https://www.dataprivacyframework.gov/framework-article/ANNEX-I-introduction)."
          ),
        },
      ],
    },
    {
      id: 'disclosure-of-data',
      heading: '4. Disclosure Of Data',
      blocks: [
        { kind: 'subheading', text: 'Business Transactions' },
        {
          kind: 'paragraph',
          content: richText(
            'If the Company is involved in a merger, acquisition, or asset sale, Your Personal Data may be transferred. We will provide notice before Your Personal Data is transferred and becomes subject to a different Privacy Policy.'
          ),
        },
        { kind: 'subheading', text: 'Law Enforcement' },
        {
          kind: 'paragraph',
          content: richText(
            'The Company may be required to disclose Your Personal Data if required by law or in response to valid requests by public authorities, including a court or government agency and to meet national-security or law-enforcement requirements.'
          ),
        },
        { kind: 'subheading', text: 'Legal Requirements' },
        {
          kind: 'paragraph',
          content: richText(
            'Sim may disclose Your Personal Data in the good-faith belief that the action is necessary to:'
          ),
        },
        {
          kind: 'list',
          items: [
            richText('Comply with a legal obligation'),
            richText('Protect and defend the rights or property of Sim'),
            richText('Prevent or investigate possible wrongdoing connected with the Service'),
            richText('Protect the personal safety of users of the Service or the public'),
            richText('Protect against legal liability'),
          ],
        },
      ],
    },
    {
      id: 'security-of-data',
      heading: '5. Security Of Data',
      blocks: [
        {
          kind: 'paragraph',
          content: richText(
            'The security of Your data is important to us, but no method of transmission over the Internet or method of electronic storage is completely secure. We use technical and organizational measures designed to protect Personal Data, including encryption in transit and at rest, access controls, role-based permissions, logging, and auditing. While we use commercially acceptable measures to protect Personal Data, we cannot guarantee absolute security.'
          ),
        },
      ],
    },
    {
      id: 'service-providers',
      heading: '6. Service Providers',
      blocks: [
        {
          kind: 'paragraph',
          content: richText(
            'We engage third-party companies and individuals to facilitate the Service, provide the Service on our behalf, perform Service-related services, or assist us in analyzing how the Service is used. These Service Providers may access Personal Data only to perform assigned tasks on our behalf and may not disclose or use it for another purpose.'
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            'The legal basis for disclosing Personal Data to Service Providers depends on the service involved:'
          ),
        },
        {
          kind: 'list',
          items: [
            richText(
              '**Contractual necessity — Article 6(1)(b):** providers required to deliver the Service, integrations, billing, or other features requested by You'
            ),
            richText(
              "**Legitimate interests — Article 6(1)(f):** providers used for security, hosting, monitoring, and support tooling, where Sim's interests are to operate, protect, maintain, and support the Service"
            ),
            richText(
              '**Consent — Article 6(1)(a):** analytics and advertising providers activated through non-essential Cookies or similar technologies'
            ),
          ],
        },
        {
          kind: 'paragraph',
          content: richText(
            "Every Service Provider that processes Personal Data on Sim's behalf is engaged under a written data processing agreement that imposes confidentiality, purpose limitation, security, and sub-processor controls. Each provider is security-reviewed before onboarding and periodically thereafter and acts only on Sim's documented instructions. The current provider list is maintained on the Sub-processors page."
          ),
        },
      ],
    },
    {
      id: 'analytics',
      heading: '7. Analytics',
      blocks: [
        {
          kind: 'paragraph',
          content: richText(
            'We may aggregate or anonymize non-Google data that is not tied to personal identity for internal analytics, product improvement, usage trends, or performance monitoring. This data cannot be tied back to individual users and is not used for generalized AI/ML training with Google Data.'
          ),
        },
      ],
    },
    {
      id: 'behavioral-remarketing',
      heading: '8. Behavioral Remarketing',
      blocks: [
        {
          kind: 'paragraph',
          content: richText(
            'The Company uses Google Ads, Twitter, and Facebook remarketing services to advertise on third-party websites after You visit the Service. These services operate through non-essential Cookies and similar technologies. Marketing Cookies and ad personalization are enabled only after You give consent to the Marketing category in the cookie banner. Google Ads may load before that consent with ad storage denied and send limited cookieless consent signals, as described in the Cookie Policy.'
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            'You may change or withdraw consent at any time through the cookie preferences link. If Your browser or extension sends a Global Privacy Control signal, we treat it as a withdrawal of consent for analytics and marketing Cookies. The [Cookie Policy](https://sim.ai/cookie-policy) explains the technologies, providers, purposes, lifetimes, and available controls.'
          ),
        },
        {
          kind: 'paragraph',
          content: richText('Provider-level controls remain available as an additional route:'),
        },
        {
          kind: 'list',
          items: [
            richText('Google Ads: [Google Ads Settings](https://adssettings.google.com/)'),
            richText(
              'Twitter: [Personalization and data settings](https://twitter.com/settings/account/personalization)'
            ),
            richText('Facebook: [Ad preferences](https://www.facebook.com/adpreferences/)'),
          ],
        },
      ],
    },
    {
      id: 'payments',
      heading: '9. Payments',
      blocks: [
        {
          kind: 'paragraph',
          content: richText(
            'We may provide paid products or services within the Service and may use third-party payment processors. We do not store or collect Your payment card details. Those details are provided directly to the payment processor, whose use of Personal Data is governed by its privacy policy. Payment processors adhere to the PCI Data Security Standard managed by the PCI Security Standards Council. The payment processor we use is Stripe.'
          ),
        },
      ],
    },
    {
      id: 'google-workspace-apis',
      heading: '10. Use of Google / Workspace APIs & Data: Limited Use',
      blocks: [
        { kind: 'subheading', text: 'Affirmative Statement and Compliance' },
        {
          kind: 'paragraph',
          content: richText(
            "Sim's use, storage, processing, and transfer of Google Data, whether raw or derived, strictly adheres to the Google API Services User Data Policy, including the Limited Use requirements, and to the Google Workspace API user data policy where applicable. We affirm that:"
          ),
        },
        {
          kind: 'list',
          items: [
            richText(
              'Sim does not use, transfer, or allow Google Data to be used to train, improve, or develop generalized or non-personalized AI/ML models.'
            ),
            richText(
              'Processing of Google Data is limited to providing or improving user-facing features visible in the application interface.'
            ),
            richText(
              'We do not allow third parties to access Google Data for training or model improvement.'
            ),
            richText(
              'Transfers of Google Data are disallowed except in the limited permitted cases described below.'
            ),
          ],
        },
        { kind: 'subheading', text: 'Permitted Transfers and Data Use' },
        {
          kind: 'paragraph',
          content: richText(
            'We may transfer Google Data, whether raw or derived, to third parties only under the following limited conditions and in line with user disclosures and consent:'
          ),
        },
        {
          kind: 'list',
          items: [
            richText(
              "To provide or improve user-facing features, with the user's explicit consent"
            ),
            richText('For security, abuse investigation, or system integrity'),
            richText('To comply with laws or legal obligations'),
            richText(
              'As part of a merger, acquisition, divestiture, or sale of assets, with explicit user consent'
            ),
          ],
        },
        { kind: 'subheading', text: 'Human Access Restrictions' },
        {
          kind: 'paragraph',
          content: richText(
            'No employee, contractor, or agent may view Google Data unless one of the following applies:'
          ),
        },
        {
          kind: 'list',
          items: [
            richText(
              'The user gave explicit, documented consent to view specific items, such as allowing customer support to view a particular email or file.'
            ),
            richText('Access is necessary for security, abuse investigation, or legal process.'),
            richText(
              'The data is aggregated and anonymized and used for internal operations only, without re-identification.'
            ),
          ],
        },
        { kind: 'subheading', text: 'Scope Minimization and Justification' },
        {
          kind: 'paragraph',
          content: richText(
            'We request only scopes essential to features You choose to enable. We do not request broad or unused permissions. For each Google API scope requested, we maintain internal documentation explaining why the scope is needed and why a narrower scope is insufficient. Where possible, we use incremental authorization and request additional scopes only when needed in context.'
          ),
        },
        { kind: 'subheading', text: 'Secure Handling and Storage' },
        {
          kind: 'list',
          items: [
            richText('Google Data is encrypted in transit using TLS/HTTPS and at rest.'),
            richText(
              'Access controls, role-based permissions, logging, and auditing protect Google Data.'
            ),
            richText(
              'OAuth tokens and credentials are stored securely using encrypted vault or secure key-management controls.'
            ),
            richText('We regularly review security practices and infrastructure.'),
            richText(
              'If a security incident affects Google Data, we notify Google as required and cooperate fully.'
            ),
          ],
        },
        { kind: 'subheading', text: 'Retention and Deletion' },
        {
          kind: 'paragraph',
          content: richText('We retain data only as long as necessary for the disclosed purposes:'),
        },
        {
          kind: 'table',
          columns: ['Data category', 'Retention period'],
          rows: [
            ['Account Data', 'During the active Account and for 30 days after a deletion request'],
            [
              'Google API Data',
              'During use of the enabled feature and for 7 days after revocation or Account deletion',
            ],
            ['Usage Logs', '90 days for analytics; up to 1 year for security investigations'],
            ['Transaction Records', 'Up to 7 years for legal and tax compliance'],
          ],
        },
        {
          kind: 'paragraph',
          content: richText(
            'When You revoke access, delete Your Account, or stop using a feature, we remove associated data within the timeframes above. You may request deletion through in-app settings or by contacting us.'
          ),
        },
      ],
    },
    {
      id: 'artificial-intelligence',
      heading: '10A. Use of Artificial Intelligence',
      blocks: [
        {
          kind: 'paragraph',
          content: richText(
            'Sim is a platform for building and running AI agents. AI models process the prompts, files, records, integration data, and other content that users choose to send through their workflows.'
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            'Model providers are engaged as sub-processors under Data Processing Addenda and are identified on the Sub-processors page. Customer content sent to a model provider is not used by Sim or by that provider to train or improve generalized or shared models. This commitment applies to customer content generally and restates the Google Data Limited Use commitment in section 10 for Google Data.'
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            "Users choose which models and providers their workflows call. Users may also bring their own provider credentials. When a user supplies provider credentials, the selected provider's processing remains subject to the user's arrangement with that provider as well as the workflow configuration chosen by the user."
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            'AI outputs are probabilistic and may be incomplete, inaccurate, or unsuitable for a particular purpose. Users should review outputs and should not rely on them as the sole basis for a decision that produces legal or similarly significant effects on an individual.'
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            'Sim does not carry out automated decision-making that produces legal or similarly significant effects on individuals within the meaning of Article 22 of the GDPR. If that changes, we will update this Privacy Policy and provide the safeguards required by Article 22, including information about the logic involved and the right to obtain human intervention, express a point of view, and contest the decision where applicable.'
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            'Prompts and outputs are retained according to the data category and context in which they are processed. Account and workflow content follows the Account Data period in the retention table in section 10; Google Data, Usage Logs, and Transaction Records follow their respective periods in that table. Questions about AI processing may be sent to privacy@sim.ai.'
          ),
        },
      ],
    },
    {
      id: 'links-to-other-sites',
      heading: '11. Links To Other Sites',
      blocks: [
        {
          kind: 'paragraph',
          content: richText(
            "Our Service may contain links to sites not operated by us. If You follow a third-party link, You will be directed to that third party's site. We recommend reviewing the privacy policy of each site You visit. We do not control and are not responsible for the content, privacy policies, or practices of third-party sites or services."
          ),
        },
      ],
    },
    {
      id: 'childrens-privacy',
      heading: "12. Children's Privacy",
      blocks: [
        {
          kind: 'paragraph',
          content: richText(
            "The Service is not directed at anyone under the age of 18, and Sim does not knowingly collect or process children's Personal Data. If children's Personal Data has been collected inadvertently without appropriate parental consent, Sim will take the necessary steps to erase it from its records. Anyone who believes that Sim has collected children's Personal Data should contact privacy@sim.ai so the matter can be addressed promptly."
          ),
        },
      ],
    },
    {
      id: 'changes-to-policy',
      heading: '13. Changes To This Privacy Policy',
      blocks: [
        {
          kind: 'paragraph',
          content: richText(
            'We may update this Privacy Policy from time to time. We will notify You by posting the revised Privacy Policy on this page and updating the "Last updated" date. For a material change, we will provide notice by email or a prominent notice on the Service before the change becomes effective. Changes take effect when posted unless the notice states otherwise.'
          ),
        },
      ],
    },
    {
      id: 'gdpr',
      heading: '14. Your Data Protection Rights Under General Data Protection Regulation (GDPR)',
      blocks: [
        {
          kind: 'paragraph',
          content: richText(
            'If You are in the European Economic Area, You have the following data protection rights:'
          ),
        },
        {
          kind: 'list',
          items: [
            richText(
              '**Access:** the right to obtain confirmation of whether we process Your Personal Data and to receive a copy of that data.'
            ),
            richText(
              '**Rectification:** the right to correct inaccurate Personal Data and complete incomplete Personal Data.'
            ),
            richText(
              '**Erasure:** the right to request deletion of Your Personal Data where the applicable conditions are met.'
            ),
            richText(
              '**Objection:** the right to object to processing based on legitimate interests and to object at any time to processing for direct marketing.'
            ),
            richText(
              '**Restriction:** the right to request restriction of processing where the applicable conditions are met.'
            ),
            richText(
              '**Data portability:** the right to receive Personal Data You provided in a structured, commonly used, machine-readable format and to transmit it to another controller where applicable.'
            ),
            richText(
              '**Withdrawal of consent:** the right to withdraw consent at any time where Sim relies on consent. Withdrawal does not affect the lawfulness of processing before withdrawal.'
            ),
          ],
        },
        {
          kind: 'paragraph',
          content: richText(
            'You may submit a request at privacy@sim.ai, through in-app Account settings for access and deletion, or by using the postal address in section 17.'
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            'We respond without undue delay and within one month after receiving a request. That period may be extended by up to two further months where necessary because of the complexity or number of requests. If an extension is required, we will tell You within the first month and explain the reason.'
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            'Requests are handled free of charge. Where a request is manifestly unfounded, excessive, or repetitive, we may charge a reasonable fee based on the administrative cost or refuse to act. If we refuse or charge a fee, we will give reasons and explain the available complaint and judicial-remedy rights.'
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            'We may request information needed to verify Your identity before acting on a request. Information collected for verification will be used only for that purpose.'
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            'You have the right to lodge a complaint with the supervisory authority in the Member State of Your residence, place of work, or place of the alleged infringement, without prejudice to any other administrative or judicial remedy.'
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            'The same rights are extended to data subjects in the United Kingdom under the UK GDPR.'
          ),
        },
      ],
    },
    {
      id: 'california-privacy',
      heading: '15. California Privacy Rights',
      blocks: [
        {
          kind: 'paragraph',
          content: richText(
            'If You are a California resident, You have rights under the CCPA and California Privacy Rights Act, including the right to know what Personal Information we collect, the right to delete Personal Information, and the right to opt out of the sale or sharing of Personal Information.'
          ),
        },
        { kind: 'subheading', text: 'Do Not Sell or Share My Personal Information' },
        {
          kind: 'paragraph',
          content: richText(
            'We do not sell Personal Information for monetary consideration. Some analytics or advertising disclosures may be considered a "sale" or "share" under California law. You may opt out by contacting privacy@sim.ai or by using the cookie preferences link.'
          ),
        },
        { kind: 'subheading', text: 'Global Privacy Control' },
        {
          kind: 'paragraph',
          content: richText(
            'We recognize and honor Global Privacy Control signals. When Your browser sends a Global Privacy Control signal, we treat it as a valid request to opt out of the sale or sharing of Personal Information.'
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            'California Civil Code section 1798.83 permits California residents to request information about categories of Personal Information disclosed to third parties for direct-marketing purposes during the preceding calendar year. Requests under the CCPA, California Privacy Rights Act, or Shine the Light law may be submitted using the contact information in section 17.'
          ),
        },
      ],
    },
    {
      id: 'vulnerability-disclosure',
      heading: '16. Vulnerability Disclosure Policy',
      blocks: [
        {
          kind: 'paragraph',
          content: richText(
            'Sim is dedicated to preserving data security by preventing unauthorized disclosure of information. This section provides security researchers with instructions for conducting vulnerability discovery and reporting identified vulnerabilities.'
          ),
        },
        { kind: 'subheading', text: 'Guidelines' },
        {
          kind: 'list',
          items: [
            richText(
              'Notify us as soon as possible after discovering a real or potential security issue.'
            ),
            richText(
              'Give us a reasonable amount of time to resolve the issue before public disclosure.'
            ),
            richText(
              'Avoid privacy violations, degradation of user experience, disruption to production systems, and destruction or manipulation of data.'
            ),
            richText(
              'Use exploits only to the extent necessary to confirm that a vulnerability exists. Do not use an exploit to compromise or obtain data, establish command-line access or persistence, or pivot to other systems.'
            ),
            richText(
              'If You encounter sensitive data, including Personal Data, financial information, proprietary information, or trade secrets, stop testing, notify us immediately, and keep the data confidential.'
            ),
            richText('Do not submit a high volume of low-quality reports.'),
          ],
        },
        { kind: 'subheading', text: 'Authorization' },
        {
          kind: 'paragraph',
          content: richText(
            'Security research performed in conformity with this policy is considered permissible. We will work with You to understand and correct the issue, and Sim will not suggest or pursue legal action in connection with conforming research.'
          ),
        },
        { kind: 'subheading', text: 'Scope' },
        {
          kind: 'paragraph',
          content: richText('This policy applies to the following systems and services:'),
        },
        {
          kind: 'list',
          items: [
            richText('sim.ai website'),
            richText('Sim web application'),
            richText('Sim API services'),
          ],
        },
        {
          kind: 'paragraph',
          content: richText(
            'A service not expressly listed above, including related third-party services, is out of scope and may not be tested. Vulnerabilities in third-party products used by Sim are not covered and should be reported to the relevant provider under its disclosure policy. If You are unsure whether a system or endpoint is in scope, contact security@sim.ai before testing.'
          ),
        },
        { kind: 'subheading', text: 'Unauthorized Testing' },
        { kind: 'paragraph', content: richText('The following testing is not authorized:') },
        {
          kind: 'list',
          items: [
            richText('Network denial-of-service or distributed denial-of-service testing'),
            richText('Physical testing, including office access, open doors, or tailgating'),
            richText('Social engineering, including phishing or vishing'),
            richText('Other non-technical vulnerability testing'),
          ],
        },
        { kind: 'subheading', text: 'Reporting' },
        {
          kind: 'paragraph',
          content: richText(
            'Send vulnerability reports to security@sim.ai. We will acknowledge a report by the next business day. Reports may be submitted anonymously.'
          ),
        },
        { kind: 'paragraph', content: richText('A report should include, where possible:') },
        {
          kind: 'list',
          items: [
            richText('A description of the vulnerability'),
            richText('The location where it was discovered'),
            richText('Its potential impact'),
            richText('Steps to reproduce it, including scripts and screenshots if available'),
          ],
        },
        {
          kind: 'paragraph',
          content: richText(
            'Reports should be provided in English where possible. If You provide contact information, we will communicate in a transparent and timely manner. We will acknowledge receipt within three business days and will keep You informed about validation and remediation to the extent possible.'
          ),
        },
      ],
    },
    {
      id: 'contact',
      heading: '17. Contact & Dispute Resolution',
      blocks: [
        {
          kind: 'paragraph',
          content: richText(
            'Questions, requests, or complaints about this Privacy Policy or our data practices may be submitted to:'
          ),
        },
        {
          kind: 'list',
          items: [
            richText('Email: privacy@sim.ai'),
            richText(
              'Mailing Address: Sim Studio, Inc., 80 Langton Street, San Francisco, CA 94103, USA'
            ),
          ],
        },
        { kind: 'subheading', text: 'Our EU Representative' },
        {
          kind: 'paragraph',
          content: richText(
            'Under Article 27 of the GDPR, Sim has appointed an EU Representative to act as its data protection agent:'
          ),
        },
        {
          kind: 'paragraph',
          content: (
            <>
              Instant EU GDPR Representative Ltd.
              <br />
              Adam Brogden
              <br />
              {richText('contact@gdprlocal.com')}
              <br />
              Tel: +353 1 554 9700
              <br />
              INSTANT EU GDPR REPRESENTATIVE LTD
              <br />
              Office 2, 12A Lower Main Street
              <br />
              Lucan, Co. Dublin, K78 X5P8
              <br />
              Ireland
            </>
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            'Data subjects in the European Economic Area may contact the Representative on any matter relating to the processing of their Personal Data.'
          ),
        },
        {
          kind: 'paragraph',
          content: richText(
            'We will respond to Your request within the timeframes stated in section 14 where those timeframes apply.'
          ),
        },
      ],
    },
  ],
}
