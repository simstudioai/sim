'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ChartAreaIcon,
  GitFork,
  GitGraph,
  Github,
  GitPullRequest,
  LayoutGrid,
  MessageCircle,
  Star,
} from 'lucide-react'
import Image from 'next/image'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GridPattern } from '../components/grid-pattern'
import NavWrapper from '../components/nav-wrapper'
import Footer from '../components/sections/footer'
import { getCachedContributorsData, prefetchContributorsData } from '../utils/prefetch'

interface Contributor {
  login: string
  avatar_url: string
  contributions: number
  html_url: string
}

interface RepoStats {
  stars: number
  forks: number
  watchers: number
  openIssues: number
  openPRs: number
}

interface CommitTimelineData {
  date: string
  commits: number
  additions: number
  deletions: number
}

interface ActivityData {
  date: string
  commits: number
  issues: number
  pullRequests: number
}

const excludedUsernames = ['dependabot[bot]', 'github-actions']

const ChartControls = ({
  showAll,
  setShowAll,
  total,
}: {
  showAll: boolean
  setShowAll: (show: boolean) => void
  total: number
}) => (
  <div className='mb-4 flex items-center justify-between'>
    <span className='text-neutral-400 text-sm'>
      Showing {showAll ? 'all' : 'top 10'} contributors
    </span>
    <Button
      variant='outline'
      size='sm'
      onClick={() => setShowAll(!showAll)}
      className='border-[#606060]/30 bg-[#0f0f0f] text-neutral-300 text-xs backdrop-blur-sm hover:bg-neutral-700/50 hover:text-white'
    >
      Show {showAll ? 'less' : 'all'} ({total})
    </Button>
  </div>
)

export default function ContributorsPage() {
  const [repoStats, setRepoStats] = useState<RepoStats>({
    stars: 0,
    forks: 0,
    watchers: 0,
    openIssues: 0,
    openPRs: 0,
  })
  const [timelineData, setTimelineData] = useState<CommitTimelineData[]>([])
  const [activityData, setActivityData] = useState<ActivityData[]>([])
  const [showAllContributors, setShowAllContributors] = useState(false)
  const [allContributors, setAllContributors] = useState<Contributor[]>([])

  const handleOpenTypeformLink = () => {
    window.open('https://form.typeform.com/to/jqCO12pF', '_blank')
  }

  useEffect(() => {
    const loadData = async () => {
      // First, try to get cached data
      const cachedData = getCachedContributorsData()

      if (cachedData) {
        // Use cached data immediately
        setAllContributors(cachedData.contributors)
        setRepoStats(cachedData.repoStats)
        setTimelineData(cachedData.timelineData)
        setActivityData(cachedData.activityData)
      } else {
        // If no cached data, fetch it
        try {
          const data = await prefetchContributorsData()
          setAllContributors(data.contributors)
          setRepoStats(data.repoStats)
          setTimelineData(data.timelineData)
          setActivityData(data.activityData)
        } catch (err) {
          console.error('Error fetching data:', err)
          // Set default values if fetch fails
          setAllContributors([])
          setRepoStats({
            stars: 3867,
            forks: 581,
            watchers: 26,
            openIssues: 23,
            openPRs: 3,
          })
          setTimelineData([])
          setActivityData([])
        }
      }
    }

    loadData()
  }, [])

  const filteredContributors = useMemo(
    () =>
      allContributors
        ?.filter((contributor) => !excludedUsernames.includes(contributor.login))
        .sort((a, b) => b.contributions - a.contributions),
    [allContributors]
  )

  return (
    <main className='relative min-h-screen bg-[#0C0C0C] font-geist-sans text-white'>
      {/* Grid pattern background */}
      <div className='absolute inset-0 bottom-[400px] z-0'>
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

      {/* Content */}
      <div className='relative z-10'>
        {/* Hero Section with Integrated Stats */}
        <section className='px-4 pt-20 pb-12 sm:px-8 sm:pt-28 sm:pb-16 md:px-16 md:pt-40 md:pb-24 lg:px-28 xl:px-32'>
          <div className='mx-auto max-w-6xl'>
            {/* Main Hero Content */}
            <div className='mb-12 text-center sm:mb-16'>
              <motion.h1
                className='font-medium text-4xl text-white tracking-tight sm:text-5xl'
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, ease: 'easeOut' }}
              >
                Contributors
              </motion.h1>
              <motion.p
                className='mx-auto mt-3 max-w-2xl font-light text-lg text-neutral-400 sm:mt-4 sm:text-xl'
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                Meet the amazing people who have helped build and improve Sim Studio
              </motion.p>
            </div>

            {/* Integrated Project Stats */}
            <motion.div
              className='overflow-hidden rounded-2xl border border-[#606060]/30 bg-[#0f0f0f] p-4 backdrop-blur-sm sm:rounded-3xl sm:p-8'
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.1 }}
            >
              {/* Project Header */}
              <div className='mb-6 flex flex-col items-start justify-between gap-3 sm:mb-8 sm:flex-row sm:items-center sm:gap-4'>
                <div className='space-y-1'>
                  <div className='flex items-center gap-2'>
                    <div className='relative h-6 w-6 sm:h-8 sm:w-8'>
                      <Image
                        src='/favicon.ico'
                        alt='Sim Studio Logo'
                        className='object-contain'
                        width={32}
                        height={32}
                      />
                    </div>
                    <h2 className='font-semibold text-lg text-white sm:text-xl'>Sim Studio</h2>
                  </div>
                  <p className='text-neutral-400 text-xs sm:text-sm'>
                    An open source platform for building, testing, and optimizing agentic workflows
                  </p>
                </div>
                <div className='flex gap-2 self-end sm:self-auto'>
                  <Button
                    asChild
                    variant='outline'
                    size='sm'
                    className='gap-1 border-[#606060]/30 bg-[#0f0f0f] text-neutral-300 text-xs backdrop-blur-sm hover:bg-neutral-700/50 hover:text-white sm:gap-2 sm:text-sm'
                  >
                    <a href='https://github.com/simstudioai/sim' target='_blank' rel='noopener'>
                      <Github className='h-3 w-3 sm:h-4 sm:w-4' />
                      <span className='hidden sm:inline'>View on GitHub</span>
                      <span className='sm:hidden'>GitHub</span>
                    </a>
                  </Button>
                </div>
              </div>

              {/* Stats Grid - Mobile: 1 column, Tablet: 2 columns, Desktop: 5 columns */}
              <div className='mb-6 grid grid-cols-1 gap-3 sm:mb-8 sm:grid-cols-2 sm:gap-4 lg:grid-cols-5'>
                <div className='rounded-lg border border-[#606060]/20 bg-neutral-800/30 p-3 text-center sm:rounded-xl sm:p-4'>
                  <div className='mb-1 flex items-center justify-center sm:mb-2'>
                    <Star className='h-4 w-4 text-[#701ffc] sm:h-5 sm:w-5' />
                  </div>
                  <div className='font-bold text-lg text-white sm:text-xl'>{repoStats.stars}</div>
                  <div className='text-neutral-400 text-xs'>Stars</div>
                </div>

                <div className='rounded-lg border border-[#606060]/20 bg-neutral-800/30 p-3 text-center sm:rounded-xl sm:p-4'>
                  <div className='mb-1 flex items-center justify-center sm:mb-2'>
                    <GitFork className='h-4 w-4 text-[#701ffc] sm:h-5 sm:w-5' />
                  </div>
                  <div className='font-bold text-lg text-white sm:text-xl'>{repoStats.forks}</div>
                  <div className='text-neutral-400 text-xs'>Forks</div>
                </div>

                <div className='rounded-lg border border-[#606060]/20 bg-neutral-800/30 p-3 text-center sm:rounded-xl sm:p-4'>
                  <div className='mb-1 flex items-center justify-center sm:mb-2'>
                    <GitGraph className='h-4 w-4 text-[#701ffc] sm:h-5 sm:w-5' />
                  </div>
                  <div className='font-bold text-lg text-white sm:text-xl'>
                    {filteredContributors?.length || 0}
                  </div>
                  <div className='text-neutral-400 text-xs'>Contributors</div>
                </div>

                <div className='rounded-lg border border-[#606060]/20 bg-neutral-800/30 p-3 text-center sm:rounded-xl sm:p-4'>
                  <div className='mb-1 flex items-center justify-center sm:mb-2'>
                    <MessageCircle className='h-4 w-4 text-[#701ffc] sm:h-5 sm:w-5' />
                  </div>
                  <div className='font-bold text-lg text-white sm:text-xl'>
                    {repoStats.openIssues}
                  </div>
                  <div className='text-neutral-400 text-xs'>Open Issues</div>
                </div>

                <div className='rounded-lg border border-[#606060]/20 bg-neutral-800/30 p-3 text-center sm:rounded-xl sm:p-4'>
                  <div className='mb-1 flex items-center justify-center sm:mb-2'>
                    <GitPullRequest className='h-4 w-4 text-[#701ffc] sm:h-5 sm:w-5' />
                  </div>
                  <div className='font-bold text-lg text-white sm:text-xl'>{repoStats.openPRs}</div>
                  <div className='text-neutral-400 text-xs'>Pull Requests</div>
                </div>
              </div>

              {/* Activity Chart - Mobile responsive */}
              <div className='rounded-xl border border-[#606060]/30 bg-[#0f0f0f] p-4 sm:rounded-2xl sm:p-6'>
                <h3 className='mb-3 font-medium text-base text-white sm:mb-4 sm:text-lg'>
                  Commit Activity
                </h3>
                <ResponsiveContainer width='100%' height={150} className='sm:!h-[200px]'>
                  <AreaChart data={timelineData} className='-mx-2 sm:-mx-5 mt-1 sm:mt-2'>
                    <defs>
                      <linearGradient id='commits' x1='0' y1='0' x2='0' y2='1'>
                        <stop offset='5%' stopColor='#701ffc' stopOpacity={0.3} />
                        <stop offset='95%' stopColor='#701ffc' stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey='date'
                      stroke='currentColor'
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      className='text-neutral-400 sm:text-xs'
                      interval={4}
                    />
                    <YAxis
                      stroke='currentColor'
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `${value}`}
                      className='text-neutral-400 sm:text-xs'
                      width={30}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          return (
                            <div className='rounded-lg border border-[#606060]/30 bg-[#0f0f0f] p-2 shadow-lg backdrop-blur-sm sm:p-3'>
                              <div className='grid gap-1 sm:gap-2'>
                                <div className='flex items-center gap-1 sm:gap-2'>
                                  <GitGraph className='h-3 w-3 text-[#701ffc] sm:h-4 sm:w-4' />
                                  <span className='text-neutral-400 text-xs sm:text-sm'>
                                    Commits:
                                  </span>
                                  <span className='font-medium text-white text-xs sm:text-sm'>
                                    {payload[0]?.value}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )
                        }
                        return null
                      }}
                    />
                    <Area
                      type='monotone'
                      dataKey='commits'
                      stroke='#701ffc'
                      strokeWidth={2}
                      fill='url(#commits)'
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Contributors Display */}
        <section className='px-4 py-12 sm:px-8 sm:py-16 md:px-16 lg:px-28 xl:px-32'>
          <div className='mx-auto max-w-6xl'>
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.2 }}
            >
              <Tabs defaultValue='grid' className='w-full'>
                <div className='mb-6 flex justify-center sm:mb-8'>
                  <TabsList className='grid h-full w-full max-w-[300px] grid-cols-2 border border-[#606060]/30 bg-[#0f0f0f] p-1 backdrop-blur-sm sm:w-[200px]'>
                    <TabsTrigger
                      value='grid'
                      className='flex items-center gap-1 text-neutral-400 text-xs data-[state=active]:bg-neutral-700/50 data-[state=active]:text-white data-[state=active]:shadow-sm sm:gap-2 sm:text-sm'
                    >
                      <LayoutGrid className='h-3 w-3 sm:h-4 sm:w-4' />
                      Grid
                    </TabsTrigger>
                    <TabsTrigger
                      value='chart'
                      className='flex items-center gap-1 text-neutral-400 text-xs data-[state=active]:bg-neutral-700/50 data-[state=active]:text-white data-[state=active]:shadow-sm sm:gap-2 sm:text-sm'
                    >
                      <ChartAreaIcon className='h-3 w-3 sm:h-4 sm:w-4' />
                      Chart
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value='grid'>
                  {/* Mobile: 2 columns, Small: 3 columns, Large: 4 columns, XL: 6 columns */}
                  <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-6'>
                    {filteredContributors?.map((contributor, index) => (
                      <motion.a
                        key={contributor.login}
                        href={contributor.html_url}
                        target='_blank'
                        className='group relative flex flex-col items-center rounded-lg border border-[#606060]/30 bg-[#0f0f0f] p-3 backdrop-blur-sm transition-all hover:bg-neutral-700/50 sm:rounded-xl sm:p-4'
                        whileHover={{ scale: 1.02, y: -2 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        style={{ animationDelay: `${index * 50}ms` }}
                      >
                        <Avatar className='h-12 w-12 ring-2 ring-[#606060]/30 transition-transform group-hover:scale-105 group-hover:ring-[#701ffc]/60 sm:h-16 sm:w-16'>
                          <AvatarImage
                            src={contributor.avatar_url}
                            alt={contributor.login}
                            className='object-cover'
                          />
                          <AvatarFallback className='bg-[#0f0f0f] text-[10px] sm:text-xs'>
                            {contributor.login.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>

                        <div className='mt-2 text-center sm:mt-3'>
                          <span className='block font-medium text-white text-xs transition-colors group-hover:text-[#701ffc] sm:text-sm'>
                            {contributor.login.length > 12
                              ? `${contributor.login.slice(0, 12)}...`
                              : contributor.login}
                          </span>
                          <div className='mt-1 flex items-center justify-center gap-1 sm:mt-2'>
                            <GitGraph className='h-2 w-2 text-neutral-400 transition-colors group-hover:text-[#701ffc] sm:h-3 sm:w-3' />
                            <span className='font-medium text-neutral-300 text-xs transition-colors group-hover:text-white sm:text-sm'>
                              {contributor.contributions}
                            </span>
                          </div>
                        </div>
                      </motion.a>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value='chart'>
                  <div className='rounded-2xl border border-[#606060]/30 bg-[#0f0f0f] p-4 backdrop-blur-sm sm:rounded-3xl sm:p-6'>
                    <ChartControls
                      showAll={showAllContributors}
                      setShowAll={setShowAllContributors}
                      total={filteredContributors?.length || 0}
                    />

                    <ResponsiveContainer width='100%' height={300} className='sm:!h-[400px]'>
                      <BarChart
                        data={filteredContributors?.slice(0, showAllContributors ? undefined : 10)}
                        margin={{ top: 10, right: 10, bottom: 60, left: 10 }}
                        className='sm:!mx-2.5 sm:!mb-2.5'
                      >
                        <XAxis
                          dataKey='login'
                          interval={0}
                          tick={(props) => {
                            const { x, y, payload } = props
                            const contributor = allContributors?.find(
                              (c) => c.login === payload.value
                            )

                            return (
                              <g transform={`translate(${x},${y})`}>
                                <foreignObject
                                  x='-16'
                                  y='8'
                                  width='32'
                                  height='32'
                                  style={{ overflow: 'visible' }}
                                >
                                  <Avatar className='h-6 w-6 ring-1 ring-[#606060]/30 sm:h-8 sm:w-8'>
                                    <AvatarImage src={contributor?.avatar_url} />
                                    <AvatarFallback className='bg-[#0f0f0f] text-[6px] sm:text-[8px]'>
                                      {payload.value.slice(0, 2).toUpperCase()}
                                    </AvatarFallback>
                                  </Avatar>
                                </foreignObject>
                              </g>
                            )
                          }}
                          height={60}
                          className='text-neutral-400'
                        />
                        <YAxis
                          stroke='currentColor'
                          fontSize={10}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(value) => `${value}`}
                          className='text-neutral-400 sm:text-xs'
                          width={25}
                        />
                        <Tooltip
                          cursor={{ fill: 'rgb(255 255 255 / 0.05)' }}
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0]?.payload
                              return (
                                <div className='rounded-lg border border-[#606060]/30 bg-[#0f0f0f] p-2 shadow-lg backdrop-blur-sm sm:p-3'>
                                  <div className='flex items-center gap-2'>
                                    <Avatar className='h-6 w-6 ring-1 ring-[#606060]/30 sm:h-8 sm:w-8'>
                                      <AvatarImage src={data.avatar_url} />
                                      <AvatarFallback className='bg-[#0f0f0f] text-[8px] sm:text-xs'>
                                        {data.login.slice(0, 2).toUpperCase()}
                                      </AvatarFallback>
                                    </Avatar>
                                    <div>
                                      <div className='font-medium text-white text-xs sm:text-sm'>
                                        {data.login}
                                      </div>
                                      <div className='flex items-center gap-1 text-[10px] text-neutral-400 sm:text-xs'>
                                        <GitGraph className='h-2 w-2 sm:h-3 sm:w-3' />
                                        <span>{data.contributions} commits</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )
                            }
                            return null
                          }}
                        />
                        <Bar
                          dataKey='contributions'
                          className='fill-[#701ffc]'
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </TabsContent>
              </Tabs>
            </motion.div>
          </div>
        </section>

        {/* Call to Action */}
        <section className='px-4 py-8 sm:px-8 sm:py-10 md:px-16 md:py-16 lg:px-28 xl:px-32'>
          <div className='mx-auto max-w-6xl'>
            <motion.div
              className='relative overflow-hidden rounded-2xl border border-[#606060]/30 bg-[#0f0f0f] sm:rounded-3xl'
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.3 }}
            >
              <div className='relative p-6 sm:p-8 md:p-12 lg:p-16'>
                <div className='text-center'>
                  <div className='mb-4 inline-flex items-center rounded-full border border-[#701ffc]/20 bg-[#701ffc]/10 px-3 py-1 font-medium text-[#701ffc] text-xs sm:mb-6 sm:px-4 sm:py-2 sm:text-sm'>
                    <Github className='mr-1 h-3 w-3 sm:mr-2 sm:h-4 sm:w-4' />
                    Apache-2.0 Licensed
                  </div>

                  <h3 className='font-medium text-2xl text-white leading-[1.1] tracking-tight sm:text-[42px] md:text-5xl'>
                    Want to contribute?
                  </h3>

                  <p className='mx-auto mt-3 max-w-2xl font-light text-base text-neutral-400 sm:mt-4 sm:text-xl'>
                    Whether you&apos;re fixing bugs, adding features, or improving documentation,
                    every contribution helps build the future of AI workflows.
                  </p>

                  <div className='mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-4'>
                    <Button
                      asChild
                      size='lg'
                      className='bg-[#701ffc] text-white transition-colors duration-500 hover:bg-[#802FFF]'
                    >
                      <a
                        href='https://github.com/simstudioai/sim/blob/main/.github/CONTRIBUTING.md'
                        target='_blank'
                        rel='noopener'
                      >
                        <GitGraph className='mr-2 h-4 w-4 sm:h-5 sm:w-5' />
                        Start Contributing
                      </a>
                    </Button>

                    <Button
                      asChild
                      variant='outline'
                      size='lg'
                      className='border-[#606060]/30 bg-transparent text-neutral-300 transition-colors duration-500 hover:bg-neutral-700/50 hover:text-white'
                    >
                      <a href='https://github.com/simstudioai/sim' target='_blank' rel='noopener'>
                        <Github className='mr-2 h-4 w-4 sm:h-5 sm:w-5' />
                        View Repository
                      </a>
                    </Button>

                    <Button
                      asChild
                      variant='outline'
                      size='lg'
                      className='border-[#606060]/30 bg-transparent text-neutral-300 transition-colors duration-500 hover:bg-neutral-700/50 hover:text-white'
                    >
                      <a
                        href='https://github.com/simstudioai/sim/issues'
                        target='_blank'
                        rel='noopener'
                      >
                        <MessageCircle className='mr-2 h-4 w-4 sm:h-5 sm:w-5' />
                        Open Issues
                      </a>
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>
      </div>

      {/* Footer */}
      <Footer />
    </main>
  )
}
