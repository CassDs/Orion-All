import type { Competition, Match, Team, TeamMatchRecord } from '../domain/types'

const BASE_URL = 'https://webws.365scores.com/web'
export const SERIE_A_365_ID = 113
export const SERIE_B_365_ID = 116
export const SERIE_C_365_ID = 5518
export const SERIE_D_365_ID = 5519
export const CHINA_SUPER_LEAGUE_365_ID = 150
export const ECUADOR_LIGA_PRO_365_ID = 5062
const SEASON = 2026

export type League365Config = {
  id: string
  scores365Id: number
  name: string
  country: string
  level: number
  tagline: string
  primaryColor: string
  secondaryColor: string
  accentColor: string
}
const DEFAULT_CLUB_RATING = 1500
// 365Scores retorna ~15 jogos por pagina; Serie D tem 450+ jogos na temporada,
// entao o limite precisa cobrir ~35+ paginas por stream.
const MAX_PAGES_PER_STREAM = 64
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
  stageNum?: number
  stageName?: string
  legNum?: number
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
  const url = `${BASE_URL}${normalizedPath}`

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
    }).catch((error) => {
      if (attempt >= 2) throw error
      return null
    })

    if (response?.ok) return response.json() as Promise<T>

    // 365Scores devolve 504 sob rajadas de requisicoes; tenta novamente com backoff.
    if (attempt >= 2) {
      throw new Error(`365Scores request failed: ${response?.status ?? 'network error'}`)
    }

    await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)))
  }
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

export const competitionLogoUrl = (scores365Id: number) => imageUrl('Competitions', scores365Id, 1, 180)

export const LEAGUES_365: League365Config[] = [
  {
    id: 'brasileirao-serie-a-2026',
    scores365Id: SERIE_A_365_ID,
    name: 'Brasileirao Serie A',
    country: 'Brasil',
    level: 1,
    tagline: 'Elite do futebol brasileiro com dados 365Scores',
    primaryColor: '#009c3b',
    secondaryColor: '#ffdf00',
    accentColor: '#002776',
  },
  {
    id: 'brasileirao-serie-b-2026',
    scores365Id: SERIE_B_365_ID,
    name: 'Brasileirao Serie B',
    country: 'Brasil',
    level: 2,
    tagline: 'Temporada completa 2026 com dados 365Scores e predições congeladas',
    primaryColor: '#005baa',
    secondaryColor: '#f6d90f',
    accentColor: '#00a651',
  },
  {
    id: 'brasileirao-serie-c-2026',
    scores365Id: SERIE_C_365_ID,
    name: 'Brasileirao Serie C',
    country: 'Brasil',
    level: 3,
    tagline: 'Primeira fase e quadrangulares 2026 com dados 365Scores',
    primaryColor: '#00843d',
    secondaryColor: '#f6d90f',
    accentColor: '#005baa',
  },
  {
    id: 'brasileirao-serie-d-2026',
    scores365Id: SERIE_D_365_ID,
    name: 'Brasileirao Serie D',
    country: 'Brasil',
    level: 4,
    tagline: 'Fase de grupos e mata-mata 2026 com dados 365Scores',
    primaryColor: '#0f4c81',
    secondaryColor: '#ffd200',
    accentColor: '#00843d',
  },
  {
    id: 'china-super-league-2026',
    scores365Id: CHINA_SUPER_LEAGUE_365_ID,
    name: 'Super League China',
    country: 'China',
    level: 1,
    tagline: 'Primeira divisão chinesa 2026 com dados 365Scores',
    primaryColor: '#de2910',
    secondaryColor: '#ffde00',
    accentColor: '#8a1508',
  },
  {
    id: 'ecuador-liga-pro-2026',
    scores365Id: ECUADOR_LIGA_PRO_365_ID,
    name: 'LigaPro Equador',
    country: 'Equador',
    level: 1,
    tagline: 'Campeonato equatoriano 2026 com dados 365Scores',
    primaryColor: '#ffd100',
    secondaryColor: '#0072ce',
    accentColor: '#ef3340',
  },
]

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

const createCompetition = (league: League365Config, source: string): Competition => ({
  id: league.id,
  scores365Id: league.scores365Id,
  name: league.name,
  country: league.country,
  type: 'league',
  format: 'league_table',
  season: SEASON,
  level: league.level,
  tagline: league.tagline,
  primaryColor: league.primaryColor,
  secondaryColor: league.secondaryColor,
  accentColor: league.accentColor,
  logoUrl: competitionLogoUrl(league.scores365Id),
  source,
})

const createTeam = (competitor: Scores365Competitor, index: number, leagueId: string, standing?: TeamStanding): Team => {
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
    currentLeagueId: leagueId,
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

// Fases posteriores (quadrangular da Série C, mata-mata da Série D) recebem offset de 20
// por fase para não colidir com as rodadas da primeira fase.
const roundFromGame = (game: Scores365Game, fallback: number) => {
  const stageOffset = typeof game.stageNum === 'number' && game.stageNum > 1 ? (game.stageNum - 1) * 20 : 0
  if (typeof game.roundNum === 'number' && game.roundNum > 0) return stageOffset + game.roundNum
  const fromText = game.roundName?.match(/\d+/)?.[0] ?? game.groupName?.match(/\d+/)?.[0]
  if (fromText) return stageOffset + Number(fromText)
  if (stageOffset > 0) return stageOffset + (typeof game.legNum === 'number' && game.legNum > 0 ? game.legNum : 1)
  return fallback
}

const matchFromGame = (game: Scores365Game, teamsByProviderId: Map<number, Team>, fallbackRound: number, leagueId: string): Match | null => {
  const homeTeam = teamsByProviderId.get(game.homeCompetitor.id)
  const awayTeam = teamsByProviderId.get(game.awayCompetitor.id)
  if (!homeTeam || !awayTeam) return null

  return {
    id: String(game.id),
    scores365Id: game.id,
    competitionId: leagueId,
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

const gameToRecord = (game: Scores365Game, team: Team, teamsByProviderId: Map<number, Team>, leagueId: string): TeamMatchRecord | null => {
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
    competitionId: leagueId,
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
  competitionId365: number,
): Promise<Scores365Game[]> => {
  const byId = new Map<number, Scores365Game>()
  let nextPath: string | undefined = path
  let pageCount = 0

  while (nextPath && pageCount < MAX_PAGES_PER_STREAM) {
    let data: Scores365GamesResponse
    try {
      data = await request<Scores365GamesResponse>(nextPath)
    } catch {
      // Mantem as paginas ja coletadas em vez de falhar a liga inteira.
      break
    }
    const games: Scores365Game[] = (data.games ?? []).filter(
      (game: Scores365Game) => game.competitionId === competitionId365 && gameSeason(game) === SEASON,
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

const fetchBidirectionalGames365 = async (path: string, competitionId365: number) => {
  const [previousGames, nextGames] = await Promise.all([
    fetchPagedGames365(path, 'previousPage', competitionId365),
    fetchPagedGames365(path, 'nextPage', competitionId365),
  ])
  const byId = new Map<number, Scores365Game>()

  for (const game of [...previousGames, ...nextGames]) {
    byId.set(game.id, game)
  }

  return [...byId.values()]
}

export const fetchLeagueGames365 = async (competitionId365: number) => {
  const params = new URLSearchParams({
    appTypeId: '5',
    langId: '1',
    timezoneName: 'UTC',
    userCountryId: '21',
    competitions: String(competitionId365),
  })
  const [results, fixtures] = await Promise.all([
    fetchBidirectionalGames365(`/games/results/?${params.toString()}`, competitionId365),
    fetchBidirectionalGames365(`/games/fixtures/?${params.toString()}`, competitionId365),
  ])
  const byId = new Map<number, Scores365Game>()

  for (const game of [...results, ...fixtures]) {
    byId.set(game.id, game)
  }

  return [...byId.values()].sort((first, second) => new Date(first.startTime).getTime() - new Date(second.startTime).getTime())
}

const fetchTeamResultsByYears365 = async (scores365Id: number, years: number[], competitionId365: number) => {
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
        (game) => isFinished(game) && game.competitionId === competitionId365 && years.includes(gameSeason(game)),
      ),
    ),
    fetchPagedTeamResults365(startPath, 'previousPage', years, competitionId365),
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
  competitionId365: number,
): Promise<Scores365Game[]> => {
  const byId = new Map<number, Scores365Game>()
  let nextPath: string | undefined = path
  let pageCount = 0

  while (nextPath && pageCount < MAX_TEAM_HISTORY_PAGES) {
    const data: Scores365GamesResponse = await request<Scores365GamesResponse>(nextPath)
    const games: Scores365Game[] = (data.games ?? []).filter(
      (game: Scores365Game) => isFinished(game) && game.competitionId === competitionId365 && years.includes(gameSeason(game)),
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

export const fetchRecentTeamGames365 = async (scores365Id: number, competitionId365 = SERIE_B_365_ID) => {
  return fetchTeamResultsByYears365(scores365Id, [SEASON], competitionId365)
}

export const fetchLeagueStandings365 = async (competitionId365: number): Promise<Map<number, TeamStanding>> => {
  const params = new URLSearchParams({
    appTypeId: '5',
    langId: '1',
    timezoneName: 'UTC',
    userCountryId: '21',
    competitions: String(competitionId365),
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

// Renumera as rodadas para uma sequencia contigua 1..N preservando a ordem
// (fases com offset — ex. Serie D: 1-10, 21, 22, 41, 42 — viram 1-14).
const normalizeRounds = (matches: Match[]): Match[] => {
  const distinct = [...new Set(matches.map((match) => match.round))].sort((a, b) => a - b)
  const mapping = new Map(distinct.map((round, index) => [round, index + 1]))
  return matches.map((match) => ({ ...match, round: mapping.get(match.round) ?? match.round }))
}

export const fetchLeagueData365 = async (league: League365Config): Promise<LeagueData> => {
  const [games, standings] = await Promise.all([
    fetchLeagueGames365(league.scores365Id),
    fetchLeagueStandings365(league.scores365Id),
  ])
  if (games.length === 0) throw new Error(`365Scores nao retornou jogos para ${league.name} ${SEASON}`)

  const competitors = new Map<number, Scores365Competitor>()
  for (const game of games) {
    competitors.set(game.homeCompetitor.id, game.homeCompetitor)
    competitors.set(game.awayCompetitor.id, game.awayCompetitor)
  }

  const teams = Array.from(competitors.values()).map((competitor, index) =>
    createTeam(competitor, index, league.id, standings.get(competitor.id)),
  )
  const teamsByProviderId = new Map(
    teams
      .filter((team): team is Team & { scores365Id: number } => Boolean(team.scores365Id))
      .map((team) => [team.scores365Id, team]),
  )
  const matches = normalizeRounds(
    games
      .map((game, index) => matchFromGame(game, teamsByProviderId, Math.floor(index / 10) + 1, league.id))
      .filter((match): match is Match => Boolean(match)),
  )
  const recordsEntries = await Promise.all(
    teams.map(async (team) => {
      if (!team.scores365Id) return [team.id, []] as const

      try {
        const teamGames = await fetchTeamResultsByYears365(team.scores365Id, [SEASON, SEASON - 1], league.scores365Id)
        const currentSeasonGames = teamGames.filter((game) => gameSeason(game) === SEASON)
        const previousSeasonGames = teamGames.filter((game) => gameSeason(game) === SEASON - 1).slice(0, 20)
        const selectedGames = [...currentSeasonGames, ...previousSeasonGames]
        const records = await Promise.all(
          selectedGames.map(async (game, index) => {
            const baseRecord = gameToRecord(game, team, teamsByProviderId, league.id)
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

  const source = `365Scores - ${league.name} ${SEASON}`

  return {
    competition: createCompetition(league, source),
    teams,
    matches,
    recordsByTeam: Object.fromEntries(recordsEntries),
    source,
  }
}