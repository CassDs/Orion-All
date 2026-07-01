import type {
  Match,
  MatchPrediction,
  ResultProbabilities,
  ScoreProbability,
  Team,
  TeamForecast,
  TeamMatchRecord,
  TeamMetrics,
} from './types'
import { buildMarkets } from './betting'

export const ORION_ENGINE_VERSION = 'orion-club-v0.9'
const HOME_ADVANTAGE_GOALS = 0.22
const CURRENT_SEASON = 2026

type ForecastOptions = {
  cutoffDate?: string
  venue?: 'home' | 'away' | 'neutral'
  opponentId?: string
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const roundTo = (value: number, precision = 2) => Number(value.toFixed(precision))

const toRating = (value: number) => Math.round(clamp(value, 0, 1) * 100)

const pointsFrom = (record: TeamMatchRecord) => {
  if (record.teamGoals > record.opponentGoals) return 3
  if (record.teamGoals === record.opponentGoals) return 1
  return 0
}

const resultScoreFrom = (record: TeamMatchRecord) => pointsFrom(record) / 3

const sortRecent = (records: TeamMatchRecord[]) =>
  [...records].sort((first, second) => new Date(second.date).getTime() - new Date(first.date).getTime())

const seasonFromRecord = (record: TeamMatchRecord) => record.season ?? new Date(record.date).getUTCFullYear()

const recordsBefore = (records: TeamMatchRecord[], cutoffDate?: string) => {
  if (!cutoffDate) return records
  const cutoff = new Date(cutoffDate).getTime()
  return records.filter((record) => new Date(record.date).getTime() < cutoff)
}

const metricsOrFallback = (records: TeamMatchRecord[], fallback: TeamMetrics) =>
  records.length > 0 ? calculateMetrics(records) : fallback

const weightedMetric = (
  prevSeason: TeamMetrics,
  season: TeamMetrics,
  recent: TeamMetrics,
  shortForm: TeamMetrics,
  key: keyof Pick<TeamMetrics, 'goalsFor' | 'goalsAgainst' | 'formScore' | 'xgFor' | 'xgAgainst' | 'shotsOnTargetFor' | 'shotsOnTargetAgainst' | 'cornersFor' | 'cornersAgainst'>,
) => prevSeason[key] * 0.15 + season[key] * 0.35 + recent[key] * 0.3 + shortForm[key] * 0.2

const h2hBalanceFrom = (records: TeamMatchRecord[], opponentId?: string) => {
  if (!opponentId) return 0
  const h2hRecords = sortRecent(records.filter((record) => record.opponentId === opponentId)).slice(0, 5)
  if (h2hRecords.length < 3) return 0

  const balance = h2hRecords.reduce((total, record) => {
    if (record.teamGoals > record.opponentGoals) return total + 1
    if (record.teamGoals < record.opponentGoals) return total - 1
    return total
  }, 0) / h2hRecords.length

  return roundTo(clamp(balance, -1, 1))
}

const expectedScoreFromRatings = (teamRating: number, opponentRating: number) =>
  1 / (1 + 10 ** ((opponentRating - teamRating) / 400))

const calculateScheduleStrength = (records: TeamMatchRecord[]) => {
  if (records.length === 0) return 0

  const average = records.reduce((total, record) => {
    return total + clamp((record.opponentRating - 1350) / 450, 0, 1)
  }, 0) / records.length

  return roundTo(average)
}

export const calculateMetrics = (records: TeamMatchRecord[]): TeamMetrics => {
  if (records.length === 0) {
    return {
      matches: 0,
      pointsPerMatch: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      cleanSheetRate: 0,
      opponentStrength: 0,
      dataCoverage: 0,
      formScore: 0,
      xgFor: 0,
      xgAgainst: 0,
      shotsOnTargetFor: 0,
      shotsOnTargetAgainst: 0,
      cornersFor: 0,
      cornersAgainst: 0,
    }
  }

  const totals = records.reduce(
    (accumulator, record) => {
      accumulator.points += pointsFrom(record)
      accumulator.goalsFor += record.teamGoals
      accumulator.goalsAgainst += record.opponentGoals
      accumulator.cleanSheets += record.opponentGoals === 0 ? 1 : 0
      accumulator.opponentRating += record.opponentRating

      if (typeof record.xgFor === 'number') {
        accumulator.advancedMatches += 1
        accumulator.xgFor += record.xgFor
        accumulator.xgAgainst += record.xgAgainst ?? 0
        accumulator.shotsOnTargetFor += record.shotsOnTargetFor ?? 0
        accumulator.shotsOnTargetAgainst += record.shotsOnTargetAgainst ?? 0
        accumulator.cornersFor += record.cornersFor ?? 0
        accumulator.cornersAgainst += record.cornersAgainst ?? 0
      }

      return accumulator
    },
    {
      points: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      cleanSheets: 0,
      opponentRating: 0,
      advancedMatches: 0,
      xgFor: 0,
      xgAgainst: 0,
      shotsOnTargetFor: 0,
      shotsOnTargetAgainst: 0,
      cornersFor: 0,
      cornersAgainst: 0,
    },
  )

  const divisor = records.length
  const advancedDivisor = totals.advancedMatches || 1
  const pointsPerMatch = totals.points / divisor
  const goalsFor = totals.goalsFor / divisor
  const goalsAgainst = totals.goalsAgainst / divisor
  const goalDifference = goalsFor - goalsAgainst
  const cleanSheetRate = totals.cleanSheets / divisor
  const opponentStrength = clamp(((totals.opponentRating / divisor) - 1350) / 450, 0, 1)
  const xgFor = totals.xgFor / advancedDivisor
  const xgAgainst = totals.xgAgainst / advancedDivisor
  const shotsOnTargetFor = totals.shotsOnTargetFor / advancedDivisor
  const shotsOnTargetAgainst = totals.shotsOnTargetAgainst / advancedDivisor
  const cornersFor = totals.cornersFor / advancedDivisor
  const cornersAgainst = totals.cornersAgainst / advancedDivisor
  const xgDifferenceScore = clamp((xgFor - xgAgainst + 1.2) / 2.4, 0, 1)
  const shotTargetScore = clamp((shotsOnTargetFor - shotsOnTargetAgainst + 2) / 5, 0, 1)
  const cornerScore = clamp((cornersFor - cornersAgainst + 2) / 6, 0, 1)
  const dataCoverage = totals.advancedMatches / divisor
  const formScore = clamp(
    pointsPerMatch / 3 * 0.34 +
      clamp((goalDifference + 1.8) / 3.6, 0, 1) * 0.2 +
      clamp(goalsFor / 2.5, 0, 1) * 0.12 +
      cleanSheetRate * 0.1 +
      opponentStrength * 0.08 +
      xgDifferenceScore * 0.09 * dataCoverage +
      shotTargetScore * 0.05 * dataCoverage +
      cornerScore * 0.02 * dataCoverage,
    0,
    1,
  )

  return {
    matches: records.length,
    pointsPerMatch: roundTo(pointsPerMatch),
    goalsFor: roundTo(goalsFor),
    goalsAgainst: roundTo(goalsAgainst),
    goalDifference: roundTo(goalDifference),
    cleanSheetRate: roundTo(cleanSheetRate),
    opponentStrength: roundTo(opponentStrength),
    dataCoverage: roundTo(dataCoverage),
    formScore: roundTo(formScore),
    xgFor: roundTo(xgFor),
    xgAgainst: roundTo(xgAgainst),
    shotsOnTargetFor: roundTo(shotsOnTargetFor),
    shotsOnTargetAgainst: roundTo(shotsOnTargetAgainst),
    cornersFor: roundTo(cornersFor),
    cornersAgainst: roundTo(cornersAgainst),
  }
}

const calculateClubRating = (team: Team, records: TeamMatchRecord[]) => {
  const scheduleStrength = calculateScheduleStrength(records)
  const adjustment = records.reduce((total, record) => {
    const expected = expectedScoreFromRatings(team.baseRating, record.opponentRating)
    const result = resultScoreFrom(record)
    const goalImpact = clamp((record.teamGoals - record.opponentGoals) / 3, -1, 1) * 8
    const venueImpact = record.homeAway === 'away' ? 3 : record.homeAway === 'home' ? -1 : 0

    return total + (result - expected) * 28 + goalImpact + venueImpact
  }, 0)

  return Math.round(clamp(team.baseRating + adjustment + scheduleStrength * 36, 1250, 1800))
}

export const forecastTeam = (team: Team, records: TeamMatchRecord[], options: ForecastOptions = {}): TeamForecast => {
  const eligibleRecords = recordsBefore(records, options.cutoffDate)
  const recent = sortRecent(eligibleRecords)
  const currentSeasonRecords = eligibleRecords.filter((record) => seasonFromRecord(record) === CURRENT_SEASON)
  const prevSeasonRecords = eligibleRecords.filter((record) => seasonFromRecord(record) < CURRENT_SEASON)
  const seasonBaseMetrics = calculateMetrics(currentSeasonRecords)
  const prevSeasonMetrics = metricsOrFallback(prevSeasonRecords, seasonBaseMetrics)
  const seasonMetrics = metricsOrFallback(currentSeasonRecords, prevSeasonMetrics)
  const recentMetrics = calculateMetrics(recent.slice(0, 10))
  const shortFormMetrics = calculateMetrics(recent.slice(0, 5))
  const homeMetrics = metricsOrFallback(eligibleRecords.filter((record) => record.homeAway === 'home'), seasonMetrics)
  const awayMetrics = metricsOrFallback(eligibleRecords.filter((record) => record.homeAway === 'away'), seasonMetrics)
  const venueMetrics =
    options.venue === 'home' ? homeMetrics : options.venue === 'away' ? awayMetrics : seasonMetrics
  const rating = calculateClubRating(team, recent.slice(0, 12))
  const scheduleStrength = calculateScheduleStrength(recent.slice(0, 10))
  const dataCoverage = Math.max(recentMetrics.dataCoverage, shortFormMetrics.dataCoverage)
  const temporalAttack = weightedMetric(prevSeasonMetrics, seasonMetrics, recentMetrics, shortFormMetrics, 'goalsFor')
  const temporalDefense = weightedMetric(prevSeasonMetrics, seasonMetrics, recentMetrics, shortFormMetrics, 'goalsAgainst')
  const venueAttack = venueMetrics.goalsFor
  const venueDefense = venueMetrics.goalsAgainst
  const weightedAttack = temporalAttack * 0.72 + venueAttack * 0.28
  const weightedDefense = temporalDefense * 0.72 + venueDefense * 0.28
  const advancedAttack =
    (weightedMetric(prevSeasonMetrics, seasonMetrics, recentMetrics, shortFormMetrics, 'xgFor') * 0.58 +
      weightedMetric(prevSeasonMetrics, seasonMetrics, recentMetrics, shortFormMetrics, 'shotsOnTargetFor') * 0.1 +
      weightedMetric(prevSeasonMetrics, seasonMetrics, recentMetrics, shortFormMetrics, 'cornersFor') * 0.025) *
    dataCoverage
  const advancedDefense =
    (weightedMetric(prevSeasonMetrics, seasonMetrics, recentMetrics, shortFormMetrics, 'xgAgainst') * 0.58 +
      weightedMetric(prevSeasonMetrics, seasonMetrics, recentMetrics, shortFormMetrics, 'shotsOnTargetAgainst') * 0.1 +
      weightedMetric(prevSeasonMetrics, seasonMetrics, recentMetrics, shortFormMetrics, 'cornersAgainst') * 0.025) *
    dataCoverage
  const h2hBalance = h2hBalanceFrom(eligibleRecords, options.opponentId)
  const attackIndex = clamp(weightedAttack * 0.72 + advancedAttack * 0.24 + Math.max(0, h2hBalance) * 0.08, 0, 3.6)
  const defenseIndex = clamp(weightedDefense * 0.72 + advancedDefense * 0.24 + Math.max(0, -h2hBalance) * 0.08, 0, 3.6)
  const momentum = clamp(
    weightedMetric(prevSeasonMetrics, seasonMetrics, recentMetrics, shortFormMetrics, 'formScore') * 0.76 +
      venueMetrics.formScore * 0.24 +
      h2hBalance * 0.04,
    0,
    1,
  )
  const homeAdvantageCoeff = clamp((homeMetrics.goalsFor - awayMetrics.goalsFor) * 0.12 + (awayMetrics.goalsAgainst - homeMetrics.goalsAgainst) * 0.08, -0.1, 0.18)

  return {
    team,
    rating,
    prevSeasonMetrics,
    seasonMetrics,
    recentMetrics,
    shortFormMetrics,
    homeMetrics,
    awayMetrics,
    venueMetrics,
    homeAdvantageCoeff: roundTo(homeAdvantageCoeff),
    h2hBalance,
    attackIndex: roundTo(attackIndex),
    defenseIndex: roundTo(defenseIndex),
    attackRating: toRating(attackIndex / 2.2),
    defenseRating: toRating(clamp(0.72 - defenseIndex / 3 + recentMetrics.cleanSheetRate * 0.28, 0, 1)),
    momentumRating: toRating(momentum),
    scheduleStrength,
    expectedGoals: 0,
  }
}

const expectedGoalsFor = (team: TeamForecast, opponent: TeamForecast, homeBoost: number) => {
  const advancedFactor = (team.recentMetrics.dataCoverage + opponent.recentMetrics.dataCoverage) / 2
  const ratingEdge = clamp((team.rating - opponent.rating) / 260, -0.55, 0.55)
  const attackBase = team.attackIndex * 0.44
  const defensiveLeak = opponent.defenseIndex * 0.34
  const momentumEdge = (team.momentumRating - opponent.momentumRating) / 100 * 0.24
  const scheduleEdge = (team.scheduleStrength - opponent.scheduleStrength) * 0.12
  const venueEdge = (team.venueMetrics.formScore - opponent.venueMetrics.formScore) * 0.08
  const h2hEdge = team.h2hBalance * 0.04
  const shotEdge =
    (team.recentMetrics.shotsOnTargetFor - opponent.recentMetrics.shotsOnTargetAgainst) * 0.042 * advancedFactor
  const xgEdge = (team.recentMetrics.xgFor - opponent.recentMetrics.xgAgainst) * 0.13 * advancedFactor

  return clamp(
    0.62 + attackBase + defensiveLeak + ratingEdge + momentumEdge + scheduleEdge + venueEdge + h2hEdge + shotEdge + xgEdge + homeBoost,
    0.2,
    4.2,
  )
}

const factorial = (value: number) => {
  if (value <= 1) return 1

  let result = 1
  for (let current = 2; current <= value; current += 1) {
    result *= current
  }

  return result
}

const poisson = (lambda: number, goals: number) => (Math.exp(-lambda) * lambda ** goals) / factorial(goals)

const lowScoreCorrection = (homeGoals: number, awayGoals: number) => {
  if (homeGoals === 0 && awayGoals === 0) return 1.12
  if (homeGoals === 1 && awayGoals === 1) return 1.1
  if ((homeGoals === 1 && awayGoals === 0) || (homeGoals === 0 && awayGoals === 1)) return 1.05
  return 1
}

const calculateScoreProbabilities = (homeExpected: number, awayExpected: number) => {
  const scores: ScoreProbability[] = []
  let home = 0
  let draw = 0
  let away = 0

  for (let homeGoals = 0; homeGoals <= 5; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 5; awayGoals += 1) {
      const rawProbability = poisson(homeExpected, homeGoals) * poisson(awayExpected, awayGoals)
      const correctedProbability = rawProbability * lowScoreCorrection(homeGoals, awayGoals)

      if (homeGoals > awayGoals) home += correctedProbability
      if (homeGoals === awayGoals) draw += correctedProbability
      if (homeGoals < awayGoals) away += correctedProbability

      scores.push({
        homeGoals,
        awayGoals,
        probability: correctedProbability,
      })
    }
  }

  const total = home + draw + away || 1
  const probabilities: ResultProbabilities = {
    home: Math.round((home / total) * 100),
    draw: Math.round((draw / total) * 100),
    away: Math.round((away / total) * 100),
  }
  const likelyScores = [...scores]
    .map((score) => ({ ...score, probability: roundTo((score.probability / total) * 100, 1) }))
    .sort((first, second) => second.probability - first.probability)
  const bestScoreByResult = {
    home: likelyScores.find((score) => score.homeGoals > score.awayGoals) ?? { homeGoals: 1, awayGoals: 0, probability: 0 },
    draw: likelyScores.find((score) => score.homeGoals === score.awayGoals) ?? { homeGoals: 0, awayGoals: 0, probability: 0 },
    away: likelyScores.find((score) => score.homeGoals < score.awayGoals) ?? { homeGoals: 0, awayGoals: 1, probability: 0 },
  }

  return { probabilities, likelyScores: likelyScores.slice(0, 4), bestScoreByResult }
}

const riskFrom = (confidence: number, probabilities: ResultProbabilities) => {
  const favoriteProbability = Math.max(probabilities.home, probabilities.draw, probabilities.away)

  if (confidence < 57 || favoriteProbability < 41) return 'alto'
  if (confidence < 67 || favoriteProbability < 51) return 'medio'
  return 'baixo'
}

const winnerName = (prediction: Pick<MatchPrediction, 'predictedResult' | 'home' | 'away'>) => {
  if (prediction.predictedResult === 'draw') return 'Empate'
  return prediction.predictedResult === 'home' ? prediction.home.team.name : prediction.away.team.name
}

const formatMetric = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

export const predictMatch = (
  match: Match,
  teams: Team[],
  recordsByTeam: Record<string, TeamMatchRecord[]>,
): MatchPrediction => {
  const homeTeam = teams.find((team) => team.id === match.homeTeamId)
  const awayTeam = teams.find((team) => team.id === match.awayTeamId)

  if (!homeTeam || !awayTeam) {
    throw new Error(`Missing teams for match: ${match.id}`)
  }

  const cutoffDate = match.status === 'finished' ? match.kickoff : undefined
  const home = forecastTeam(homeTeam, recordsByTeam[homeTeam.id] ?? [], {
    cutoffDate,
    venue: match.isNeutral ? 'neutral' : 'home',
    opponentId: awayTeam.id,
  })
  const away = forecastTeam(awayTeam, recordsByTeam[awayTeam.id] ?? [], {
    cutoffDate,
    venue: match.isNeutral ? 'neutral' : 'away',
    opponentId: homeTeam.id,
  })
  const homeBoost = match.isNeutral ? 0 : HOME_ADVANTAGE_GOALS + home.homeAdvantageCoeff
  const awayBoost = 0
  const homeExpected = expectedGoalsFor(home, away, homeBoost)
  const awayExpected = expectedGoalsFor(away, home, awayBoost)
  const scoreModel = calculateScoreProbabilities(homeExpected, awayExpected)
  const ratingExpectation = expectedScoreFromRatings(home.rating, away.rating)
  const ratingSeparation = Math.abs(ratingExpectation - 0.5)
  const ratingDraw = clamp(0.29 - 0.56 * ratingSeparation, 0.07, 0.29)
  const ratingHome = (1 - ratingDraw) * ratingExpectation
  const ratingAway = (1 - ratingDraw) * (1 - ratingExpectation)
  const blendHome = ratingHome * 0.6 + (scoreModel.probabilities.home / 100) * 0.4
  const blendDraw = ratingDraw * 0.6 + (scoreModel.probabilities.draw / 100) * 0.4
  const blendAway = ratingAway * 0.6 + (scoreModel.probabilities.away / 100) * 0.4
  const blendTotal = blendHome + blendDraw + blendAway || 1
  const homeProbability = blendHome / blendTotal
  const drawProbability = blendDraw / blendTotal
  const awayProbability = blendAway / blendTotal
  const probabilities = {
    home: Math.round(homeProbability * 100),
    draw: Math.round(drawProbability * 100),
    away: Math.round(awayProbability * 100),
  }
  const predictedResult: MatchPrediction['predictedResult'] =
    drawProbability >= 0.27 ? 'draw' : homeProbability > awayProbability ? 'home' : 'away'
  const displayScore = scoreModel.bestScoreByResult[predictedResult]
  const predictedProbability =
    predictedResult === 'home' ? homeProbability : predictedResult === 'away' ? awayProbability : drawProbability
  const confidence = Math.round(clamp(predictedProbability * 100, 50, 94))

  home.expectedGoals = roundTo(homeExpected)
  away.expectedGoals = roundTo(awayExpected)

  const marketBundle = buildMarkets(match.id, homeExpected, awayExpected, home, away, probabilities)

  const prediction: MatchPrediction = {
    id: `${ORION_ENGINE_VERSION}-${match.id}`,
    match,
    engineVersion: ORION_ENGINE_VERSION,
    generatedAt: new Date().toISOString(),
    home,
    away,
    probabilities,
    likelyScores: scoreModel.likelyScores,
    predictedHomeGoals: displayScore.homeGoals,
    predictedAwayGoals: displayScore.awayGoals,
    predictedResult,
    confidence,
    upsetRisk: riskFrom(confidence, probabilities),
    dataCoverage: roundTo((home.recentMetrics.dataCoverage + away.recentMetrics.dataCoverage) / 2),
    factors: {
      attackEdge: home.attackRating - away.attackRating,
      defenseEdge: home.defenseRating - away.defenseRating,
      momentumEdge: home.momentumRating - away.momentumRating,
      ratingEdge: home.rating - away.rating,
      scheduleEdge: roundTo(home.scheduleStrength - away.scheduleStrength),
      homeAdvantage: roundTo(homeBoost),
    },
    analysis: [],
    expectedTotalGoals: marketBundle.expectedTotalGoals,
    expectedCorners: marketBundle.expectedCorners,
    bttsProbability: marketBundle.bttsProbability,
    markets: marketBundle.markets,
  }

  prediction.analysis = [
    `${winnerName(prediction)} aparece como leitura principal: ${probabilities.home}% mandante / ${probabilities.draw}% empate / ${probabilities.away}% visitante.`,
    `${home.team.shortName} chega com rating ${home.rating}, ataque ${home.attackRating}/100 e momento ${home.momentumRating}/100.`,
    `${away.team.shortName} chega com rating ${away.rating}, ataque ${away.attackRating}/100 e momento ${away.momentumRating}/100.`,
    `O xG Orion projeta ${formatMetric(home.expectedGoals)} x ${formatMetric(away.expectedGoals)}, ja incluindo ${match.isNeutral ? 'campo neutro' : `mando especifico de ${formatMetric(home.homeAdvantageCoeff)}`} para o jogo.`,
    `Coeficiente v2: temporada anterior ${home.prevSeasonMetrics.matches}/${away.prevSeasonMetrics.matches} jogos, temporada atual ${home.seasonMetrics.matches}/${away.seasonMetrics.matches}, ultimos 10 e ultimos 5 com corte temporal quando o jogo ja ocorreu.`,
    `H2H recente: ${home.team.shortName} ${formatMetric(home.h2hBalance)} x ${away.team.shortName} ${formatMetric(away.h2hBalance)}; dados avancados cobrem ${Math.round(prediction.dataCoverage * 100)}% da amostra recente.`,
  ]

  return prediction
}

export const predictMatches = (matches: Match[], teams: Team[], recordsByTeam: Record<string, TeamMatchRecord[]>) =>
  matches.map((match) => predictMatch(match, teams, recordsByTeam))