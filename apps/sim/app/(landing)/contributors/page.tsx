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

const excludedUsernames = ['bot1', 'dependabot[bot]', 'github-actions']

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
        <section className='px-8 pt-28 pb-16 sm:pt-32 sm:pb-20 md:px-16 md:pt-40 md:pb-24 lg:px-28 xl:px-32'>
          <div className='mx-auto max-w-6xl'>
            {/* Main Hero Content */}
            <div className='mb-16 text-center'>
              <motion.h1
                className='font-medium text-5xl text-white tracking-tight'
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, ease: 'easeOut' }}
              >
                Contributors
              </motion.h1>
              <motion.p
                className='mx-auto mt-4 max-w-2xl font-light text-neutral-400 text-xl'
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                Meet the amazing people who have helped build and improve Sim Studio
              </motion.p>
            </div>

            {/* Integrated Project Stats */}
            <motion.div
              className='overflow-hidden rounded-3xl border border-[#606060]/30 bg-[#0f0f0f] p-8 backdrop-blur-sm'
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.1 }}
            >
              {/* Project Header */}
              <div className='mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center'>
                <div className='space-y-1'>
                  <div className='flex items-center gap-2'>
                    <div className='relative h-8 w-8'>
                      <img src='/favicon.ico' alt='Sim Studio Logo' className='object-contain' />
                    </div>
                    <h2 className='font-semibold text-white text-xl'>Sim Studio</h2>
                  </div>
                  <p className='text-neutral-400 text-sm'>
                    An open source platform for building, testing, and optimizing agentic workflows
                  </p>
                </div>
                <div className='flex gap-2'>
                  <Button
                    asChild
                    variant='outline'
                    size='sm'
                    className='gap-2 border-[#606060]/30 bg-[#0f0f0f] text-neutral-300 backdrop-blur-sm hover:bg-neutral-700/50 hover:text-white'
                  >
                    <a href='https://github.com/simstudioai/sim' target='_blank' rel='noopener'>
                      <Github className='h-4 w-4' />
                      View on GitHub
                    </a>
                  </Button>
                </div>
              </div>

              {/* Stats Grid */}
              <div className='mb-8 grid grid-cols-2 gap-4 md:grid-cols-5'>
                <div className='rounded-xl border border-[#606060]/20 bg-neutral-800/30 p-4 text-center'>
                  <div className='mb-2 flex items-center justify-center'>
                    <Star className='h-5 w-5 text-[#701ffc]' />
                  </div>
                  <div className='font-bold text-white text-xl'>{repoStats.stars}</div>
                  <div className='text-neutral-400 text-xs'>Stars</div>
                </div>

                <div className='rounded-xl border border-[#606060]/20 bg-neutral-800/30 p-4 text-center'>
                  <div className='mb-2 flex items-center justify-center'>
                    <GitFork className='h-5 w-5 text-[#701ffc]' />
                  </div>
                  <div className='font-bold text-white text-xl'>{repoStats.forks}</div>
                  <div className='text-neutral-400 text-xs'>Forks</div>
                </div>

                <div className='rounded-xl border border-[#606060]/20 bg-neutral-800/30 p-4 text-center'>
                  <div className='mb-2 flex items-center justify-center'>
                    <GitGraph className='h-5 w-5 text-[#701ffc]' />
                  </div>
                  <div className='font-bold text-white text-xl'>
                    {filteredContributors?.length || 0}
                  </div>
                  <div className='text-neutral-400 text-xs'>Contributors</div>
                </div>

                <div className='rounded-xl border border-[#606060]/20 bg-neutral-800/30 p-4 text-center'>
                  <div className='mb-2 flex items-center justify-center'>
                    <MessageCircle className='h-5 w-5 text-[#701ffc]' />
                  </div>
                  <div className='font-bold text-white text-xl'>{repoStats.openIssues}</div>
                  <div className='text-neutral-400 text-xs'>Open Issues</div>
                </div>

                <div className='rounded-xl border border-[#606060]/20 bg-neutral-800/30 p-4 text-center'>
                  <div className='mb-2 flex items-center justify-center'>
                    <GitPullRequest className='h-5 w-5 text-[#701ffc]' />
                  </div>
                  <div className='font-bold text-white text-xl'>{repoStats.openPRs}</div>
                  <div className='text-neutral-400 text-xs'>Pull Requests</div>
                </div>
              </div>

              {/* Activity Chart - Simplified */}
              <div className='rounded-2xl border border-[#606060]/30 bg-[#0f0f0f] p-6'>
                <h3 className='mb-4 font-medium text-lg text-white'>Commit Activity</h3>
                <ResponsiveContainer width='100%' height={200}>
                  <AreaChart data={timelineData} className='-mx-5 mt-2'>
                    <defs>
                      <linearGradient id='commits' x1='0' y1='0' x2='0' y2='1'>
                        <stop offset='5%' stopColor='#701ffc' stopOpacity={0.3} />
                        <stop offset='95%' stopColor='#701ffc' stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey='date'
                      stroke='currentColor'
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      className='text-neutral-400'
                    />
                    <YAxis
                      stroke='currentColor'
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `${value}`}
                      className='text-neutral-400'
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          return (
                            <div className='rounded-lg border border-[#606060]/30 bg-[#0f0f0f] p-3 shadow-lg backdrop-blur-sm'>
                              <div className='grid gap-2'>
                                <div className='flex items-center gap-2'>
                                  <GitGraph className='h-4 w-4 text-[#701ffc]' />
                                  <span className='text-neutral-400 text-sm'>Commits:</span>
                                  <span className='font-medium text-white'>
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
        <section className='px-8 py-16 md:px-16 lg:px-28 xl:px-32'>
          <div className='mx-auto max-w-6xl'>
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.2 }}
            >
              <Tabs defaultValue='grid' className='w-full'>
                <div className='mb-8 flex justify-center'>
                  <TabsList className='grid h-full w-full grid-cols-2 border border-[#606060]/30 bg-[#0f0f0f] p-1 backdrop-blur-sm sm:w-[200px]'>
                    <TabsTrigger
                      value='grid'
                      className='flex items-center gap-2 text-neutral-400 data-[state=active]:bg-neutral-700/50 data-[state=active]:text-white data-[state=active]:shadow-sm'
                    >
                      <LayoutGrid className='h-4 w-4' />
                      Grid
                    </TabsTrigger>
                    <TabsTrigger
                      value='chart'
                      className='flex items-center gap-2 text-neutral-400 data-[state=active]:bg-neutral-700/50 data-[state=active]:text-white data-[state=active]:shadow-sm'
                    >
                      <ChartAreaIcon className='h-4 w-4' />
                      Chart
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value='grid'>
                  <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6'>
                    {filteredContributors?.map((contributor, index) => (
                      <motion.a
                        key={contributor.login}
                        href={contributor.html_url}
                        target='_blank'
                        className='group relative flex flex-col items-center rounded-xl border border-[#606060]/30 bg-[#0f0f0f] p-4 backdrop-blur-sm transition-all hover:bg-neutral-700/50'
                        whileHover={{ scale: 1.02, y: -2 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        style={{ animationDelay: `${index * 50}ms` }}
                      >
                        <Avatar className='h-16 w-16 ring-2 ring-[#606060]/30 transition-transform group-hover:scale-105 group-hover:ring-[#701ffc]/60'>
                          <AvatarImage
                            src={contributor.avatar_url}
                            alt={contributor.login}
                            className='object-cover'
                          />
                          <AvatarFallback className='bg-[#0f0f0f] text-xs'>
                            {contributor.login.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>

                        <div className='mt-3 text-center'>
                          <span className='block font-medium text-sm text-white transition-colors group-hover:text-[#701ffc]'>
                            {contributor.login}
                          </span>
                          <div className='mt-2 flex items-center justify-center gap-1'>
                            <GitGraph className='h-3 w-3 text-neutral-400 transition-colors group-hover:text-[#701ffc]' />
                            <span className='font-medium text-neutral-300 text-sm transition-colors group-hover:text-white'>
                              {contributor.contributions}
                            </span>
                          </div>
                        </div>
                      </motion.a>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value='chart'>
                  <div className='rounded-3xl border border-[#606060]/30 bg-[#0f0f0f] p-6 backdrop-blur-sm'>
                    <ChartControls
                      showAll={showAllContributors}
                      setShowAll={setShowAllContributors}
                      total={filteredContributors?.length || 0}
                    />

                    <ResponsiveContainer width='100%' height={400}>
                      <BarChart
                        data={filteredContributors?.slice(0, showAllContributors ? undefined : 10)}
                        margin={{ top: 10, right: 10, bottom: 60, left: 10 }}
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
                                <foreignObject x='-16' y='8' width='32' height='32'>
                                  <Avatar className='h-8 w-8 ring-1 ring-[#606060]/30'>
                                    <AvatarImage src={contributor?.avatar_url} />
                                    <AvatarFallback className='bg-[#0f0f0f] text-[8px]'>
                                      {payload.value.slice(0, 2).toUpperCase()}
                                    </AvatarFallback>
                                  </Avatar>
                                </foreignObject>
                                <text
                                  x='0'
                                  y='50'
                                  textAnchor='middle'
                                  className='fill-neutral-400 text-xs'
                                >
                                  {payload.value.length > 8
                                    ? `${payload.value.slice(0, 8)}...`
                                    : payload.value}
                                </text>
                              </g>
                            )
                          }}
                          height={80}
                          className='text-neutral-400'
                        />
                        <YAxis
                          stroke='currentColor'
                          fontSize={12}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(value) => `${value}`}
                          className='text-neutral-400'
                        />
                        <Tooltip
                          cursor={{ fill: 'rgb(255 255 255 / 0.05)' }}
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0]?.payload
                              return (
                                <div className='rounded-lg border border-[#606060]/30 bg-[#0f0f0f] p-3 shadow-lg backdrop-blur-sm'>
                                  <div className='flex items-center gap-2'>
                                    <Avatar className='h-8 w-8 ring-1 ring-[#606060]/30'>
                                      <AvatarImage src={data.avatar_url} />
                                      <AvatarFallback className='bg-[#0f0f0f]'>
                                        {data.login.slice(0, 2).toUpperCase()}
                                      </AvatarFallback>
                                    </Avatar>
                                    <div>
                                      <div className='font-medium text-sm text-white'>
                                        {data.login}
                                      </div>
                                      <div className='flex items-center gap-1 text-neutral-400 text-xs'>
                                        <GitGraph className='h-3 w-3' />
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
                          radius={[6, 6, 0, 0]}
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
        <section className='px-8 py-10 sm:py-12 md:px-16 md:py-16 lg:px-28 xl:px-32'>
          <div className='mx-auto max-w-6xl'>
            <motion.div
              className='relative overflow-hidden rounded-3xl border border-[#606060]/30 bg-[#0f0f0f]'
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.7, delay: 0.3 }}
            >
              <div className='relative p-8 sm:p-12 md:p-16'>
                <div className='text-center'>
                  <div className='mb-6 inline-flex items-center rounded-full border border-[#701ffc]/20 bg-[#701ffc]/10 px-4 py-2 font-medium text-[#701ffc] text-sm'>
                    <Github className='mr-2 h-4 w-4' />
                    Apache-2.0 Licensed
                  </div>

                  <h3 className='font-medium text-[42px] text-white leading-[1.1] tracking-tight md:text-5xl'>
                    Want to contribute?
                  </h3>

                  <p className='mx-auto mt-4 max-w-2xl font-light text-neutral-400 text-xl'>
                    Whether you&apos;re fixing bugs, adding features, or improving documentation,
                    every contribution helps build the future of AI workflows.
                  </p>

                  <div className='mt-8 flex flex-wrap justify-center gap-4'>
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
                        <GitGraph className='mr-2 h-5 w-5' />
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
                        <Github className='mr-2 h-5 w-5' />
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
                        <MessageCircle className='mr-2 h-5 w-5' />
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
