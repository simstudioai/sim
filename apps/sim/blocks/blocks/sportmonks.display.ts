import { SportmonksIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SportmonksBlockDisplay = {
  type: 'sportmonks',
  name: 'Sportmonks',
  description: 'Access Sportmonks football, motorsport, odds, and reference data',
  category: 'tools',
  bgColor: '#171534',
  icon: SportmonksIcon,
  longDescription:
    'Integrate the Sportmonks sports data APIs into the workflow from a single block. Football: fixtures, livescores, leagues, seasons, stages, rounds, teams, squads, players, coaches, referees, venues, standings, topscorers, transfers, schedules, commentaries, TV stations, rivals, expected goals (xG), and predictions. Motorsport: sessions, drivers, teams, championship standings, laps, and pitstops. Odds: pre-match and in-play odds, bookmakers, and markets. Core: continents, countries, regions, cities, types, and time zones.',
  docsLink: 'https://docs.sim.ai/integrations/sportmonks',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay
