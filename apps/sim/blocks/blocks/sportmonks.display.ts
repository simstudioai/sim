import { SportmonksIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

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

export const SportmonksBlockMeta = {
  tags: ['data-analytics'],
  url: 'https://www.sportmonks.com',
  templates: [
    {
      icon: SportmonksIcon,
      title: 'Daily football fixtures digest',
      prompt:
        "Build a scheduled daily workflow that fetches today's football fixtures from Sportmonks for the leagues I follow, summarizes the key matchups and kickoff times, and posts the digest to Slack.",
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SportmonksIcon,
      title: 'Live football score alerter',
      prompt:
        'Create a scheduled workflow that polls Sportmonks inplay football scores, detects goals and status changes since the last run, and pings Slack with the updated scoreline for tracked matches.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SportmonksIcon,
      title: 'Weekly league standings report',
      prompt:
        'Build a scheduled weekly workflow that pulls the Sportmonks football standings and topscorers for a season, formats a league table with recent form, and emails the report to the group.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'analysis'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: SportmonksIcon,
      title: 'Race weekend schedule digest',
      prompt:
        "Build a scheduled workflow that fetches this weekend's motorsport sessions from Sportmonks, summarizes the practice, qualifying, and race times, and posts the schedule to Slack.",
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SportmonksIcon,
      title: 'Motorsport championship tracker',
      prompt:
        'Create a scheduled weekly workflow that pulls the Sportmonks motorsport driver and constructor standings for the current season, formats the championship tables, and emails them to the group.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['reporting', 'analysis'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: SportmonksIcon,
      title: 'Pre-match odds snapshot',
      prompt:
        'Build a workflow that pulls Sportmonks pre-match odds for a fixture across selected bookmakers, computes the implied probability for each outcome, and writes the snapshot to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'analysis'],
    },
    {
      icon: SportmonksIcon,
      title: 'Live odds movement alerter',
      prompt:
        'Create a scheduled workflow that polls Sportmonks in-play odds for a fixture, detects sharp price moves since the last run, and pings Slack with the updated lines.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'finance'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SportmonksIcon,
      title: 'Head-to-head match preview',
      prompt:
        'Create a workflow that takes two team names, resolves them to IDs via Sportmonks football team search, pulls their head-to-head history and current standings, and writes a match preview file.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research', 'content'],
    },
  ],
  skills: [
    {
      name: 'daily-football-fixtures',
      description: "List a day's football fixtures from Sportmonks, optionally filtered by league.",
      content:
        '# Daily Football Fixtures\n\nGet the football matches scheduled for a given day.\n\n## Steps\n1. Use Get Football Fixtures by Date with the target date in YYYY-MM-DD format.\n2. Optionally set Includes to `participants;scores;league` to enrich each fixture.\n3. Optionally set Filters such as `fixtureLeagues:501,271` to restrict to specific leagues.\n\n## Output\nA list of fixtures with kickoff time, the participating teams, and league.',
    },
    {
      name: 'live-football-scores',
      description: 'Fetch in-play football matches and their current scores from Sportmonks.',
      content:
        '# Live Football Scores\n\nSee which matches are being played now and the live score.\n\n## Steps\n1. Use Get Inplay Football Scores to fetch matches in progress.\n2. Set Includes to `participants;scores` for team names and the scoreline.\n3. Optionally filter with `fixtureLeagues:501`.\n\n## Output\nA list of live fixtures, each with the two teams, current score, and match state.',
    },
    {
      name: 'football-league-table',
      description: 'Build a football league standings table for a season from Sportmonks.',
      content:
        "# Football League Table\n\nGet the current standings for a competition.\n\n## Steps\n1. Find the season ID (use Get Football Leagues, then its current season).\n2. Use Get Football Standings by Season with that season ID.\n3. Set Includes to `participant` for team names and `form` for recent results.\n\n## Output\nAn ordered league table with each team's position, points, and recent form.",
    },
    {
      name: 'race-weekend-sessions',
      description: 'List the motorsport sessions on a given date from Sportmonks.',
      content:
        '# Race Weekend Sessions\n\nGet the practice, qualifying, and race sessions for a day.\n\n## Steps\n1. Use Get Motorsport Fixtures by Date with the target date in YYYY-MM-DD format.\n2. Set Includes to `venue;participants` to attach the track and entrants.\n\n## Output\nA list of sessions for the day with type (Practice/Qualifying/Race), track, and start time.',
    },
    {
      name: 'motorsport-championship',
      description: 'Fetch driver and constructor championship standings for a motorsport season.',
      content:
        "# Motorsport Championship\n\nGet the title race state for a season.\n\n## Steps\n1. Use Get Motorsport Driver Standings by Season with the season ID.\n2. Use Get Motorsport Team Standings by Season with the same season ID.\n3. Set Includes to `participant` for driver/team names.\n\n## Output\nOrdered drivers and constructors tables with each participant's position and points.",
    },
    {
      name: 'pre-match-odds',
      description: 'Fetch pre-match odds for a fixture and compute implied probabilities.',
      content:
        '# Pre-match Odds\n\nGet the betting odds for an upcoming fixture.\n\n## Steps\n1. Use Get Pre-match Odds by Fixture with the fixture ID.\n2. Set Includes to `market;bookmaker` and optionally Filters like `bookmakers:2,14` to narrow results.\n\n## Output\nThe odds per outcome with decimal value and implied probability, grouped by market and bookmaker.',
    },
    {
      name: 'odds-line-shopping',
      description: 'Find the best available price per outcome across bookmakers.',
      content:
        '# Odds Line Shopping\n\nFind the best odds for each outcome.\n\n## Steps\n1. Use Get Pre-match Odds by Fixture for the fixture (do not filter to one bookmaker).\n2. Group the returned odds by market and outcome label.\n3. For each outcome, pick the highest value and note its bookmaker_id.\n\n## Output\nFor each outcome, the best decimal price and which bookmaker offers it.',
    },
    {
      name: 'resolve-country',
      description:
        'Resolve a country name to its Sportmonks ID and ISO codes via Core reference data.',
      content:
        '# Resolve Country\n\nNormalize a country name to Sportmonks reference data.\n\n## Steps\n1. Use Search Countries with the country name.\n2. Read the matching country id, iso2, iso3, and fifa_name.\n\n## Output\nThe country id plus its ISO2, ISO3, and FIFA codes for use in other lookups.',
    },
  ],
} as const satisfies BlockMeta
