import type { BettingMarket, ResultProbabilities, TeamForecast } from './types'

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const round1 = (value: number) => Number(value.toFixed(1))
const toPct = (value: number) => Math.round(clamp(value, 0, 1) * 100)

const factorial = (value: number) => {
  let result = 1
  for (let current = 2; current <= value; current += 1) result *= current
  return result
}

const poisson = (lambda: number, goals: number) => (Math.exp(-lambda) * lambda ** goals) / factorial(goals)

// P(total >= threshold) para um Poisson de media lambda
const poissonAtLeast = (lambda: number, threshold: number) => {
  let below = 0
  for (let goals = 0; goals < threshold; goals += 1) below += poisson(lambda, goals)
  return clamp(1 - below, 0, 1)
}

// Media de escanteios por equipe na Serie B quando nao ha dados avancados
const LEAGUE_CORNERS_PER_TEAM = 5

const edgeFrom = (probability: number, reliability: number): BettingMarket['edge'] => {
  if (reliability < 0.35) return 'baixo'
  if (probability >= 0.68) return 'alto'
  if (probability >= 0.58) return 'medio'
  return 'baixo'
}

type MarketBundle = {
  markets: BettingMarket[]
  expectedTotalGoals: number
  expectedCorners: number
  bttsProbability: number
}

export const buildMarkets = (
  matchId: string,
  homeExpected: number,
  awayExpected: number,
  home: TeamForecast,
  away: TeamForecast,
  probabilities: ResultProbabilities,
): MarketBundle => {
  const markets: BettingMarket[] = []
  const lambdaTotal = homeExpected + awayExpected
  const expectedTotalGoals = round1(lambdaTotal)

  const homeName = home.team.shortName
  const awayName = away.team.shortName

  // ---------- Resultado (1X2) ----------
  const resultEntries = [
    { selection: `${homeName} vence`, probability: probabilities.home / 100 },
    { selection: 'Empate', probability: probabilities.draw / 100 },
    { selection: `${awayName} vence`, probability: probabilities.away / 100 },
  ].sort((first, second) => second.probability - first.probability)
  const bestResult = resultEntries[0]
  markets.push({
    key: `${matchId}-resultado`,
    category: 'resultado',
    label: 'Resultado final (1X2)',
    selection: bestResult.selection,
    probability: toPct(bestResult.probability),
    edge: edgeFrom(bestResult.probability, 1),
    detail: `Mandante ${probabilities.home}% / empate ${probabilities.draw}% / visitante ${probabilities.away}%`,
    reliability: 1,
  })

  // ---------- Dupla chance ----------
  const doubleChance = [
    { selection: `${homeName} ou empate (1X)`, probability: (probabilities.home + probabilities.draw) / 100 },
    { selection: `${homeName} ou ${awayName} (12)`, probability: (probabilities.home + probabilities.away) / 100 },
    { selection: `Empate ou ${awayName} (X2)`, probability: (probabilities.draw + probabilities.away) / 100 },
  ].sort((first, second) => second.probability - first.probability)
  const bestDouble = doubleChance[0]
  markets.push({
    key: `${matchId}-dupla-chance`,
    category: 'dupla-chance',
    label: 'Dupla chance',
    selection: bestDouble.selection,
    probability: toPct(bestDouble.probability),
    edge: edgeFrom(bestDouble.probability, 1),
    detail: 'Cobre dois dos tres resultados possiveis',
    reliability: 1,
  })

  // ---------- Total de gols (Over/Under) ----------
  const goalLines = [1.5, 2.5, 3.5]
  const goalCandidates = goalLines.flatMap((line) => {
    const overProbability = poissonAtLeast(lambdaTotal, Math.ceil(line))
    return [
      { line, selection: `Mais de ${line} gols`, probability: overProbability },
      { line, selection: `Menos de ${line} gols`, probability: 1 - overProbability },
    ]
  }).sort((first, second) => second.probability - first.probability)
  const bestGoals = goalCandidates[0]
  markets.push({
    key: `${matchId}-gols`,
    category: 'gols',
    label: 'Total de gols',
    selection: bestGoals.selection,
    probability: toPct(bestGoals.probability),
    edge: edgeFrom(bestGoals.probability, 1),
    detail: `Projecao Orion: ${expectedTotalGoals} gols na partida`,
    reliability: 1,
  })

  // ---------- Ambas marcam (BTTS) ----------
  const homeScores = 1 - poisson(homeExpected, 0)
  const awayScores = 1 - poisson(awayExpected, 0)
  const bttsYes = clamp(homeScores * awayScores, 0, 1)
  const bttsEntries = [
    { selection: 'Ambas marcam: Sim', probability: bttsYes },
    { selection: 'Ambas marcam: Nao', probability: 1 - bttsYes },
  ].sort((first, second) => second.probability - first.probability)
  const bestBtts = bttsEntries[0]
  markets.push({
    key: `${matchId}-ambas`,
    category: 'ambas',
    label: 'Ambas equipes marcam',
    selection: bestBtts.selection,
    probability: toPct(bestBtts.probability),
    edge: edgeFrom(bestBtts.probability, 1),
    detail: `${homeName} marca ${toPct(homeScores)}% / ${awayName} marca ${toPct(awayScores)}%`,
    reliability: 1,
  })

  // ---------- Escanteios ----------
  const coverage = clamp((home.recentMetrics.dataCoverage + away.recentMetrics.dataCoverage) / 2, 0, 1)
  const blendCorner = (raw: number) =>
    raw > 0 ? raw * coverage + LEAGUE_CORNERS_PER_TEAM * (1 - coverage) : LEAGUE_CORNERS_PER_TEAM
  const homeCorners = blendCorner((home.recentMetrics.cornersFor + away.recentMetrics.cornersAgainst) / 2)
  const awayCorners = blendCorner((away.recentMetrics.cornersFor + home.recentMetrics.cornersAgainst) / 2)
  const lambdaCorners = clamp(homeCorners + awayCorners, 4, 16)
  const expectedCorners = round1(lambdaCorners)
  const cornerLines = [8.5, 9.5, 10.5]
  const cornerCandidates = cornerLines.flatMap((line) => {
    const overProbability = poissonAtLeast(lambdaCorners, Math.ceil(line))
    return [
      { line, selection: `Mais de ${line} escanteios`, probability: overProbability },
      { line, selection: `Menos de ${line} escanteios`, probability: 1 - overProbability },
    ]
  }).sort((first, second) => second.probability - first.probability)
  const bestCorner = cornerCandidates[0]
  markets.push({
    key: `${matchId}-escanteios`,
    category: 'escanteios',
    label: 'Total de escanteios',
    selection: bestCorner.selection,
    probability: toPct(bestCorner.probability),
    edge: edgeFrom(bestCorner.probability, coverage),
    detail:
      coverage >= 0.35
        ? `Projecao Orion: ${expectedCorners} escanteios na partida`
        : `Projecao aproximada (${Math.round(coverage * 100)}% de cobertura de dados)`,
    reliability: round1(coverage),
  })

  return {
    markets,
    expectedTotalGoals,
    expectedCorners,
    bttsProbability: toPct(bttsYes),
  }
}
