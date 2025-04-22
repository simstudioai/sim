'use client'

import Link from 'next/link'
import { GridPattern } from '../components/grid-pattern'
import NavWrapper from '../components/nav-wrapper'
import Footer from '../components/sections/footer'

export default function PrivacyPolicy() {
  return (
    <main className="bg-[#0C0C0C] min-h-screen text-white relative overflow-hidden">
      {/* Grid pattern background - only covers content area */}
      <div className="absolute inset-0 bottom-[400px] z-0 overflow-hidden">
        <GridPattern
          x={-5}
          y={-5}
          className="stroke-[#ababab]/5 absolute inset-0"
          width={90}
          height={90}
          aria-hidden="true"
        />
      </div>
      
      {/* Header/Navigation */}
      <NavWrapper />
      
      {/* SVG background blur centered behind content */}
      <div className="absolute left-1/2 top-0 bottom-0 -translate-x-1/2 w-[95%] md:w-[90%] lg:w-[80%] max-w-5xl z-[1] h-full" aria-hidden="true">
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 600 1600"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="xMidYMid slice"
          className="h-full w-full"
        >
          <g filter="url(#filter0_b_privacy)">
            <rect width="600" height="1600" rx="0" fill="#0C0C0C" />
          </g>
          <defs>
            <filter
              id="filter0_b_privacy"
              x="-20"
              y="-20"
              width="640"
              height="1640"
              filterUnits="userSpaceOnUse"
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur stdDeviation="7" />
            </filter>
          </defs>
        </svg>
      </div>

      {/* Content */}
      <div className="relative z-10">
        <div className="max-w-4xl mx-auto px-4 py-16 pt-36">
          <div className="relative px-4 sm:px-8 py-4">
            <h1 className="text-4xl font-bold mb-8 text-white">Privacy Policy</h1>

            <div className="space-y-8 text-white/80">
              <section>
                <p className="mb-4">Last Updated: April 20, 2025</p>
                <p>
                  This Privacy Policy describes how your personal information is collected, used, and
                  shared when you visit or use Sim Studio ("the Service", "we", "us", or "our").
                </p>
                <p className="mt-4">
                  By using the Service, you agree to the collection and use of information in
                  accordance with this policy. Unless otherwise defined in this Privacy Policy, terms
                  used in this Privacy Policy have the same meanings as in our Terms of Service.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold mb-4 text-white">
                  1. Information We Collect
                </h2>
                <h3 className="text-xl font-medium mb-2 text-[#B5A1D4]">Personal Information</h3>
                <p className="mb-4">
                  While using our Service, we may ask you to provide us with certain personally
                  identifiable information that can be used to contact or identify you (<span className="text-[#B5A1D4]">"Personal Information"</span>). Personally identifiable information may include, but is not limited
                  to:
                </p>
                <ul className="list-disc pl-6 space-y-2 mb-4 marker:text-[#B5A1D4]">
                  <li>Email address</li>
                  <li>First name and last name</li>
                  <li>Phone number</li>
                  <li>Address, State, Province, ZIP/Postal code, City</li>
                  <li>Cookies and Usage Data</li>
                </ul>

                <h3 className="text-xl font-medium mb-2 text-[#B5A1D4]">Usage Data</h3>
                <p className="mb-4">
                  We may also collect information on how the Service is accessed and used (<span className="text-[#B5A1D4]">"Usage
                  Data"</span>). This Usage Data may include information such as your computer's Internet
                  Protocol address (e.g. IP address), browser type, browser version, the pages of our
                  Service that you visit, the time and date of your visit, the time spent on those
                  pages, unique device identifiers and other diagnostic data.
                </p>

                <h3 className="text-xl font-medium mb-2 text-[#B5A1D4]">Tracking & Cookies Data</h3>
                <p className="mb-4">
                  We use cookies and similar tracking technologies to track the activity on our Service
                  and hold certain information.
                </p>
                <p className="mb-4">
                  Cookies are files with small amount of data which may include an anonymous unique
                  identifier. Cookies are sent to your browser from a website and stored on your
                  device. Tracking technologies also used are beacons, tags, and scripts to collect and
                  track information and to improve and analyze our Service.
                </p>
                <p>
                  You can instruct your browser to refuse all cookies or to indicate when a cookie is
                  being sent. However, if you do not accept cookies, you may not be able to use some
                  portions of our Service.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold mb-4 text-white">
                  2. How We Use Your Information
                </h2>
                <p className="mb-4">
                  We use the collected data for various purposes:
                </p>
                <ul className="list-disc pl-6 space-y-2 marker:text-[#B5A1D4]">
                  <li>To provide and maintain the Service</li>
                  <li>To notify you about changes to our Service</li>
                  <li>
                    To allow you to participate in interactive features of our Service when you choose
                    to do so
                  </li>
                  <li>To provide customer care and support</li>
                  <li>To provide analysis or valuable information so that we can improve the Service</li>
                  <li>To monitor the usage of the Service</li>
                  <li>To detect, prevent and address technical issues</li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-semibold mb-4 text-white">
                  3. Transfer Of Data
                </h2>
                <p className="mb-4">
                  Your information, including Personal Information, may be transferred to — and
                  maintained on — computers located outside of your state, province, country or other
                  governmental jurisdiction where the data protection laws may differ than those from
                  your jurisdiction.
                </p>
                <p className="mb-4">
                  If you are located outside United States and choose to provide information to us,
                  please note that we transfer the data, including Personal Information, to United
                  States and process it there.
                </p>
                <p>
                  Your consent to this Privacy Policy followed by your submission of such information
                  represents your agreement to that transfer.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold mb-4 text-white">
                  4. Disclosure Of Data
                </h2>
                <h3 className="text-xl font-medium mb-2 text-[#B5A1D4]">Legal Requirements</h3>
                <p className="mb-4">
                  Sim Studio may disclose your Personal Information in the good faith belief that such
                  action is necessary to:
                </p>
                <ul className="list-disc pl-6 space-y-2 marker:text-[#B5A1D4]">
                  <li>To comply with a legal obligation</li>
                  <li>To protect and defend the rights or property of Sim Studio</li>
                  <li>To prevent or investigate possible wrongdoing in connection with the Service</li>
                  <li>To protect the personal safety of users of the Service or the public</li>
                  <li>To protect against legal liability</li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-semibold mb-4 text-white">
                  5. Security Of Data
                </h2>
                <p className="mb-4">
                  The security of your data is important to us, but remember that no method of
                  transmission over the Internet, or method of electronic storage is 100% secure. While
                  we strive to use commercially acceptable means to protect your Personal Information,
                  we cannot guarantee its absolute security.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold mb-4 text-white">
                  6. Service Providers
                </h2>
                <p className="mb-4">
                  We may employ third party companies and individuals to facilitate our Service
                  (<span className="text-[#B5A1D4]">"Service Providers"</span>), to provide the Service on our behalf, to perform
                  Service-related services or to assist us in analyzing how our Service is used.
                </p>
                <p>
                  These third parties have access to your Personal Information only to perform these
                  tasks on our behalf and are obligated not to disclose or use it for any other
                  purpose.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold mb-4 text-white">
                  7. Analytics
                </h2>
                <p className="mb-4">
                  We may use third-party Service Providers to monitor and analyze the use of our
                  Service.
                </p>
                <h3 className="text-xl font-medium mb-2 text-[#B5A1D4]">Google Analytics</h3>
                <p className="mb-4">
                  Google Analytics is a web analytics service offered by Google that tracks and reports
                  website traffic. Google uses the data collected to track and monitor the use of our
                  Service. This data is shared with other Google services. Google may use the collected
                  data to contextualize and personalize the ads of its own advertising network.
                </p>
                <p className="mb-4">
                  You can opt-out of having made your activity on the Service available to Google
                  Analytics by installing the Google Analytics opt-out browser add-on. The add-on
                  prevents the Google Analytics JavaScript (ga.js, analytics.js, and dc.js) from
                  sharing information with Google Analytics about visits activity.
                </p>
                <p>
                  For more information on the privacy practices of Google, please visit the Google
                  Privacy & Terms web page:{' '}
                  <Link
                    href="https://policies.google.com/privacy?hl=en"
                    className="text-[#B5A1D4] hover:text-[#701ffc]"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    https://policies.google.com/privacy
                  </Link>
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold mb-4 text-white">
                  8. Google Workspace APIs
                </h2>
                <p className="mb-4">
                  We want to explicitly affirm that any user data obtained through Google Workspace APIs is <span className="text-[#B5A1D4]">not</span> used to develop, improve, or train generalized AI and/or machine learning models. We use data obtained through Google Workspace APIs solely for the purpose of providing and improving the specific functionality of our Service for which the API access was granted.
                </p>
                <p>
                  Any data collected through Google Workspace APIs is handled in accordance with Google API Services User Data Policy, including the Limited Use requirements.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold mb-4 text-white">
                  9. Links To Other Sites
                </h2>
                <p className="mb-4">
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
                <h2 className="text-2xl font-semibold mb-4 text-white">
                  10. Children's Privacy
                </h2>
                <p className="mb-4">
                  Our Service does not address anyone under the age of 18 (<span className="text-[#B5A1D4]">"Children"</span>).
                </p>
                <p className="mb-4">
                  We do not knowingly collect personally identifiable information from anyone under the
                  age of 18. If you are a parent or guardian and you are aware that your Children has
                  provided us with Personal Information, please contact us. If we become aware that we
                  have collected Personal Information from children without verification of parental
                  consent, we take steps to remove that information from our servers.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold mb-4 text-white">
                  11. Changes To This Privacy Policy
                </h2>
                <p className="mb-4">
                  We may update our Privacy Policy from time to time. We will notify you of any changes
                  by posting the new Privacy Policy on this page.
                </p>
                <p className="mb-4">
                  We will let you know via email and/or a prominent notice on our Service, prior to the
                  change becoming effective and update the "Last updated" date at the top of this
                  Privacy Policy.
                </p>
                <p>
                  You are advised to review this Privacy Policy periodically for any changes. Changes
                  to this Privacy Policy are effective when they are posted on this page.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold mb-4 text-white">
                  12. Your Data Protection Rights Under General Data Protection Regulation (GDPR)
                </h2>
                <p className="mb-4">
                  If you are a resident of the European Economic Area (EEA), you have certain data
                  protection rights. Sim Studio aims to take reasonable steps to allow you to correct,
                  amend, delete, or limit the use of your Personal Information.
                </p>
                <p className="mb-4">
                  If you wish to be informed what Personal Information we hold about you and if you
                  want it to be removed from our systems, please contact us.
                </p>
                <p className="mb-4">
                  In certain circumstances, you have the following data protection rights:
                </p>
                <ul className="list-disc pl-6 space-y-2 mb-4 marker:text-[#B5A1D4]">
                  <li>
                    The right to access, update or to delete the information we have on you.
                  </li>
                  <li>
                    The right of rectification. You have the right to have your information rectified
                    if that information is inaccurate or incomplete.
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
                    The right to data portability. You have the right to be provided with a copy of the
                    information we have on you in a structured, machine-readable and commonly used
                    format.
                  </li>
                  <li>
                    The right to withdraw consent. You also have the right to withdraw your consent at
                    any time where Sim Studio relied on your consent to process your personal
                    information.
                  </li>
                </ul>
                <p className="mb-4">
                  Please note that we may ask you to verify your identity before responding to such
                  requests.
                </p>
                <p className="mb-4 bg-[#701ffc]/10 p-3 border-l-4 border-[#701ffc]">
                  You have the right to complain to a Data Protection Authority about our collection
                  and use of your Personal Information. For more information, please contact your local
                  data protection authority in the European Economic Area (EEA).
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold mb-4 text-white">
                  13. California Privacy Rights
                </h2>
                <p className="mb-4">
                  California Civil Code Section 1798.83, also known as the <span className="text-[#B5A1D4]">"Shine The Light"</span> law,
                  permits our users who are California residents to request and obtain from us, once a
                  year and free of charge, information about categories of personal information (if
                  any) we disclosed to third parties for direct marketing purposes and the names and
                  addresses of all third parties with which we shared personal information in the
                  immediately preceding calendar year.
                </p>
                <p className="mb-4">
                  If you are a California resident and would like to make such a request, please submit
                  your request in writing to us using the contact information provided below.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold mb-4 text-white">14. Contact Us</h2>
                <p>
                  If you have any questions about this Privacy Policy, please contact us at:{' '}
                  <Link href="mailto:privacy@simstudio.ai" className="text-[#B5A1D4] hover:text-[#701ffc]">
                    privacy@simstudio.ai
                  </Link>
                </p>
              </section>
            </div>
          </div>
        </div>
      </div>
      
      {/* Footer */}
      <div className="relative z-20">
        <Footer />
      </div>
    </main>
  )
}
