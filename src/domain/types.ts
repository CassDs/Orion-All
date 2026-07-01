export type CompetitionFormat = 'league_table' | 'knockout' | 'mixed'

export type MatchStatus = 'scheduled' | 'finished'

export type HomeAway = 'home' | 'away' | 'neutral'

export type Competition = {
  id: string
  scores365Id?: number
  name: string
  country: string
  type: 'league' | 'cup' | 'international' | 'friendly'
  format: CompetitionFormat
  season: number
  level: number
  tagline: string
  primaryColor: string
  secondaryColor: string
  accentColor: string
  logoUrl?: string
  source?: string
}

export type Team = {
  id: string
  scores365Id?: number
  name: string
  shortName: string
  code: string
  country: string
  city: string
  stadium: string
  teamType: 'club' | 'national_team'
  currentLeagueId: string
  baseRating: number
  ratingSource: string
  primaryColor: string
  secondaryColor: string
  logoUrl?: string
}

export type Match = {
  id: string
  scores365Id?: number
  competitionId: string
  season: number
  round: number
  kickoff: string
  venue: string
  homeTeamId: string
  awayTeamId: string
  status: MatchStatus
  homeGoals?: number
  awayGoals?: number
  isNeutral: boolean
  statusText?: string
  statusGroup?: number
}

export type TeamMatchRecord = {
  matchId: string
  date: string
  competitionId: string
  season?: number
  opponentId: string
  opponentRating: number
  homeAway: HomeAway
  teamGoals: number
  opponentGoals: number
  shotsFor?: number
  shotsAgainst?: number
  shotsOnTargetFor?: number
  shotsOnTargetAgainst?: number
  xgFor?: number
  xgAgainst?: number
  cornersFor?: number
  cornersAgainst?: number
  yellowCardsFor?: number
  yellowCardsAgainst?: number
  redCardsFor?: number
  redCardsAgainst?: number
  restDays?: number
}

export type TeamMetrics = {
  matches: number
  pointsPerMatch: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  cleanSheetRate: number
  opponentStrength: number
  dataCoverage: number
  formScore: number
  xgFor: number
  xgAgainst: number
  shotsOnTargetFor: number
  shotsOnTargetAgainst: number
  cornersFor: number
  cornersAgainst: number
}

export type TeamForecast = {
  team: Team
  rating: number
  prevSeasonMetrics: TeamMetrics
  seasonMetrics: TeamMetrics
  recentMetrics: TeamMetrics
  shortFormMetrics: TeamMetrics
  homeMetrics: TeamMetrics
  awayMetrics: TeamMetrics
  venueMetrics: TeamMetrics
  homeAdvantageCoeff: number
  h2hBalance: number
  attackIndex: number
  defenseIndex: number
  attackRating: number
  defenseRating: number
  momentumRating: number
  scheduleStrength: number
  expectedGoals: number
}

export type ScoreProbability = {
  homeGoals: number
  awayGoals: number
  probability: number
}

export type ResultProbabilities = {
  home: number
  draw: number
  away: number
}

export type BettingMarketCategory =
  | 'resultado'
  | 'dupla-chance'
  | 'gols'
  | 'ambas'
  | 'escanteios'

export type BettingMarket = {
  key: string
  category: BettingMarketCategory
  label: string
  selection: string
  probability: number
  edge: 'alto' | 'medio' | 'baixo'
  detail: string
  reliability: number
}

export type PredictionFactors = {
  attackEdge: number
  defenseEdge: number
  momentumEdge: number
  ratingEdge: number
  scheduleEdge: number
  homeAdvantage: number
}

export type MatchPrediction = {
  id: string
  match: Match
  engineVersion: string
  generatedAt: string
  home: TeamForecast
  away: TeamForecast
  probabilities: ResultProbabilities
  likelyScores: ScoreProbability[]
  predictedHomeGoals: number
  predictedAwayGoals: number
  predictedResult: 'home' | 'draw' | 'away'
  confidence: number
  upsetRisk: 'baixo' | 'medio' | 'alto'
  dataCoverage: number
  factors: PredictionFactors
  analysis: string[]
  expectedTotalGoals: number
  expectedCorners: number
  bttsProbability: number
  markets: BettingMarket[]
}