import type { Competition, Match, Team, TeamMatchRecord } from '../domain/types'

const BASE_URL = 'https://webws.365scores.com/web'
export const SERIE_B_365_ID = 116
const SEASON = 2026
const DEFAULT_CLUB_RATING = 1500
const MAX_PAGES_PER_STREAM = 24
const MAX_TEAM_HISTORY_PAGES = 8

type Scores365Ranking = {
  name: string
  position: number
}

type Scores365Competitor = {
  id: number
  name: string
  shortName?: string
  longName?: string
  symbolicName?: string
  nameForURL?: string
  score?: number
  color?: string
  imageVersion?: number
  popularityRank?: number
  rankings?: Scores365Ranking[]
}

type Scores365Game = {
  id: number
  competitionId: number
  hasStats?: boolean
  roundNum?: number
  roundName?: string
  groupName?: string
  startTime: string
  statusText?: string
  statusGroup?: number
  homeCompetitor: Scores365Competitor
  awayCompetitor: Scores365Competitor
  venue?: { name?: string }
}

type Scores365GamesResponse = {
  games?: Scores365Game[]
  paging?: {
    previousPage?: string
    nextPage?: string
  }
}

type Scores365ChartEvent = {
  competitorNum?: number
  xg?: string
  xgot?: string
  outcome?: { id?: number; name?: string }
}

type Scores365GameDetailResponse = {
  game?: {
    homeCompetitor?: Scores365Competitor
    awayCompetitor?: Scores365Competitor
    chartEvents?: { events?: Scores365ChartEvent[] }
    playByPlay?: { feedURL?: string }
  }
}

type Scores365PlayByPlayMessage = {
  TypeName?: string
  Comment?: string
}

type Scores365PlayByPlayResponse = {
  Messages?: Scores365PlayByPlayMessage[]
}

type Scores365StandingRow = {
  competitor: { id: number }
  gamePlayed: number
  gamesWon: number
  gamesEven: number
  gamesLost: number
  for: number
  against: number
  points: number
  position: number
}

type Scores365StandingsResponse = {
  standings?: Array<{
    rows?: Scores365StandingRow[]
  }>
}

export type TeamStanding = {
  competitorId: number
  position: number
  points: number
  gamePlayed: number
  goalsFor: number
  goalsAgainst: number
}

export type LeagueData = {
  competition: Competition
  teams: Team[]
  matches: Match[]
  recordsByTeam: Record<string, TeamMatchRecord[]>
  source: string
}

const request = async <T>(path: string): Promise<T> => {
  const normalizedPath = path.startsWith('/web/') ? path.slice(4) : path
  const response = await fetch(`${BASE_URL}${normalizedPath}`, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`365Scores request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

const requestAbsolute = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`External request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

const teamName = (competitor: Scores365Competitor) => competitor.shortName ?? competitor.name

const teamCode = (competitor: Scores365Competitor) =>
  competitor.symbolicName?.slice(0, 3).toUpperCase() ?? teamName(competitor).slice(0, 3).toUpperCase()

const imageUrl = (folder: 'Competitors' | 'Competitions', id: number, imageVersion = 1, size = 128) =>
  `https://imagecache.365scores.com/image/upload/f_png,w_${size},h_${size},c_limit,q_auto:eco,d_${folder}:default1.png/v${imageVersion}/${folder}/${id}`

const colorOr = (value: string | undefined, fallback: string) => (value?.startsWith('#') ? value : fallback)

// Deriva baseRating a partir de dados reais da tabela de classificação.
// Spread ~200-250pts: líder ≈1650, lanterna ≈1400.
// Com n=0 jogos (início de temporada), usa fallback por índice com spread 110pts.
const baseRatingFromStanding = (standing: TeamStanding | undefined, index: number): number => {
  if (!standing || standing.gamePlayed === 0) {
    return Math.round(DEFAULT_CLUB_RATING + Math.max(0, 20 - index) * 6)
  }
  const ppm = standing.points / standing.gamePlayed // 0..3
  const gdPerGame = (standing.goalsFor - standing.goalsAgainst) / standing.gamePlayed
  // strength ∈ [0, 1] com regressão à média proporcional a n jogos
  const regW = Math.min(standing.gamePlayed / 10, 1)
  const leagueMeanPPM = 1.0 // approx Série B (3 resultados por jogo / 3 = 1)
  const smoothPPM = regW * ppm + (1 - regW) * leagueMeanPPM
  const gdCapped = Math.min(Math.max(gdPerGame, -2.5), 2.5)
  const strength = (smoothPPM / 3) * 0.70 + ((gdCapped + 2.5) / 5) * 0.30
  return Math.round(1360 + strength * 290) // range 1360..1650
}

const baseRatingFromCompetitor = (competitor: Scores365Competitor, index: number) => {
  const ranking = competitor.rankings?.find((item) => /rating|rank|club/i.test(item.name))
  if (ranking?.position) return Math.round(1640 - ranking.position * 3.8)
  return Math.round(DEFAULT_CLUB_RATING + Math.max(0, 20 - index) * 6)
}

const createCompetition = (source: string): Competition => ({
  id: 'brasileirao-serie-b-2026',
  scores365Id: SERIE_B_365_ID,
  name: 'Brasileirao Serie B',
  country: 'Brasil',
  type: 'league',
  format: 'league_table',
  season: SEASON,
  level: 2,
  tagline: 'Motor preditivo para a temporada completa',
  primaryColor: '#005baa',
  secondaryColor: '#f6d90f',
  accentColor: '#00a651',
  logoUrl: imageUrl('Competitions', SERIE_B_365_ID, 1, 180),
  source,
})

const createTeam = (competitor: Scores365Competitor, index: number, standing?: TeamStanding): Team => {
  const primaryColor = colorOr(competitor.color, index % 2 === 0 ? '#0f766e' : '#1d4ed8')

  return {
    id: slugify(`${competitor.id}-${competitor.nameForURL ?? competitor.name}`),
    scores365Id: competitor.id,
    name: competitor.longName ?? competitor.name,
    shortName: teamName(competitor),
    code: teamCode(competitor),
    country: 'Brasil',
    city: 'A definir',
    stadium: 'A definir',
    teamType: 'club',
    currentLeagueId: 'brasileirao-serie-b-2026',
    baseRating: standing ? baseRatingFromStanding(standing, index) : baseRatingFromCompetitor(competitor, index),
    ratingSource: '365Scores seed + Orion Club',
    primaryColor,
    secondaryColor: '#f8fafc',
    logoUrl: imageUrl('Competitors', competitor.id, competitor.imageVersion ?? 1),
  }
}

const isFinished = (game: Scores365Game) =>
  game.statusText?.toLowerCase() === 'ended' || game.statusGroup === 4

const scoreValue = (competitor: Scores365Competitor) => Math.max(0, Math.round(competitor.score ?? 0))

const decimalValue = (value?: string) => {
  if (!value) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const normalizeName = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

const includesTeamName = (comment: string, teamNameValue: string) =>
  normalizeName(comment).includes(normalizeName(teamNameValue))

const roundFromGame = (game: Scores365Game, fallback: number) => {
  if (typeof game.roundNum === 'number' && game.roundNum > 0) return game.roundNum
  const fromText = game.roundName?.match(/\d+/)?.[0] ?? game.groupName?.match(/\d+/)?.[0]
  return fromText ? Number(fromText) : fallback
}

const matchFromGame = (game: Scores365Game, teamsByProviderId: Map<number, Team>, fallbackRound: number): Match | null => {
  const homeTeam = teamsByProviderId.get(game.homeCompetitor.id)
  const awayTeam = teamsByProviderId.get(game.awayCompetitor.id)
  if (!homeTeam || !awayTeam) return null

  return {
    id: String(game.id),
    scores365Id: game.id,
    competitionId: 'brasileirao-serie-b-2026',
    season: SEASON,
    round: roundFromGame(game, fallbackRound),
    kickoff: game.startTime,
    venue: game.venue?.name ?? 'A definir',
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    status: isFinished(game) ? 'finished' : 'scheduled',
    homeGoals: isFinished(game) ? scoreValue(game.homeCompetitor) : undefined,
    awayGoals: isFinished(game) ? scoreValue(game.awayCompetitor) : undefined,
    isNeutral: false,
    statusText: game.statusText,
    statusGroup: game.statusGroup,
  }
}

const gameToRecord = (game: Scores365Game, team: Team, teamsByProviderId: Map<number, Team>): TeamMatchRecord | null => {
  if (!team.scores365Id || !isFinished(game)) return null
  const isHome = game.homeCompetitor.id === team.scores365Id
  const isAway = game.awayCompetitor.id === team.scores365Id
  if (!isHome && !isAway) return null

  const opponent = isHome ? game.awayCompetitor : game.homeCompetitor
  const own = isHome ? game.homeCompetitor : game.awayCompetitor
  const opponentTeam = teamsByProviderId.get(opponent.id)

  return {
    matchId: String(game.id),
    date: game.startTime,
    competitionId: 'brasileirao-serie-b-2026',
    season: gameSeason(game),
    opponentId: opponentTeam?.id ?? slugify(`${opponent.id}-${opponent.nameForURL ?? opponent.name}`),
    opponentRating: opponentTeam?.baseRating ?? DEFAULT_CLUB_RATING,
    homeAway: isHome ? 'home' : 'away',
    teamGoals: scoreValue(own),
    opponentGoals: scoreValue(opponent),
  }
}

const fetchGameAdvancedStats365 = async (gameId: number, teamId: number) => {
  const params = new URLSearchParams({
    gameId: String(gameId),
    appTypeId: '5',
    langId: '1',
    timezoneName: 'UTC',
    userCountryId: '21',
  })
  const data = await request<Scores365GameDetailResponse>(`/game/?${params.toString()}`)
  const detail = data.game
  if (!detail?.homeCompetitor || !detail.awayCompetitor) return null

  const teamCompetitorNum = detail.homeCompetitor.id === teamId ? 1 : detail.awayCompetitor.id === teamId ? 2 : 0
  if (!teamCompetitorNum) return null

  const totals = {
    shotsFor: 0,
    shotsOnTargetFor: 0,
    xgFor: 0,
    shotsAgainst: 0,
    shotsOnTargetAgainst: 0,
    xgAgainst: 0,
    cornersFor: 0,
    cornersAgainst: 0,
    yellowCardsFor: 0,
    yellowCardsAgainst: 0,
    redCardsFor: 0,
    redCardsAgainst: 0,
  }

  for (const event of detail.chartEvents?.events ?? []) {
    if (!event.competitorNum) continue
    const xg = decimalValue(event.xg)
    const isShotEvent = xg > 0 || decimalValue(event.xgot) > 0
    if (!isShotEvent) continue

    const isOnTarget = event.outcome?.id === 0 || event.outcome?.id === 2
    const isForTeam = event.competitorNum === teamCompetitorNum
    if (isForTeam) {
      totals.shotsFor += 1
      totals.xgFor += xg
      if (isOnTarget) totals.shotsOnTargetFor += 1
    } else {
      totals.shotsAgainst += 1
      totals.xgAgainst += xg
      if (isOnTarget) totals.shotsOnTargetAgainst += 1
    }
  }

  if (detail.playByPlay?.feedURL) {
    try {
      const pbp = await requestAbsolute<Scores365PlayByPlayResponse>(detail.playByPlay.feedURL)
      const homeName = teamName(detail.homeCompetitor)
      const awayName = teamName(detail.awayCompetitor)
      for (const message of pbp.Messages ?? []) {
        const typeName = message.TypeName?.toLowerCase() ?? ''
        const comment = message.Comment ?? ''
        const isForTeam = includesTeamName(comment, teamCompetitorNum === 1 ? homeName : awayName)
        const isForOpponent = includesTeamName(comment, teamCompetitorNum === 1 ? awayName : homeName)
        if (typeName === 'corner') {
          if (isForTeam) totals.cornersFor += 1
          if (isForOpponent) totals.cornersAgainst += 1
        }
        if (typeName === 'yellow card') {
          if (isForTeam) totals.yellowCardsFor += 1
          if (isForOpponent) totals.yellowCardsAgainst += 1
        }
        if (typeName === 'red card') {
          if (isForTeam) totals.redCardsFor += 1
          if (isForOpponent) totals.redCardsAgainst += 1
        }
      }
    } catch {
      // Keep chart stats if play-by-play enrichment fails.
    }
  }

  if (totals.shotsFor === 0 && totals.shotsAgainst === 0) return null

  return {
    shotsFor: totals.shotsFor,
    shotsOnTargetFor: totals.shotsOnTargetFor,
    xgFor: Number(totals.xgFor.toFixed(2)),
    shotsAgainst: totals.shotsAgainst,
    shotsOnTargetAgainst: totals.shotsOnTargetAgainst,
    xgAgainst: Number(totals.xgAgainst.toFixed(2)),
    cornersFor: totals.cornersFor,
    cornersAgainst: totals.cornersAgainst,
    yellowCardsFor: totals.yellowCardsFor,
    yellowCardsAgainst: totals.yellowCardsAgainst,
    redCardsFor: totals.redCardsFor,
    redCardsAgainst: totals.redCardsAgainst,
  }
}

const gameSeason = (game: Scores365Game) => new Date(game.startTime).getUTCFullYear()

const fetchPagedGames365 = async (
  path: string,
  direction: 'previousPage' | 'nextPage',
): Promise<Scores365Game[]> => {
  const byId = new Map<number, Scores365Game>()
  let nextPath: string | undefined = path
  let pageCount = 0

  while (nextPath && pageCount < MAX_PAGES_PER_STREAM) {
    const data: Scores365GamesResponse = await request<Scores365GamesResponse>(nextPath)
    const games: Scores365Game[] = (data.games ?? []).filter(
      (game: Scores365Game) => game.competitionId === SERIE_B_365_ID && gameSeason(game) === SEASON,
    )
    const beforeSize = byId.size

    for (const game of games) {
      byId.set(game.id, game)
    }

    pageCount += 1
    if (games.length === 0 || byId.size === beforeSize) break
    nextPath = data.paging?.[direction]
  }

  return [...byId.values()]
}

const fetchBidirectionalGames365 = async (path: string) => {
  const [previousGames, nextGames] = await Promise.all([
    fetchPagedGames365(path, 'previousPage'),
    fetchPagedGames365(path, 'nextPage'),
  ])
  const byId = new Map<number, Scores365Game>()

  for (const game of [...previousGames, ...nextGames]) {
    byId.set(game.id, game)
  }

  return [...byId.values()]
}

export const fetchSerieBGames365 = async () => {
  const params = new URLSearchParams({
    appTypeId: '5',
    langId: '1',
    timezoneName: 'UTC',
    userCountryId: '21',
    competitions: String(SERIE_B_365_ID),
  })
  const [results, fixtures] = await Promise.all([
    fetchBidirectionalGames365(`/games/results/?${params.toString()}`),
    fetchBidirectionalGames365(`/games/fixtures/?${params.toString()}`),
  ])
  const byId = new Map<number, Scores365Game>()

  for (const game of [...results, ...fixtures]) {
    byId.set(game.id, game)
  }

  return [...byId.values()].sort((first, second) => new Date(first.startTime).getTime() - new Date(second.startTime).getTime())
}

const fetchTeamResultsByYears365 = async (scores365Id: number, years: number[]) => {
  const params = new URLSearchParams({
    appTypeId: '5',
    langId: '1',
    timezoneName: 'UTC',
    userCountryId: '21',
    competitors: String(scores365Id),
  })
  const startPath = `/games/results/?${params.toString()}`
  const [currentGames, previousGames] = await Promise.all([
    request<Scores365GamesResponse>(startPath).then((data) =>
      (data.games ?? []).filter(
        (game) => isFinished(game) && game.competitionId === SERIE_B_365_ID && years.includes(gameSeason(game)),
      ),
    ),
    fetchPagedTeamResults365(startPath, 'previousPage', years),
  ])
  const byId = new Map<number, Scores365Game>()

  for (const game of [...currentGames, ...previousGames]) {
    byId.set(game.id, game)
  }

  return [...byId.values()].sort((first, second) => new Date(second.startTime).getTime() - new Date(first.startTime).getTime())
}

const fetchPagedTeamResults365 = async (
  path: string,
  direction: 'previousPage' | 'nextPage',
  years: number[],
): Promise<Scores365Game[]> => {
  const byId = new Map<number, Scores365Game>()
  let nextPath: string | undefined = path
  let pageCount = 0

  while (nextPath && pageCount < MAX_TEAM_HISTORY_PAGES) {
    const data: Scores365GamesResponse = await request<Scores365GamesResponse>(nextPath)
    const games: Scores365Game[] = (data.games ?? []).filter(
      (game: Scores365Game) => isFinished(game) && game.competitionId === SERIE_B_365_ID && years.includes(gameSeason(game)),
    )
    const beforeSize = byId.size

    for (const game of games) {
      byId.set(game.id, game)
    }

    pageCount += 1
    if (games.length === 0 && pageCount > 1) break
    if (byId.size === beforeSize && pageCount > 3) break
    nextPath = data.paging?.[direction]
  }

  return [...byId.values()]
}

export const fetchRecentTeamGames365 = async (scores365Id: number) => {
  return fetchTeamResultsByYears365(scores365Id, [SEASON])
}

export const fetchSerieBStandings365 = async (): Promise<Map<number, TeamStanding>> => {
  const params = new URLSearchParams({
    appTypeId: '5',
    langId: '1',
    timezoneName: 'UTC',
    userCountryId: '21',
    competitions: String(SERIE_B_365_ID),
    groupId: '0',
  })
  const standings = new Map<number, TeamStanding>()
  try {
    const data = await request<Scores365StandingsResponse>(`/standings/?${params.toString()}`)
    for (const table of data.standings ?? []) {
      for (const row of table.rows ?? []) {
        standings.set(row.competitor.id, {
          competitorId: row.competitor.id,
          position: row.position,
          points: row.points,
          gamePlayed: row.gamePlayed,
          goalsFor: row.for,
          goalsAgainst: row.against,
        })
      }
    }
  } catch {
    // standings é optional – se falhar, ratings caem para fallback de índice
  }
  return standings
}

export const fetchSerieBData365 = async (): Promise<LeagueData> => {
  const [games, standings] = await Promise.all([fetchSerieBGames365(), fetchSerieBStandings365()])
  if (games.length === 0) throw new Error('365Scores nao retornou jogos para a Serie B 2026')

  const competitors = new Map<number, Scores365Competitor>()
  for (const game of games) {
    competitors.set(game.homeCompetitor.id, game.homeCompetitor)
    competitors.set(game.awayCompetitor.id, game.awayCompetitor)
  }

  const teams = Array.from(competitors.values()).map((competitor, index) =>
    createTeam(competitor, index, standings.get(competitor.id)),
  )
  const teamsByProviderId = new Map(
    teams
      .filter((team): team is Team & { scores365Id: number } => Boolean(team.scores365Id))
      .map((team) => [team.scores365Id, team]),
  )
  const matches = games
    .map((game, index) => matchFromGame(game, teamsByProviderId, Math.floor(index / 10) + 1))
    .filter((match): match is Match => Boolean(match))
  const recordsEntries = await Promise.all(
    teams.map(async (team) => {
      if (!team.scores365Id) return [team.id, []] as const

      try {
        const teamGames = await fetchTeamResultsByYears365(team.scores365Id, [SEASON, SEASON - 1])
        const currentSeasonGames = teamGames.filter((game) => gameSeason(game) === SEASON)
        const previousSeasonGames = teamGames.filter((game) => gameSeason(game) === SEASON - 1).slice(0, 20)
        const selectedGames = [...currentSeasonGames, ...previousSeasonGames]
        const records = await Promise.all(
          selectedGames.map(async (game, index) => {
            const baseRecord = gameToRecord(game, team, teamsByProviderId)
            if (!baseRecord) return null
            if (gameSeason(game) !== SEASON || index >= 5 || !game.hasStats) return baseRecord

            try {
              const advanced = await fetchGameAdvancedStats365(game.id, team.scores365Id as number)
              return advanced ? { ...baseRecord, ...advanced } : baseRecord
            } catch {
              return baseRecord
            }
          }),
        )

        return [team.id, records.filter((record): record is TeamMatchRecord => Boolean(record))] as const
      } catch {
        return [team.id, []] as const
      }
    }),
  )

  return {
    competition: createCompetition('365Scores - Brasileirao Serie B 2026'),
    teams,
    matches,
    recordsByTeam: Object.fromEntries(recordsEntries),
    source: '365Scores - Brasileirao Serie B 2026',
  }
}