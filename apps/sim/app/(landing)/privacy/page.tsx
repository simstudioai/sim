'use client'

import Link from 'next/link'
import { GridPattern } from '../components/grid-pattern'
import NavWrapper from '../components/nav-wrapper'
import Footer from '../components/sections/footer'

export default function PrivacyPolicy() {
  const handleOpenTypeformLink = () => {
    window.open('https://form.typeform.com/to/jqCO12pF', '_blank')
  }

  return (
    <main className='relative min-h-screen overflow-hidden bg-[#0C0C0C] text-white'>
      {/* Grid pattern background - only covers content area */}
      <div className='absolute inset-0 bottom-[400px] z-0 overflow-hidden'>
        <GridPattern
          x={-5}
          y={-5}
          className='absolute inset-0 stroke-[#ababab]/5'
          width={90}
          height={90}
          aria-hidden='true'
        />
      </div>

      {/* Header/Navigation */}
      <NavWrapper onOpenTypeformLink={handleOpenTypeformLink} />

      {/* SVG background blur centered behind content */}
      <div
        className='-translate-x-1/2 absolute top-0 bottom-0 left-1/2 z-[1] h-full w-[95%] max-w-5xl md:w-[90%] lg:w-[80%]'
        aria-hidden='true'
      >
        <svg
          width='100%'
          height='100%'
          viewBox='0 0 600 1600'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
          preserveAspectRatio='xMidYMid slice'
          className='h-full w-full'
        >
          <g filter='url(#filter0_b_privacy)'>
            <rect width='600' height='1600' rx='0' fill='#0C0C0C' />
          </g>
          <defs>
            <filter
              id='filter0_b_privacy'
              x='-20'
              y='-20'
              width='640'
              height='1640'
              filterUnits='userSpaceOnUse'
              colorInterpolationFilters='sRGB'
            >
              <feGaussianBlur stdDeviation='7' />
            </filter>
          </defs>
        </svg>
      </div>

      {/* Content */}
      <div className='relative z-10'>
        <div className='mx-auto max-w-4xl px-4 py-16 pt-36'>
          <div className='relative px-4 py-4 sm:px-8'>
            <h1 className='mb-8 font-bold text-4xl text-white'>Privacy Policy</h1>

            <div className='space-y-8 text-white/80'>
              <section>
                <p className='mb-4'>Last Updated: April 22, 2025</p>
                <p>
                  This Privacy Policy describes how your personal information is collected, used,
                  and shared when you visit or use Sim Studio ("the Service", "we", "us", or "our").
                </p>
                <p className='mt-4'>
                  By using the Service, you agree to the collection and use of information in
                  accordance with this policy. Unless otherwise defined in this Privacy Policy,
                  terms used in this Privacy Policy have the same meanings as in our Terms of
                  Service.
                </p>
              </section>

              <section>
                <h2 className='mb-4 font-semibold text-2xl text-white'>
                  Interpretation and Definitions
                </h2>
                <h3 className='mb-2 font-medium text-[#B5A1D4] text-xl'>Interpretation</h3>
                <p className='mb-4'>
                  Under the following conditions, the meanings of words with capitalized first
                  letters are defined. The following definitions have the same meaning whether they
                  are written in singular or plural form.
                </p>

                <h3 className='mb-2 font-medium text-[#B5A1D4] text-xl'>Definitions</h3>
                <p className='mb-4'>For the purposes of this Privacy Policy:</p>
                <ul className='mb-4 list-disc space-y-2 pl-6 marker:text-[#B5A1D4]'>
                  <li>
                    <span className='text-[#B5A1D4]'>Account</span> means a unique account created
                    for You to access our Service or parts of our Service.
                  </li>
                  <li>
                    <span className='text-[#B5A1D4]'>Affiliate</span> means an entity that controls,
                    is controlled by or is under common control with a party, where "control" means
                    ownership of 50% or more of the shares, equity interest or other securities
                    entitled to vote for election of directors or other managing authority.
                  </li>
                  <li>
                    <span className='text-[#B5A1D4]'>Application</span> means the software program
                    provided by the Company downloaded by You on any electronic device.
                  </li>
                  <li>
                    <span className='text-[#B5A1D4]'>Business</span>, for the purpose of the CCPA
                    (California Consumer Privacy Act), refers to the Company as the legal entity
                    that collects Consumers' personal information and determines the purposes and
                    means of the processing of Consumers' personal information, or on behalf of
                    which such information is collected and that alone, or jointly with others,
                    determines the purposes and means of the processing of consumers' personal
                    information, that does business in the State of California.
                  </li>
                  <li>
                    <span className='text-[#B5A1D4]'>Company</span> (referred to as either "the
                    Company", "We", "Us" or "Our" in this Agreement) refers to Sim Studio. For the
                    purpose of the GDPR, the Company is the Data Controller.
                  </li>
                  <li>
                    <span className='text-[#B5A1D4]'>Cookies</span> are small files that are placed
                    on Your computer, mobile device or any other device by a website, containing the
                    details of Your browsing history on that website among its many uses.
                  </li>
                  <li>
                    <span className='text-[#B5A1D4]'>Country</span> refers to: Quebec, Canada
                  </li>
                  <li>
                    <span className='text-[#B5A1D4]'>Data Controller</span>, for the purposes of the
                    GDPR (General Data Protection Regulation), refers to the Company as the legal
                    person which alone or jointly with others determines the purposes and means of
                    the processing of Personal Data.
                  </li>
                  <li>
                    <span className='text-[#B5A1D4]'>Device</span> means any device that can access
                    the Service such as a computer, a cellphone or a digital tablet.
                  </li>
                  <li>
                    <span className='text-[#B5A1D4]'>Do Not Track (DNT)</span> is a concept that has
                    been promoted by US regulatory authorities, in particular the U.S. Federal Trade
                    Commission (FTC), for the Internet industry to develop and implement a mechanism
                    for allowing internet users to control the tracking of their online activities
                    across websites.
                  </li>
                  <li>
                    <span className='text-[#B5A1D4]'>Personal Data</span> is any information that
                    relates to an identified or identifiable individual. For the purposes for GDPR,
                    Personal Data means any information relating to You such as a name, an
                    identification number, location data, online identifier or to one or more
                    factors specific to the physical, physiological, genetic, mental, economic,
                    cultural or social identity. For the purposes of the CCPA, Personal Data means
                    any information that identifies, relates to, describes or is capable of being
                    associated with, or could reasonably be linked, directly or indirectly, with
                    You.
                  </li>
                  <li>
                    <span className='text-[#B5A1D4]'>Sale</span>, for the purpose of the CCPA
                    (California Consumer Privacy Act), means selling, renting, releasing,
                    disclosing, disseminating, making available, transferring, or otherwise
                    communicating orally, in writing, or by electronic or other means, a Consumer's
                    Personal information to another business or a third party for monetary or other
                    valuable consideration.
                  </li>
                  <li>
                    <span className='text-[#B5A1D4]'>Service</span> refers to the Application or the
                    Website or both.
                  </li>
                  <li>
                    <span className='text-[#B5A1D4]'>Service Provider</span> means any natural or
                    legal person who processes the data on behalf of the Company. It refers to
                    third-party companies or individuals employed by the Company to facilitate the
                    Service, to provide the Service on behalf of the Company, to perform services
                    related to the Service or to assist the Company in analyzing how the Service is
                    used. For the purpose of the GDPR, Service Providers are considered Data
                    Processors.
                  </li>
                  <li>
                    <span className='text-[#B5A1D4]'>Third-party Social Media Service</span> refers
                    to any website or any social network website through which a User can log in or
                    create an account to use the Service.
                  </li>
                  <li>
                    <span className='text-[#B5A1D4]'>Usage Data</span> refers to data collected
                    automatically, either generated by the use of the Service or from the Service
                    infrastructure itself (for example, the duration of a page visit).
                  </li>
                  <li>
                    <span className='text-[#B5A1D4]'>Website</span> refers to Sim Studio, accessible
                    from simstudio.ai
                  </li>
                  <li>
                    <span className='text-[#B5A1D4]'>You</span> means the individual accessing or
                    using the Service, or the company, or other legal entity on behalf of which such
                    individual is accessing or using the Service, as applicable. Under GDPR (General
                    Data Protection Regulation), You can be referred to as the Data Subject or as
                    the User as you are the individual using the Service.
                  </li>
                </ul>
              </section>

              <section>
                <h2 className='mb-4 font-semibold text-2xl text-white'>
                  1. Information We Collect
                </h2>
                <h3 className='mb-2 font-medium text-[#B5A1D4] text-xl'>Personal Information</h3>
                <p className='mb-4'>
                  While using our Service, we may ask you to provide us with certain personally
                  identifiable information that can be used to contact or identify you (
                  <span className='text-[#B5A1D4]'>"Personal Information"</span>). Personally
                  identifiable information may include, but is not limited to:
                </p>
                <ul className='mb-4 list-disc space-y-2 pl-6 marker:text-[#B5A1D4]'>
                  <li>Email address</li>
                  <li>First name and last name</li>
                  <li>Phone number</li>
                  <li>Address, State, Province, ZIP/Postal code, City</li>
                  <li>Cookies and Usage Data</li>
                </ul>

                <h3 className='mb-2 font-medium text-[#B5A1D4] text-xl'>Usage Data</h3>
                <p className='mb-4'>
                  We may also collect information on how the Service is accessed and used (
                  <span className='text-[#B5A1D4]'>"Usage Data"</span>). This Usage Data may include
                  information such as your computer's Internet Protocol address (e.g. IP address),
                  browser type, browser version, the pages of our Service that you visit, the time
                  and date of your visit, the time spent on those pages, unique device identifiers
                  and other diagnostic data.
                </p>
                <p className='mb-4'>
                  When You access the Service by or through a mobile device, We may collect certain
                  information automatically, including, but not limited to, the type of mobile
                  device You use, Your mobile device unique ID, the IP address of Your mobile
                  device, Your mobile operating system, the type of mobile Internet browser You use,
                  unique device identifiers and other diagnostic data.
                </p>
                <p className='mb-4'>
                  We may also collect information that Your browser sends whenever You visit our
                  Service or when You access the Service by or through a mobile device.
                </p>

                <h3 className='mb-2 font-medium text-[#B5A1D4] text-xl'>Tracking & Cookies Data</h3>
                <p className='mb-4'>
                  We use cookies and similar tracking technologies to track the activity on our
                  Service and hold certain information.
                </p>
                <p className='mb-4'>
                  Cookies are files with small amount of data which may include an anonymous unique
                  identifier. Cookies are sent to your browser from a website and stored on your
                  device. Tracking technologies also used are beacons, tags, and scripts to collect
                  and track information and to improve and analyze our Service.
                </p>
                <p>
                  You can instruct your browser to refuse all cookies or to indicate when a cookie
                  is being sent. However, if you do not accept cookies, you may not be able to use
                  some portions of our Service.
                </p>
              </section>

              <section>
                <h2 className='mb-4 font-semibold text-2xl text-white'>
                  2. How We Use Your Information
                </h2>
                <p className='mb-4'>We use the collected data for various purposes:</p>
                <ul className='list-disc space-y-2 pl-6 marker:text-[#B5A1D4]'>
                  <li>To provide and maintain our Service</li>
                  <li>To notify you about changes to our Service</li>
                  <li>
                    To allow you to participate in interactive features of our Service when you
                    choose to do so
                  </li>
                  <li>To provide customer care and support</li>
                  <li>
                    To provide analysis or valuable information so that we can improve the Service
                  </li>
                  <li>To monitor the usage of the Service</li>
                  <li>To detect, prevent and address technical issues</li>
                  <li>To manage Your Account</li>
                  <li>For the performance of a contract</li>
                  <li>
                    To contact You by email, telephone calls, SMS, or other equivalent forms of
                    electronic communication
                  </li>
                </ul>
              </section>

              <section>
                <h2 className='mb-4 font-semibold text-2xl text-white'>3. Transfer Of Data</h2>
                <p className='mb-4'>
                  Your information, including Personal Information, may be transferred to — and
                  maintained on — computers located outside of your state, province, country or
                  other governmental jurisdiction where the data protection laws may differ than
                  those from your jurisdiction.
                </p>
                <p className='mb-4'>
                  If you are located outside United States and choose to provide information to us,
                  please note that we transfer the data, including Personal Information, to United
                  States and process it there.
                </p>
                <p>
                  Your consent to this Privacy Policy followed by your submission of such
                  information represents your agreement to that transfer.
                </p>
              </section>

              <section>
                <h2 className='mb-4 font-semibold text-2xl text-white'>4. Disclosure Of Data</h2>

                <h3 className='mb-2 font-medium text-[#B5A1D4] text-xl'>Business Transactions</h3>
                <p className='mb-4'>
                  If the Company is involved in a merger, acquisition or asset sale, Your Personal
                  Data may be transferred. We will provide notice before Your Personal Data is
                  transferred and becomes subject to a different Privacy Policy.
                </p>

                <h3 className='mb-2 font-medium text-[#B5A1D4] text-xl'>Law Enforcement</h3>
                <p className='mb-4'>
                  Under certain circumstances, the Company may be required to disclose Your Personal
                  Data if required to do so by law or in response to valid requests by public
                  authorities (e.g. a court or a government agency).
                </p>

                <h3 className='mb-2 font-medium text-[#B5A1D4] text-xl'>Legal Requirements</h3>
                <p className='mb-4'>
                  Sim Studio may disclose your Personal Information in the good faith belief that
                  such action is necessary to:
                </p>
                <ul className='list-disc space-y-2 pl-6 marker:text-[#B5A1D4]'>
                  <li>To comply with a legal obligation</li>
                  <li>To protect and defend the rights or property of Sim Studio</li>
                  <li>
                    To prevent or investigate possible wrongdoing in connection with the Service
                  </li>
                  <li>To protect the personal safety of users of the Service or the public</li>
                  <li>To protect against legal liability</li>
                </ul>
              </section>

              <section>
                <h2 className='mb-4 font-semibold text-2xl text-white'>5. Security Of Data</h2>
                <p className='mb-4'>
                  The security of your data is important to us, but remember that no method of
                  transmission over the Internet, or method of electronic storage is 100% secure.
                  While we strive to use commercially acceptable means to protect your Personal
                  Information, we cannot guarantee its absolute security.
                </p>
              </section>

              <section>
                <h2 className='mb-4 font-semibold text-2xl text-white'>6. Service Providers</h2>
                <p className='mb-4'>
                  We may employ third party companies and individuals to facilitate our Service (
                  <span className='text-[#B5A1D4]'>"Service Providers"</span>), to provide the
                  Service on our behalf, to perform Service-related services or to assist us in
                  analyzing how our Service is used.
                </p>
                <p>
                  These third parties have access to your Personal Information only to perform these
                  tasks on our behalf and are obligated not to disclose or use it for any other
                  purpose.
                </p>
              </section>

              <section>
                <h2 className='mb-4 font-semibold text-2xl text-white'>7. Analytics</h2>
                <p className='mb-4'>
                  We may use third-party Service Providers to monitor and analyze the use of our
                  Service.
                </p>
                <h3 className='mb-2 font-medium text-[#B5A1D4] text-xl'>Google Analytics</h3>
                <p className='mb-4'>
                  Google Analytics is a web analytics service offered by Google that tracks and
                  reports website traffic. Google uses the data collected to track and monitor the
                  use of our Service. This data is shared with other Google services. Google may use
                  the collected data to contextualize and personalize the ads of its own advertising
                  network.
                </p>
                <p className='mb-4'>
                  You can opt-out of having made your activity on the Service available to Google
                  Analytics by installing the Google Analytics opt-out browser add-on. The add-on
                  prevents the Google Analytics JavaScript (ga.js, analytics.js, and dc.js) from
                  sharing information with Google Analytics about visits activity.
                </p>
                <p>
                  For more information on the privacy practices of Google, please visit the Google
                  Privacy & Terms web page:{' '}
                  <Link
                    href='https://policies.google.com/privacy?hl=en'
                    className='text-[#B5A1D4] hover:text-[#701ffc]'
                    target='_blank'
                    rel='noopener noreferrer'
                  >
                    https://policies.google.com/privacy
                  </Link>
                </p>
              </section>

              <section>
                <h2 className='mb-4 font-semibold text-2xl text-white'>
                  8. Behavioral Remarketing
                </h2>
                <p className='mb-4'>
                  The Company uses remarketing services to advertise on third party websites to You
                  after You visited our Service. We and Our third-party vendors use cookies to
                  inform, optimize and serve ads based on Your past visits to our Service.
                </p>
                <h3 className='mb-2 font-medium text-[#B5A1D4] text-xl'>Google Ads (AdWords)</h3>
                <p className='mb-4'>
                  Google Ads remarketing service is provided by Google Inc. You can opt-out of
                  Google Analytics for Display Advertising and customize the Google Display Network
                  ads by visiting the Google Ads Settings page.
                </p>

                <h3 className='mb-2 font-medium text-[#B5A1D4] text-xl'>Twitter</h3>
                <p className='mb-4'>
                  Twitter remarketing service is provided by Twitter Inc. You can opt-out from
                  Twitter's interest-based ads by following their instructions.
                </p>

                <h3 className='mb-2 font-medium text-[#B5A1D4] text-xl'>Facebook</h3>
                <p className='mb-4'>
                  Facebook remarketing service is provided by Facebook Inc. You can learn more about
                  interest-based advertising from Facebook by visiting their Privacy Policy.
                </p>
              </section>

              <section>
                <h2 className='mb-4 font-semibold text-2xl text-white'>9. Payments</h2>
                <p className='mb-4'>
                  We may provide paid products and/or services within the Service. In that case, we
                  may use third-party services for payment processing (e.g. payment processors).
                </p>
                <p className='mb-4'>
                  We will not store or collect Your payment card details. That information is
                  provided directly to Our third-party payment processors whose use of Your personal
                  information is governed by their Privacy Policy. These payment processors adhere
                  to the standards set by PCI-DSS as managed by the PCI Security Standards Council,
                  which is a joint effort of brands like Visa, Mastercard, American Express and
                  Discover. PCI-DSS requirements help ensure the secure handling of payment
                  information.
                </p>
                <h3 className='mb-2 font-medium text-[#B5A1D4] text-xl'>
                  Payment processors we work with:
                </h3>
                <ul className='mb-4 list-disc space-y-2 pl-6 marker:text-[#B5A1D4]'>
                  <li>Stripe</li>
                </ul>
              </section>

              <section>
                <h2 className='mb-4 font-semibold text-2xl text-white'>
                  10. Google Workspace APIs
                </h2>
                <p className='mb-4'>
                  We want to explicitly affirm that any user data obtained through Google Workspace
                  APIs is <span className='text-[#B5A1D4]'>not</span> used to develop, improve, or
                  train generalized AI and/or machine learning models. We use data obtained through
                  Google Workspace APIs solely for the purpose of providing and improving the
                  specific functionality of our Service for which the API access was granted.
                </p>
              </section>

              <section>
                <h2 className='mb-4 font-semibold text-2xl text-white'>
                  11. Information Collected while Using Google APIs
                </h2>
                <p className='mb-4'>
                  Sim Studio's use and transfer to any other app of information received from Google
                  APIs will adhere to Google API Services User Data Policy, including the Limited
                  Use requirements.
                </p>
              </section>

              <section>
                <h2 className='mb-4 font-semibold text-2xl text-white'>12. Links To Other Sites</h2>
                <p className='mb-4'>
                  Our Service may contain links to other sites that are not operated by us. If you
                  click on a third party link, you will be directed to that third party's site. We
                  strongly advise you to review the Privacy Policy of every site you visit.
                </p>
                <p>
                  We have no control over and assume no responsibility for the content, privacy
                  policies or practices of any third party sites or services.
                </p>
              </section>

              <section>
                <h2 className='mb-4 font-semibold text-2xl text-white'>13. Children's Privacy</h2>
                <p className='mb-4'>
                  Our Service does not address anyone under the age of 18 (
                  <span className='text-[#B5A1D4]'>"Children"</span>).
                </p>
                <p className='mb-4'>
                  We do not knowingly collect personally identifiable information from anyone under
                  the age of 18. If you are a parent or guardian and you are aware that your
                  Children has provided us with Personal Information, please contact us. If we
                  become aware that we have collected Personal Information from children without
                  verification of parental consent, we take steps to remove that information from
                  our servers.
                </p>
              </section>

              <section>
                <h2 className='mb-4 font-semibold text-2xl text-white'>
                  14. Changes To This Privacy Policy
                </h2>
                <p className='mb-4'>
                  We may update our Privacy Policy from time to time. We will notify you of any
                  changes by posting the new Privacy Policy on this page.
                </p>
                <p className='mb-4'>
                  We will let you know via email and/or a prominent notice on our Service, prior to
                  the change becoming effective and update the "Last updated" date at the top of
                  this Privacy Policy.
                </p>
                <p>
                  You are advised to review this Privacy Policy periodically for any changes.
                  Changes to this Privacy Policy are effective when they are posted on this page.
                </p>
              </section>

              <section>
                <h2 className='mb-4 font-semibold text-2xl text-white'>
                  15. Your Data Protection Rights Under General Data Protection Regulation (GDPR)
                </h2>
                <p className='mb-4'>
                  If you are a resident of the European Economic Area (EEA), you have certain data
                  protection rights. Sim Studio aims to take reasonable steps to allow you to
                  correct, amend, delete, or limit the use of your Personal Information.
                </p>
                <p className='mb-4'>
                  If you wish to be informed what Personal Information we hold about you and if you
                  want it to be removed from our systems, please contact us.
                </p>
                <p className='mb-4'>
                  In certain circumstances, you have the following data protection rights:
                </p>
                <ul className='mb-4 list-disc space-y-2 pl-6 marker:text-[#B5A1D4]'>
                  <li>The right to access, update or to delete the information we have on you.</li>
                  <li>
                    The right of rectification. You have the right to have your information
                    rectified if that information is inaccurate or incomplete.
                  </li>
                  <li>
                    The right to object. You have the right to object to our processing of your
                    Personal Information.
                  </li>
                  <li>
                    The right of restriction. You have the right to request that we restrict the
                    processing of your personal information.
                  </li>
                  <li>
                    The right to data portability. You have the right to be provided with a copy of
                    the information we have on you in a structured, machine-readable and commonly
                    used format.
                  </li>
                  <li>
                    The right to withdraw consent. You also have the right to withdraw your consent
                    at any time where Sim Studio relied on your consent to process your personal
                    information.
                  </li>
                </ul>
                <p className='mb-4'>
                  Please note that we may ask you to verify your identity before responding to such
                  requests.
                </p>
                <p className='mb-4 border-[#701ffc] border-l-4 bg-[#701ffc]/10 p-3'>
                  You have the right to complain to a Data Protection Authority about our collection
                  and use of your Personal Information. For more information, please contact your
                  local data protection authority in the European Economic Area (EEA).
                </p>
              </section>

              <section>
                <h2 className='mb-4 font-semibold text-2xl text-white'>
                  16. California Privacy Rights
                </h2>
                <p className='mb-4'>
                  California Civil Code Section 1798.83, also known as the{' '}
                  <span className='text-[#B5A1D4]'>"Shine The Light"</span> law, permits our users
                  who are California residents to request and obtain from us, once a year and free
                  of charge, information about categories of personal information (if any) we
                  disclosed to third parties for direct marketing purposes and the names and
                  addresses of all third parties with which we shared personal information in the
                  immediately preceding calendar year.
                </p>
                <p className='mb-4'>
                  If you are a California resident and would like to make such a request, please
                  submit your request in writing to us using the contact information provided below.
                </p>
              </section>

              <section>
                <h2 className='mb-4 font-semibold text-2xl text-white'>
                  17. Vulnerability Disclosure Policy
                </h2>
                <h3 className='mb-2 font-medium text-[#B5A1D4] text-xl'>Introduction</h3>
                <p className='mb-4'>
                  Sim Studio is dedicated to preserving data security by preventing unauthorized
                  disclosure of information. This policy was created to provide security researchers
                  with instructions for conducting vulnerability discovery activities and to provide
                  information on how to report vulnerabilities that have been discovered. This
                  policy explains which systems and sorts of activity are covered, how to send
                  vulnerability reports, and how long we require you to wait before publicly
                  reporting vulnerabilities identified.
                </p>

                <h3 className='mb-2 font-medium text-[#B5A1D4] text-xl'>Guidelines</h3>
                <p className='mb-4'>We request that you:</p>
                <ul className='mb-4 list-disc space-y-2 pl-6 marker:text-[#B5A1D4]'>
                  <li>
                    Notify us as soon as possible after you discover a real or potential security
                    issue.
                  </li>
                  <li>
                    Provide us a reasonable amount of time to resolve the issue before you disclose
                    it publicly.
                  </li>
                  <li>
                    Make every effort to avoid privacy violations, degradation of user experience,
                    disruption to production systems, and destruction or manipulation of data.
                  </li>
                  <li>
                    Only use exploits to the extent necessary to confirm a vulnerability's presence.
                    Do not use an exploit to compromise or obtain data, establish command line
                    access and/or persistence, or use the exploit to "pivot" to other systems.
                  </li>
                  <li>
                    Once you've established that a vulnerability exists or encounter any sensitive
                    data (including personal data, financial information, or proprietary information
                    or trade secrets of any party), you must stop your test, notify us immediately,
                    and keep the data strictly confidential.
                  </li>
                  <li>Do not submit a high volume of low-quality reports.</li>
                </ul>

                <h3 className='mb-2 font-medium text-[#B5A1D4] text-xl'>Authorization</h3>
                <p className='mb-4'>
                  Security research carried out in conformity with this policy is deemed
                  permissible. We'll work with you to swiftly understand and fix the problem, and
                  Sim Studio will not suggest or pursue legal action in connection with your study.
                </p>

                <h3 className='mb-2 font-medium text-[#B5A1D4] text-xl'>Scope</h3>
                <p className='mb-4'>This policy applies to the following systems and services:</p>
                <ul className='mb-4 list-disc space-y-2 pl-6 marker:text-[#B5A1D4]'>
                  <li>simstudio.ai website</li>
                  <li>Sim Studio web application</li>
                  <li>Sim Studio API services</li>
                </ul>
                <p className='mb-4'>
                  Any service that isn't explicitly specified above, such as related services, is
                  out of scope and isn't allowed to be tested. Vulnerabilities discovered in
                  third-party solutions Sim Studio interacts with are not covered by this policy and
                  should be reported directly to the solution vendor in accordance with their
                  disclosure policy (if any). Before beginning your inquiry, email us at{' '}
                  <Link
                    href='mailto:security@simstudio.ai'
                    className='text-[#B5A1D4] hover:text-[#701ffc]'
                  >
                    security@simstudio.ai
                  </Link>{' '}
                  if you're unsure whether a system or endpoint is in scope.
                </p>

                <h3 className='mb-2 font-medium text-[#B5A1D4] text-xl'>Types of testing</h3>
                <p className='mb-4'>The following test types are not authorized:</p>
                <ul className='mb-4 list-disc space-y-2 pl-6 marker:text-[#B5A1D4]'>
                  <li>Network denial of service (DoS or DDoS) tests</li>
                  <li>
                    Physical testing (e.g., office access, open doors, tailgating), social
                    engineering (e.g., phishing, vishing), or any other non-technical vulnerability
                    testing
                  </li>
                </ul>

                <h3 className='mb-2 font-medium text-[#B5A1D4] text-xl'>
                  Reporting a vulnerability
                </h3>
                <p className='mb-4'>
                  To report any security flaws, send an email to{' '}
                  <Link
                    href='mailto:security@simstudio.ai'
                    className='text-[#B5A1D4] hover:text-[#701ffc]'
                  >
                    security@simstudio.ai
                  </Link>
                  . The next business day, we'll acknowledge receipt of your vulnerability report
                  and keep you updated on our progress. Reports can be anonymously submitted.
                </p>

                <h3 className='mb-2 font-medium text-[#B5A1D4] text-xl'>Desirable information</h3>
                <p className='mb-4'>
                  In order to process and react to a vulnerability report, we recommend to include
                  the following information:
                </p>
                <ul className='mb-4 list-disc space-y-2 pl-6 marker:text-[#B5A1D4]'>
                  <li>Vulnerability description</li>
                  <li>Place of discovery</li>
                  <li>Potential Impact</li>
                  <li>
                    Steps required to reproduce a vulnerability (include scripts and screenshots if
                    possible)
                  </li>
                </ul>
                <p className='mb-4'>If possible, please provide your report in English.</p>

                <h3 className='mb-2 font-medium text-[#B5A1D4] text-xl'>Our commitment</h3>
                <p className='mb-4'>
                  If you choose to give your contact information, we promise to communicate with you
                  in a transparent and timely manner. We will acknowledge receipt of your report
                  within three business days. We will keep you informed on vulnerability
                  confirmation and remedy to the best of our capabilities. We welcome a discussion
                  of concerns and are willing to engage in a discourse.
                </p>
              </section>

              <section>
                <h2 className='mb-4 font-semibold text-2xl text-white'>18. Contact Us</h2>
                <p>
                  If you have any questions about this Privacy Policy, please contact us at:{' '}
                  <Link
                    href='mailto:privacy@simstudio.ai'
                    className='text-[#B5A1D4] hover:text-[#701ffc]'
                  >
                    privacy@simstudio.ai
                  </Link>
                </p>
              </section>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className='relative z-20'>
        <Footer onOpenTypeformLink={handleOpenTypeformLink} />
      </div>
    </main>
  )
}
