import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import './App.css'
import {
  matches as fallbackMatches,
  recordsByTeam as fallbackRecordsByTeam,
  serieBCompetition as fallbackCompetition,
  teams as fallbackTeams,
} from './data/serieBMock'
import { predictMatch } from './domain/prediction'
import type { Match, MatchPrediction, Team, TeamMatchRecord } from './domain/types'
import { competitionLogoUrl, fetchLeagueData365, LEAGUES_365, type LeagueData } from './services/scores365'
import { getOrCreateFrozenPredictions } from './services/predictionStore'

const AUTH_FLAG_KEY = 'orion-authenticated'
const ACCESS_KEYWORD = 'Betania'

const availableLeagues = LEAGUES_365.map((league) => ({
  id: league.id,
  name: league.name,
  country: league.country,
  season: 2026,
  tagline: league.tagline,
  logoUrl: competitionLogoUrl(league.scores365Id),
  primaryColor: league.primaryColor,
  secondaryColor: league.secondaryColor,
  accentColor: league.accentColor,
}))

type LoadState = 'idle' | 'loading' | 'ready' | 'fallback' | 'error'

type StandingRow = {
  team: Team
  played: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  points: number
}

const fallbackLeagueData: LeagueData = {
  competition: fallbackCompetition,
  teams: fallbackTeams,
  matches: fallbackMatches,
  recordsByTeam: fallbackRecordsByTeam,
  source: 'Fallback local',
}

const dateTime = (value: string) =>
  new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

const decimal = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

const actualResult = (prediction: MatchPrediction): MatchPrediction['predictedResult'] | null => {
  if (typeof prediction.match.homeGoals !== 'number' || typeof prediction.match.awayGoals !== 'number') return null
  if (prediction.match.homeGoals > prediction.match.awayGoals) return 'home'
  if (prediction.match.homeGoals < prediction.match.awayGoals) return 'away'
  return 'draw'
}

const actualResultLabel = (prediction: MatchPrediction) => {
  const result = actualResult(prediction)
  if (!result) return 'Aguardando jogo'
  if (result === 'draw') return 'Empate'
  return result === 'home' ? prediction.home.team.shortName : prediction.away.team.shortName
}

const hitLabel = (hit: boolean) => (hit ? 'Acertou' : 'Errou')

const hitRate = (hits: number, total: number) => (total ? Math.round((hits / total) * 100) : 0)

const resultLabel = (prediction: MatchPrediction) => {
  if (prediction.predictedResult === 'draw') return 'Empate'
  return prediction.predictedResult === 'home' ? prediction.home.team.shortName : prediction.away.team.shortName
}

const favoriteLabel = (prediction: MatchPrediction) => {
  if (prediction.probabilities.draw >= prediction.probabilities.home && prediction.probabilities.draw >= prediction.probabilities.away) {
    return 'Empate'
  }

  return prediction.probabilities.home > prediction.probabilities.away
    ? prediction.home.team.shortName
    : prediction.away.team.shortName
}

const favoriteProbability = (prediction: MatchPrediction) =>
  Math.max(prediction.probabilities.home, prediction.probabilities.draw, prediction.probabilities.away)

const probabilityItems = (prediction: MatchPrediction) => [
  { label: prediction.home.team.code, value: prediction.probabilities.home },
  { label: 'EMP', value: prediction.probabilities.draw },
  { label: prediction.away.team.code, value: prediction.probabilities.away },
]

const marketCategoryLabel: Record<string, string> = {
  resultado: 'Resultado',
  'dupla-chance': 'Dupla chance',
  gols: 'Gols',
  ambas: 'Ambas marcam',
  escanteios: 'Escanteios',
}

const marketScore = (market: MatchPrediction['markets'][number]) => {
  if (market.reliability < 0.35) return market.probability - 24
  if (market.reliability < 0.55) return market.probability - 10
  return market.probability + market.reliability * 6
}

const parseLine = (selection: string) => {
  const match = selection.match(/([\d.]+)/)
  return match ? Number(match[1]) : null
}

// Avalia se o mercado recomendado acertou num jogo ja finalizado (com corte temporal honesto)
const evaluateMarket = (prediction: MatchPrediction, market: MatchPrediction['markets'][number]): boolean | null => {
  const { homeGoals, awayGoals } = prediction.match
  if (typeof homeGoals !== 'number' || typeof awayGoals !== 'number') return null
  const total = homeGoals + awayGoals
  const bothScored = homeGoals > 0 && awayGoals > 0
  const line = parseLine(market.selection)

  switch (market.category) {
    case 'resultado': {
      const actual = homeGoals > awayGoals ? 'home' : homeGoals < awayGoals ? 'away' : 'draw'
      if (market.selection === 'Empate') return actual === 'draw'
      if (market.selection.includes(prediction.home.team.shortName)) return actual === 'home'
      return actual === 'away'
    }
    case 'dupla-chance': {
      const actual = homeGoals > awayGoals ? 'home' : homeGoals < awayGoals ? 'away' : 'draw'
      if (market.selection.includes('1X')) return actual !== 'away'
      if (market.selection.includes('12')) return actual !== 'draw'
      return actual !== 'home'
    }
    case 'gols':
      if (line == null) return null
      return market.selection.startsWith('Mais') ? total > line : total < line
    case 'ambas':
      return market.selection.includes('Sim') ? bothScored : !bothScored
    case 'escanteios':
      return null
    default:
      return null
  }
}

const marketAccuracyFor = (predictions: MatchPrediction[], category: string) => {
  let hits = 0
  let total = 0
  for (const prediction of predictions) {
    const market = (prediction.markets ?? []).find((entry) => entry.category === category)
    if (!market) continue
    const outcome = evaluateMarket(prediction, market)
    if (outcome === null) continue
    total += 1
    if (outcome) hits += 1
  }
  return { hits, total, rate: total ? Math.round((hits / total) * 100) : 0 }
}

const teamInitials = (team: Team) => team.code.slice(0, 3).toUpperCase()

const TeamBadge = ({ team, size = 'md' }: { team: Team; size?: 'sm' | 'md' | 'lg' }) => (
  <span
    className={`team-badge ${size}`}
    style={{ '--team-color': team.primaryColor } as CSSProperties}
    title={team.name}
  >
    {team.logoUrl ? <img src={team.logoUrl} alt="" /> : <b>{teamInitials(team)}</b>}
  </span>
)

const MatchScoreBanner = ({
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  label,
  subtitle,
  compact = false,
}: {
  homeTeam: Team
  awayTeam: Team
  homeScore: number
  awayScore: number
  label: string
  subtitle?: string
  compact?: boolean
}) => (
  <div className={`match-score-banner ${compact ? 'compact' : ''}`} aria-label={`${label}: ${homeTeam.shortName} ${homeScore} a ${awayScore} ${awayTeam.shortName}`}>
    <div className="match-score-team home">
      <span className="match-score-name">{homeTeam.shortName}</span>
      <TeamBadge team={homeTeam} size={compact ? 'sm' : 'md'} />
    </div>

    <div className="match-score-center">
      <small>{label}</small>
      <strong>
        <span>{homeScore}</span>
        <b>-</b>
        <span>{awayScore}</span>
      </strong>
      {subtitle ? <span className="match-score-subtitle">{subtitle}</span> : null}
    </div>

    <div className="match-score-team away">
      <TeamBadge team={awayTeam} size={compact ? 'sm' : 'md'} />
      <span className="match-score-name">{awayTeam.shortName}</span>
    </div>
  </div>
)

const buildStandings = (teams: Team[], matches: Match[]): StandingRow[] => {
  const table = new Map<string, StandingRow>()
  for (const team of teams) {
    table.set(team.id, {
      team,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
    })
  }

  for (const match of matches) {
    if (typeof match.homeGoals !== 'number' || typeof match.awayGoals !== 'number') continue

    const home = table.get(match.homeTeamId)
    const away = table.get(match.awayTeamId)
    if (!home || !away) continue

    home.played += 1
    away.played += 1
    home.goalsFor += match.homeGoals
    home.goalsAgainst += match.awayGoals
    away.goalsFor += match.awayGoals
    away.goalsAgainst += match.homeGoals

    if (match.homeGoals > match.awayGoals) {
      home.wins += 1
      away.losses += 1
      home.points += 3
    } else if (match.homeGoals < match.awayGoals) {
      away.wins += 1
      home.losses += 1
      away.points += 3
    } else {
      home.draws += 1
      away.draws += 1
      home.points += 1
      away.points += 1
    }
  }

  return [...table.values()].sort((first, second) => {
    const pointDiff = second.points - first.points
    if (pointDiff !== 0) return pointDiff
    const firstGoalDiff = first.goalsFor - first.goalsAgainst
    const secondGoalDiff = second.goalsFor - second.goalsAgainst
    if (secondGoalDiff !== firstGoalDiff) return secondGoalDiff - firstGoalDiff
    return second.goalsFor - first.goalsFor
  })
}

const freezePredictions = async (
  leagueId: string,
  matches: Match[],
  teams: Team[],
  recordsByTeam: Record<string, TeamMatchRecord[]>,
  currentRound: number,
) => getOrCreateFrozenPredictions(
  leagueId,
  matches,
  (match) => predictMatch(match, teams, recordsByTeam),
  (match) => match.round <= currentRound,
)

const currentRoundFrom = (matches: Match[]) => {
  const orderedMatches = [...matches].sort((first, second) => new Date(first.kickoff).getTime() - new Date(second.kickoff).getTime())
  const now = Date.now()
  const nextMatch = orderedMatches.find((match) => new Date(match.kickoff).getTime() >= now)

  if (nextMatch) return nextMatch.round

  return orderedMatches.at(-1)?.round ?? 1
}

const predictionScopeFrom = (matches: Match[], currentRound: number) =>
  matches.filter((match) => match.round <= currentRound)

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() =>
    typeof window !== 'undefined' ? window.localStorage.getItem(AUTH_FLAG_KEY) === '1' : false,
  )
  const [accessKey, setAccessKey] = useState('')
  const [loginError, setLoginError] = useState('')
  const [selectedLeagueId, setSelectedLeagueId] = useState('')
  const [leagueData, setLeagueData] = useState<LeagueData | null>(null)
  const [predictions, setPredictions] = useState<MatchPrediction[]>([])
  const [selectedRound, setSelectedRound] = useState(1)
  const [selectedPredictionId, setSelectedPredictionId] = useState('')
  const [isBetsCollapsed, setIsBetsCollapsed] = useState(false)
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [syncMessage, setSyncMessage] = useState('Escolha uma liga para iniciar')
  const activeLeagueRef = useRef('')

  const handleLogin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (accessKey.trim() !== ACCESS_KEYWORD) {
      setLoginError('Palavra-chave invalida. Verifique o acesso autorizado.')
      return
    }

    window.localStorage.setItem(AUTH_FLAG_KEY, '1')
    setLoginError('')
    setIsAuthenticated(true)
  }

  const handleLogout = () => {
    window.localStorage.removeItem(AUTH_FLAG_KEY)
    activeLeagueRef.current = ''
    setSelectedLeagueId('')
    setLeagueData(null)
    setPredictions([])
    setAccessKey('')
    setIsAuthenticated(false)
  }

  const handleBackToLeagues = () => {
    activeLeagueRef.current = ''
    setSelectedLeagueId('')
    setLeagueData(null)
    setPredictions([])
    setSelectedPredictionId('')
    setSelectedRound(1)
    setLoadState('idle')
    setSyncMessage('Escolha uma liga para iniciar')
  }

  const handleScoresSync = useCallback(async () => {
    if (!selectedLeagueId) return

    const league = LEAGUES_365.find((entry) => entry.id === selectedLeagueId)
    if (!league) return

    // Limpa dados da liga anterior para nao exibir cache enquanto a nova carrega.
    activeLeagueRef.current = league.id
    setLeagueData(null)
    setPredictions([])
    setSelectedPredictionId('')
    setSelectedRound(1)
    setLoadState('loading')
    setSyncMessage(`Carregando ${league.name}...`)

    try {
      const remoteData = await fetchLeagueData365(league)
      if (activeLeagueRef.current !== league.id) return
      const currentRound = currentRoundFrom(remoteData.matches)
      const scopedMatches = predictionScopeFrom(remoteData.matches, currentRound)
      const frozen = await freezePredictions(league.id, scopedMatches, remoteData.teams, remoteData.recordsByTeam, currentRound)
      if (activeLeagueRef.current !== league.id) return
      const focusedPrediction = frozen.find((prediction) => prediction.match.round === currentRound) ?? frozen[0]

      setLeagueData(remoteData)
      setPredictions(frozen)
      setSelectedRound(focusedPrediction?.match.round ?? currentRound)
      setSelectedPredictionId(focusedPrediction?.id ?? '')
      setLoadState('ready')
      setSyncMessage(`${remoteData.matches.length} jogos reais carregados da fonte 365Scores. Prevendo R1-R${currentRound}; futuras abrem rodada a rodada.`)
    } catch (error) {
      if (activeLeagueRef.current !== league.id) return
      if (league.id !== fallbackCompetition.id) {
        setLeagueData(null)
        setPredictions([])
        setLoadState('error')
        setSyncMessage(
          error instanceof Error
            ? `${error.message}. Sem fallback local para ${league.name}.`
            : `Falha ao carregar ${league.name}.`,
        )
        return
      }

      const currentRound = currentRoundFrom(fallbackLeagueData.matches)
      const scopedMatches = predictionScopeFrom(fallbackLeagueData.matches, currentRound)
      const frozen = await freezePredictions(
        fallbackCompetition.id,
        scopedMatches,
        fallbackLeagueData.teams,
        fallbackLeagueData.recordsByTeam,
        currentRound,
      )
      const focusedPrediction = frozen.find((prediction) => prediction.match.round === currentRound) ?? frozen[0]

      setLeagueData(fallbackLeagueData)
      setPredictions(frozen)
      setSelectedRound(focusedPrediction?.match.round ?? currentRound)
      setSelectedPredictionId(focusedPrediction?.id ?? '')
      setLoadState('fallback')
      setSyncMessage(error instanceof Error ? `${error.message}. Usando fallback local.` : 'Usando fallback local.')
    }
  }, [selectedLeagueId])

  useEffect(() => {
    if (!selectedLeagueId) return

    const timer = window.setTimeout(() => {
      void handleScoresSync()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [handleScoresSync, selectedLeagueId])

  const competition = leagueData?.competition ?? fallbackCompetition
  const teams = useMemo(() => leagueData?.teams ?? [], [leagueData])
  const matches = useMemo(() => leagueData?.matches ?? [], [leagueData])
  const currentRound = useMemo(() => currentRoundFrom(matches), [matches])
  const rounds = useMemo(() => [...new Set(predictions.map((prediction) => prediction.match.round))].sort((a, b) => a - b), [predictions])
  const firstRound = rounds[0] ?? 1
  const lastRound = rounds.at(-1) ?? firstRound
  const visiblePredictions = useMemo(
    () => predictions.filter((prediction) => prediction.match.round === selectedRound),
    [predictions, selectedRound],
  )
  const selectedPrediction =
    predictions.find((prediction) => prediction.id === selectedPredictionId) ?? visiblePredictions[0] ?? predictions[0]
  // Acurácia: só predições congeladas no servidor (imutáveis e iguais para todos).
  // Inclui as retroativas do backfill (walk-forward com corte temporal); o subtítulo
  // do KPI mostra quantas foram congeladas antes do kickoff (prova pré-jogo).
  const finishedPredictions = predictions.filter(
    (prediction) => actualResult(prediction) && prediction.frozenSource === 'server',
  )
  const preKickoffFinishedCount = finishedPredictions.filter(
    (prediction) =>
      prediction.frozenAt &&
      new Date(prediction.frozenAt).getTime() < new Date(prediction.match.kickoff).getTime(),
  ).length
  const winnerHits = finishedPredictions.filter((prediction) => prediction.predictedResult === actualResult(prediction)).length
  const scoreHits = finishedPredictions.filter(
    (prediction) =>
      prediction.predictedHomeGoals === prediction.match.homeGoals &&
      prediction.predictedAwayGoals === prediction.match.awayGoals,
  ).length
  const averageConfidence = predictions.length
    ? Math.round(predictions.reduce((total, prediction) => total + prediction.confidence, 0) / predictions.length)
    : 0
  const winnerRate = hitRate(winnerHits, finishedPredictions.length)
  const scoreRate = hitRate(scoreHits, finishedPredictions.length)
  const selectedActualResult = selectedPrediction ? actualResult(selectedPrediction) : null
  const selectedWinnerHit = selectedActualResult ? selectedPrediction.predictedResult === selectedActualResult : false
  const selectedScoreHit = selectedActualResult
    ? selectedPrediction.predictedHomeGoals === selectedPrediction.match.homeGoals &&
      selectedPrediction.predictedAwayGoals === selectedPrediction.match.awayGoals
    : false
  const selectedPredictionIsFrozen = selectedPrediction ? selectedPrediction.match.round <= currentRound : false
  const selectedFavoriteProbability = selectedPrediction ? favoriteProbability(selectedPrediction) : 0
  const standings = useMemo(() => buildStandings(teams, matches).slice(0, 8), [teams, matches])
  const [marketFilter, setMarketFilter] = useState<'todos' | 'gols' | 'ambas' | 'escanteios' | 'resultado' | 'dupla-chance'>('todos')

  const upcomingPredictions = useMemo(
    () => predictions.filter((prediction) => prediction.match.status !== 'finished'),
    [predictions],
  )

  const bestBets = useMemo(() => {
    const entries = upcomingPredictions.flatMap((prediction) =>
      (prediction.markets ?? [])
        .filter((market) => marketFilter === 'todos' || market.category === marketFilter)
        .map((market) => ({ prediction, market })),
    )
    return entries
      .sort((first, second) => {
        const score = (item: typeof first) => marketScore(item.market)
        return score(second) - score(first)
      })
      .slice(0, 12)
  }, [upcomingPredictions, marketFilter])

  const goalsAccuracy = useMemo(() => marketAccuracyFor(finishedPredictions, 'gols'), [finishedPredictions])
  const bttsAccuracy = useMemo(() => marketAccuracyFor(finishedPredictions, 'ambas'), [finishedPredictions])
  const doubleChanceAccuracy = useMemo(() => marketAccuracyFor(finishedPredictions, 'dupla-chance'), [finishedPredictions])
  const selectedMarkets = useMemo(
    () => [...(selectedPrediction?.markets ?? [])].sort((first, second) => marketScore(second) - marketScore(first)),
    [selectedPrediction],
  )
  const topBet = bestBets[0]

  if (!isAuthenticated) {
    return (
      <main className="auth-shell">
        <section className="auth-minimal-panel" aria-label="Acesso ao Orion Prediction">
          <div className="auth-minimal-brand">
            <span className="eyebrow">Orion</span>
            <h1>Orion Prediction</h1>
          </div>

          <div className="login-card minimal">
            <div>
              <h2>Acessar</h2>
            </div>

            <form className="login-form" onSubmit={handleLogin}>
              <label>
                <span>Palavra-chave</span>
                <input
                  type="password"
                  placeholder="Digite a chave de acesso"
                  value={accessKey}
                  onChange={(event) => setAccessKey(event.target.value)}
                />
              </label>
              {loginError && <p className="form-error">{loginError}</p>}
              <button className="login-button" type="submit">Liberar painel</button>
            </form>
          </div>
        </section>
      </main>
    )
  }

  if (!selectedLeagueId) {
    return (
      <main className="league-entry">
        <section className="entry-minimal-hero">
          <h1>Escolha sua liga.</h1>
        </section>

        <section className="league-grid" aria-label="Ligas disponiveis">
          {availableLeagues.map((league) => (
            <button
              className="league-card"
              key={league.id}
              style={
                {
                  '--league-primary': league.primaryColor,
                  '--league-secondary': league.secondaryColor,
                  '--league-accent': league.accentColor,
                } as CSSProperties
              }
              type="button"
              onClick={() => setSelectedLeagueId(league.id)}
            >
              <div className="league-card-header minimal">
                <span className="league-mark">{league.logoUrl && <img src={league.logoUrl} alt="" />}</span>
                <span className="league-copy">
                  <strong>{league.name}</strong>
                  <small>{league.country}</small>
                </span>
              </div>
            </button>
          ))}
        </section>
      </main>
    )
  }

  if (!selectedPrediction) {
    return (
      <main className="loading-shell">
        <section className="loading-panel minimalist">
          <div className="loading-spinner" aria-hidden="true" />
          <h1>{loadState === 'loading' ? 'Carregando liga' : 'Nenhum jogo encontrado'}</h1>
          <p>{loadState === 'loading' ? 'Preparando ambiente Orion' : syncMessage}</p>
        </section>
      </main>
    )
  }

  return (
    <main
      className="app-shell"
      style={
        {
          '--league-primary': competition.primaryColor,
          '--league-secondary': competition.secondaryColor,
          '--league-accent': competition.accentColor,
        } as CSSProperties
      }
    >
      <section className="competition-hero" aria-label="Ambiente da liga">
        <div className="competition-brand">
          <button className="back-button" type="button" onClick={handleBackToLeagues}>Ligas</button>
          <button className="back-button subtle" type="button" onClick={handleLogout}>Sair</button>
          <span className="competition-logo">{competition.logoUrl && <img src={competition.logoUrl} alt="" />}</span>
          <div>
            <span className="eyebrow">{competition.country} | Temporada {competition.season}</span>
            <h1>{competition.name}</h1>
            <p>{competition.tagline}</p>
          </div>
        </div>
      </section>

      <section className="club-strip" aria-label="Clubes da liga">
        <div className="club-marquee">
          {[...teams.slice(0, 20), ...teams.slice(0, 20)].map((team, index) => (
            <span className="club-chip" key={`${team.id}-${index}`}>
              <TeamBadge team={team} size="sm" />
              {team.shortName}
            </span>
          ))}
        </div>
      </section>

      <section className="kpi-grid" aria-label="Indicadores da POC">
        <article>
          <span>Jogos da temporada</span>
          <strong>{matches.length}</strong>
        </article>
        <article>
          <span>Rodada em foco</span>
          <strong>R{currentRound}</strong>
          <small>Proxima rodada prevista</small>
        </article>
        <article>
          <span>Acerto histórico</span>
          <strong>{winnerRate}%</strong>
          <small>{winnerHits}/{finishedPredictions.length} · {preKickoffFinishedCount} pré-jogo</small>
        </article>
        <article>
          <span>Acerto placar</span>
          <strong>{scoreRate}%</strong>
          <small>{scoreHits}/{finishedPredictions.length}</small>
        </article>
        <article>
          <span>Confiança média</span>
          <strong>{averageConfidence}%</strong>
        </article>
      </section>

      <section className={`bets-dashboard ${isBetsCollapsed ? 'collapsed' : ''}`} aria-label="Melhores apostas da rodada">
        <div className="bets-head">
          <div>
            <span className="eyebrow">Painel de apostas</span>
            <h2>Melhores apostas — R{currentRound}</h2>
            <p>Mercados projetados pelo Orion para a rodada, com prioridade para linhas mais consistentes.</p>
          </div>
          <button
            className="bets-toggle"
            type="button"
            onClick={() => setIsBetsCollapsed((current) => !current)}
            aria-expanded={!isBetsCollapsed}
          >
            {isBetsCollapsed ? 'Expandir painel' : 'Minimizar painel'}
          </button>
          <div className="bets-accuracy" aria-label="Acerto histórico dos mercados">
            <div>
              <span>Gols (over/under)</span>
              <strong>{goalsAccuracy.rate}%</strong>
              <small>{goalsAccuracy.hits}/{goalsAccuracy.total}</small>
            </div>
            <div>
              <span>Ambas marcam</span>
              <strong>{bttsAccuracy.rate}%</strong>
              <small>{bttsAccuracy.hits}/{bttsAccuracy.total}</small>
            </div>
            <div>
              <span>Dupla chance</span>
              <strong>{doubleChanceAccuracy.rate}%</strong>
              <small>{doubleChanceAccuracy.hits}/{doubleChanceAccuracy.total}</small>
            </div>
          </div>
        </div>

        {!isBetsCollapsed && (
          <>
            {topBet && (
              <div className="bets-summary">
                <span className="eyebrow">Sugestao principal agora</span>
                <strong>
                  {topBet.market.selection} em {topBet.prediction.home.team.shortName} x {topBet.prediction.away.team.shortName}
                </strong>
                <small>
                  {topBet.market.probability}% de probabilidade · {dateTime(topBet.prediction.match.kickoff)}
                </small>
              </div>
            )}

            <div className="bets-filters" role="tablist" aria-label="Filtrar mercados">
              {(['todos', 'gols', 'ambas', 'escanteios', 'dupla-chance', 'resultado'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={marketFilter === filter ? 'active' : ''}
                  onClick={() => setMarketFilter(filter)}
                >
                  {filter === 'todos' ? 'Todos' : marketCategoryLabel[filter]}
                </button>
              ))}
            </div>

            {bestBets.length === 0 ? (
              <p className="bets-empty">Nenhum jogo em aberto para esse mercado no momento.</p>
            ) : (
              <div className="bets-grid">
                {bestBets.map(({ prediction, market }, index) => (
                  <button
                    key={market.key}
                    type="button"
                    className={`bet-card edge-${market.edge} ${index === 0 ? 'is-top' : ''}`}
                    onClick={() => {
                      setSelectedRound(prediction.match.round)
                      setSelectedPredictionId(prediction.id)
                    }}
                  >
                    <span className="bet-top">
                      <em className={`bet-cat cat-${market.category}`}>{marketCategoryLabel[market.category]}</em>
                      <b className="bet-prob">{market.probability}%</b>
                    </span>
                    <span className="bet-match">
                      <TeamBadge team={prediction.home.team} size="sm" />
                      <i>{prediction.home.team.code} x {prediction.away.team.code}</i>
                      <TeamBadge team={prediction.away.team} size="sm" />
                    </span>
                    <strong className="bet-selection">{market.selection}</strong>
                    <span className="bet-detail">{market.detail}</span>
                    <span className="bet-foot">
                      <span className={`bet-edge edge-${market.edge}`}>{index === 0 ? 'Principal' : market.reliability < 0.35 ? 'Base fraca' : `Confianca ${market.edge}`}</span>
                      <i>{dateTime(prediction.match.kickoff)}</i>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section className="round-tabs" aria-label={`Rodadas ${firstRound} a ${lastRound}`} key={`${firstRound}-${lastRound}`}>
        {rounds.map((round) => (
          <button
            className={round === selectedRound ? 'active' : ''}
            key={round}
            type="button"
            onClick={() => {
              setSelectedRound(round)
              setSelectedPredictionId('')
            }}
          >
            R{round}
          </button>
        ))}
      </section>

      <section className="workspace-grid">
        <aside className="fixture-list" aria-label="Jogos da rodada">
          <div className="section-heading">
            <span>Rodada {selectedRound}</span>
            <strong>{visiblePredictions.length} jogos</strong>
          </div>
          {visiblePredictions.map((prediction) => {
            const result = actualResult(prediction)
            const resultClass = result ? (prediction.predictedResult === result ? 'hit' : 'miss') : ''

            return (
            <button
              className={`fixture-card ${prediction.id === selectedPrediction.id ? 'active' : ''} ${resultClass}`}
              key={prediction.id}
              type="button"
              onClick={() => setSelectedPredictionId(prediction.id)}
            >
              <span className="fixture-league-strip">
                <span>
                  {competition.logoUrl ? <img src={competition.logoUrl} alt="" /> : null}
                  <b>{competition.name}</b>
                </span>
                <i>{dateTime(prediction.match.kickoff).split(',')[0]}</i>
              </span>
              <span className="fixture-matchup" aria-label={`Placar previsto: ${prediction.home.team.shortName} ${prediction.predictedHomeGoals} a ${prediction.predictedAwayGoals} ${prediction.away.team.shortName}`}>
                <span className="fixture-team home">
                  <span className="fixture-team-name">{prediction.home.team.shortName}</span>
                  <TeamBadge team={prediction.home.team} size="sm" />
                </span>

                <span className="fixture-center">
                  <strong>
                    <span>{prediction.predictedHomeGoals}</span>
                    <b>-</b>
                    <span>{prediction.predictedAwayGoals}</span>
                  </strong>
                </span>

                <span className="fixture-team away">
                  <TeamBadge team={prediction.away.team} size="sm" />
                  <span className="fixture-team-name">{prediction.away.team.shortName}</span>
                </span>
              </span>
              <span className="fixture-footer">
                <small>{prediction.match.status === 'finished' ? 'Fim' : 'Previsto'} · {dateTime(prediction.match.kickoff).split(',')[1]?.trim()} · Confiança {prediction.confidence}%</small>
                {prediction.match.status === 'finished' && <em>Finalizado</em>}
              </span>
            </button>
            )
          })}
        </aside>

        <section className="match-panel" aria-label="Previsao selecionada">
          <MatchScoreBanner
            homeTeam={selectedPrediction.home.team}
            awayTeam={selectedPrediction.away.team}
            homeScore={selectedPrediction.predictedHomeGoals}
            awayScore={selectedPrediction.predictedAwayGoals}
            label="Placar previsto"
            subtitle={`${selectedPrediction.home.team.shortName} x ${selectedPrediction.away.team.shortName}`}
          />

          <div className="match-rating-row" aria-label="Ratings dos times">
            <span><b>{selectedPrediction.home.team.code}</b> Rating {selectedPrediction.home.rating}</span>
            <span><b>{selectedPrediction.away.team.code}</b> Rating {selectedPrediction.away.rating}</span>
          </div>

          <div className="match-meta">
            <span>{dateTime(selectedPrediction.match.kickoff)}</span>
            <span>{selectedPrediction.match.venue}</span>
            <span>Risco {selectedPrediction.upsetRisk}</span>
            <span>{selectedPredictionIsFrozen ? `Congelada em ${dateTime(selectedPrediction.generatedAt)}` : `Calculo dinamico em ${dateTime(selectedPrediction.generatedAt)}`}</span>
          </div>

          {selectedActualResult && (
            <div className="actual-row" aria-label="Validacao do jogo encerrado">
              <div>
                <span>Placar real</span>
                <strong className="actual-score-inline">
                  <TeamBadge team={selectedPrediction.home.team} size="sm" />
                  <span>{selectedPrediction.match.homeGoals}</span>
                  <b>-</b>
                  <span>{selectedPrediction.match.awayGoals}</span>
                  <TeamBadge team={selectedPrediction.away.team} size="sm" />
                </strong>
              </div>
              <div>
                <span>Resultado real</span>
                <strong>{actualResultLabel(selectedPrediction)}</strong>
              </div>
              <div>
                <span>Acerto resultado</span>
                <strong className={selectedWinnerHit ? 'hit-text' : 'miss-text'}>{hitLabel(selectedWinnerHit)}</strong>
              </div>
              <div>
                <span>Acerto placar</span>
                <strong className={selectedScoreHit ? 'hit-text' : 'miss-text'}>{hitLabel(selectedScoreHit)}</strong>
              </div>
            </div>
          )}

          <div className="probability-grid">
            {probabilityItems(selectedPrediction).map((item) => (
              <div className="probability-item" key={item.label}>
                <span>{item.label}</span>
                <div className="track"><i style={{ width: `${item.value}%` }} /></div>
                <strong>{item.value}%</strong>
              </div>
            ))}
          </div>

          <div className="detail-grid">
            <article className="detail-panel">
              <h2>xG Orion</h2>
              <div className="xg-row">
                <strong>{decimal(selectedPrediction.home.expectedGoals)}</strong>
                <span>x</span>
                <strong>{decimal(selectedPrediction.away.expectedGoals)}</strong>
              </div>
              <p>{selectedPredictionIsFrozen ? 'Predição congelada no banco local.' : 'Cálculo dinâmico para rodada futura.'}</p>
            </article>

            <article className={`detail-panel risk-card ${selectedPrediction.upsetRisk}`}>
              <h2>Risco de zebra</h2>
              <strong>{selectedPrediction.upsetRisk}</strong>
              <p>Favorito estatístico: {favoriteLabel(selectedPrediction)} com {selectedFavoriteProbability}%.</p>
            </article>

            <article className="detail-panel">
              <h2>Placares prováveis</h2>
              <div className="score-list">
                {selectedPrediction.likelyScores.map((score) => (
                  <span key={`${score.homeGoals}-${score.awayGoals}`}>
                    <strong>{score.homeGoals}-{score.awayGoals}</strong>
                    {score.probability}%
                  </span>
                ))}
              </div>
            </article>
          </div>

          <div className="markets-panel" aria-label="Mercados de aposta do jogo">
            <div className="section-heading">
              <span>Mercados do jogo</span>
              <strong>{selectedPrediction.expectedTotalGoals} gols · {selectedPrediction.expectedCorners} escanteios</strong>
            </div>
            <div className="markets-list">
              {selectedMarkets.map((market, index) => {
                const outcome = actualResult(selectedPrediction) ? evaluateMarket(selectedPrediction, market) : null
                const outcomeClass = outcome === null ? '' : outcome ? 'hit' : 'miss'

                return (
                  <div
                    className={`market-row edge-${market.edge} ${index === 0 ? 'is-top' : ''} ${outcomeClass}`}
                    key={market.key}
                  >
                    <span className={`market-cat cat-${market.category}`}>{marketCategoryLabel[market.category]}</span>
                    <div className="market-body">
                      <strong>
                        {market.selection}
                        {outcome !== null && (
                          <em className={`market-outcome ${outcomeClass}`}>{outcome ? 'Acertou' : 'Errou'}</em>
                        )}
                      </strong>
                      <small>{market.detail}</small>
                      {market.reliability < 0.35 && <small>Base estatistica fraca para esse mercado.</small>}
                    </div>
                    <b className="market-prob">{market.probability}%</b>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="factor-grid">
            <div><span>Ataque</span><strong>{selectedPrediction.home.attackRating} x {selectedPrediction.away.attackRating}</strong></div>
            <div><span>Defesa</span><strong>{selectedPrediction.home.defenseRating} x {selectedPrediction.away.defenseRating}</strong></div>
            <div><span>Momento</span><strong>{selectedPrediction.home.momentumRating} x {selectedPrediction.away.momentumRating}</strong></div>
            <div><span>Mando</span><strong>+{decimal(selectedPrediction.factors.homeAdvantage)} gol</strong></div>
          </div>

          <div className="model-band" aria-label="Indicadores do modelo">
            <div><span>Escopo</span><strong>R1-R{currentRound}</strong></div>
            <div><span>Cobertura</span><strong>{Math.round(selectedPrediction.dataCoverage * 100)}%</strong></div>
            <div><span>Rating</span><strong>{selectedPrediction.home.rating} x {selectedPrediction.away.rating}</strong></div>
            <div><span>Favorito</span><strong>{favoriteLabel(selectedPrediction)}</strong></div>
          </div>
        </section>

        <section className="analysis-panel" aria-label="Analise do motor">
          <div className="section-heading">
            <span>Analise do motor</span>
            <strong>{resultLabel(selectedPrediction)}</strong>
          </div>
          <ul>
            {selectedPrediction.analysis.map((item) => <li key={item}>{item}</li>)}
          </ul>

          <div className="standings-panel">
            <div className="section-heading">
              <span>Tabela ao vivo</span>
              <strong>Top {standings.length}</strong>
            </div>
            <div className="standings-list">
              {standings.map((row, index) => (
                <div className="standing-row" key={row.team.id}>
                  <span>{index + 1}</span>
                  <TeamBadge team={row.team} size="sm" />
                  <strong>{row.team.shortName}</strong>
                  <em>{row.points} pts</em>
                </div>
              ))}
            </div>
          </div>
        </section>
      </section>
    </main>
  )
}

export default App
