import { soehne } from '@/app/fonts/soehne/soehne'

/**
 * Blog post component comparing n8n and Sim for building AI agent workflows
 * Layout inspired by Anthropic's engineering blog posts
 */
export default function OpenAiN8nSim() {
  return (
    <article className={`${soehne.className} w-full`}>
      {/* Header Section with Image and Title */}
      <div className='mx-auto max-w-[1450px] px-6 pt-8 sm:px-8 sm:pt-12 md:px-12 md:pt-16'>
        <div className='flex flex-col gap-8 md:flex-row md:gap-12'>
          {/* Large Image on Left */}
          <div className='h-[180px] w-full flex-shrink-0 sm:h-[200px] md:h-auto md:w-[300px]'>
            <div className='relative h-full w-full overflow-hidden rounded-lg bg-gradient-to-br from-purple-100 to-blue-100 md:aspect-[5/4]'>
              {/* Placeholder for actual image */}
              <div className='flex h-full w-full items-center justify-center'>
                <svg
                  className='h-24 w-24 text-purple-400'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                  aria-hidden='true'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={1.5}
                    d='M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
                  />
                </svg>
              </div>
            </div>
          </div>

          {/* Main Title - Taking up 80% */}
          <div className='flex-1'>
            <h1 className='font-medium text-[36px] leading-tight tracking-tight sm:text-[48px] md:text-[56px] lg:text-[64px]'>
              Workflows on OpenAI vs n8n vs Sim
            </h1>
          </div>
        </div>

        {/* Horizontal Line Separator */}
        <hr className='mt-8 border-gray-200 border-t sm:mt-12' />

        {/* Publish Date and Subtitle */}
        <div className='flex flex-col gap-6 py-8 sm:flex-row sm:items-start sm:justify-between sm:gap-8 sm:py-10'>
          {/* Publish Date on Left */}
          <div className='flex-shrink-0'>
            <time
              className='block text-[14px] text-gray-600 leading-[1.5] sm:text-[16px]'
              dateTime='2025-10-06'
            >
              Published Oct 6, 2025
            </time>
          </div>

          {/* Subtitle on Right */}
          <div className='flex-1'>
            <p className='m-0 block translate-y-[-4px] font-medium text-[18px] text-gray-700 leading-[1.5] sm:text-[20px] md:text-[26px]'>
              Understanding the key differences between workflow automation platforms and
              purpose-built AI agent development tools.
            </p>
          </div>
        </div>
      </div>

      {/* Main Content Area - Medium-style centered with padding */}
      <div className='mx-auto max-w-[800px] px-6 pb-20 sm:px-8 md:px-12'>
        <div className='prose prose-lg max-w-none'>
          {/* Introduction */}
          <section className='mb-12'>
            <p className='text-[19px] text-gray-800 leading-relaxed'>
              When building AI agent workflows, developers often evaluate multiple platforms to find
              the right fit for their needs. Two popular options that frequently come up in these
              discussions are n8n and Sim. While both platforms enable workflow automation, they
              take fundamentally different approaches to solving the problem.
            </p>
          </section>

          {/* Section 1 */}
          <section className='mb-12'>
            <h2 className='mb-4 font-medium text-[28px] leading-tight sm:text-[32px]'>
              What is n8n?
            </h2>
            <p className='mb-4 text-[19px] text-gray-800 leading-relaxed'>
              n8n is a general-purpose workflow automation tool that allows you to connect various
              services and APIs together. It provides a visual workflow builder with a wide range of
              pre-built integrations for popular services.
            </p>
            <p className='text-[19px] text-gray-800 leading-relaxed'>
              Content placeholder - detailed comparison to be added...
            </p>
          </section>

          {/* Section 2 */}
          <section className='mb-12'>
            <h2 className='mb-4 font-medium text-[28px] leading-tight sm:text-[32px]'>
              What is Sim?
            </h2>
            <p className='mb-4 text-[19px] text-gray-800 leading-relaxed'>
              Sim is a purpose-built platform for developing and deploying AI agent workflows. It's
              designed specifically for LLM-powered applications, providing native support for agent
              patterns, tool calling, and complex reasoning flows.
            </p>
            <p className='text-[19px] text-gray-800 leading-relaxed'>
              Content placeholder - detailed comparison to be added...
            </p>
          </section>

          {/* Section 3 */}
          <section className='mb-12'>
            <h2 className='mb-4 font-medium text-[28px] leading-tight sm:text-[32px]'>
              Key Differences
            </h2>
            <p className='text-[19px] text-gray-800 leading-relaxed'>
              Content placeholder - key differences to be added...
            </p>
          </section>

          {/* Conclusion */}
          <section className='mb-12'>
            <h2 className='mb-4 font-medium text-[28px] leading-tight sm:text-[32px]'>
              Which Should You Choose?
            </h2>
            <p className='text-[19px] text-gray-800 leading-relaxed'>
              Content placeholder - recommendations to be added...
            </p>
          </section>
        </div>
      </div>
    </article>
  )
}
