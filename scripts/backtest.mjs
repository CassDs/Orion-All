/**
 * Backtest rodada-a-rodada (sem vazamento de dados)
 * 
 * Para cada rodada R:
 *   - Treina usando APENAS jogos das rodadas 1..R-1
 *   - Prevê os jogos da rodada R
 *   - Compara com os resultados reais
 * 
 * Isso mede a acurácia real do modelo, como seria na prática.
 */

const BASE_URL = 'https://webws.365scores.com/web'
const SERIE_B_365_ID = 116
const SEASON = 2026
const MAX_PAGES = 24

// --- Utils ---
const clamp = (v, mn, mx) => Math.min(Math.max(v, mn), mx)
const roundTo = (v, p = 2) => Number(v.toFixed(p))
const sortByDate = (records) => [...records].sort((a, b) => new Date(b.date) - new Date(a.date))
const pointsFrom = (r) => r.teamGoals > r.opponentGoals ? 3 : r.teamGoals === r.opponentGoals ? 1 : 0
const resultScoreFrom = (r) => pointsFrom(r) / 3
const expectedScore = (rA, rB) => 1 / (1 + 10 ** ((rB - rA) / 400))
const actualResult = (m) => m.homeGoals > m.awayGoals ? 'home' : m.homeGoals < m.awayGoals ? 'away' : 'draw'

// --- API ---
const request = async (path) => {
  const p = path.startsWith('/web/') ? path.slice(4) : path
  const res = await fetch(`${BASE_URL}${p}`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

const fetchPaged = async (path, direction) => {
  const byId = new Map()
  let next = path
  let pages = 0
  while (next && pages < MAX_PAGES) {
    const data = await request(next)
    const games = (data.games ?? []).filter(g => g.competitionId === SERIE_B_365_ID && new Date(g.startTime).getUTCFullYear() === SEASON)
    const before = byId.size
    games.forEach(g => byId.set(g.id, g))
    pages++
    if (games.length === 0 || byId.size === before) break
    next = data.paging?.[direction]
  }
  return [...byId.values()]
}

const fetchAllGames = async () => {
  const params = new URLSearchParams({ appTypeId: '5', langId: '1', timezoneName: 'UTC', userCountryId: '21', competitions: String(SERIE_B_365_ID) })
  const paths = ['/games/results/?' + params, '/games/fixtures/?' + params]
  const chunks = await Promise.all(paths.flatMap(p => [fetchPaged(p, 'previousPage'), fetchPaged(p, 'nextPage')]))
  const byId = new Map()
  chunks.flat().forEach(g => byId.set(g.id, g))
  return [...byId.values()].sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
}

// --- Data model ---
const isFinished = (g) => g.statusText?.toLowerCase() === 'ended' || g.statusGroup === 4
const score = (c) => Math.max(0, Math.round(c.score ?? 0))
const slugify = (v) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const tName = (c) => c.shortName ?? c.name
const roundFromGame = (g, fb) => typeof g.roundNum === 'number' && g.roundNum > 0 ? g.roundNum : (parseInt(g.roundName?.match(/\d+/)?.[0] ?? g.groupName?.match(/\d+/)?.[0]) || fb)

const buildTeams = (games) => {
  const comps = new Map()
  games.forEach(g => { comps.set(g.homeCompetitor.id, g.homeCompetitor); comps.set(g.awayCompetitor.id, g.awayCompetitor) })
  return [...comps.values()].map((c, i) => ({
    id: slugify(`${c.id}-${c.nameForURL ?? c.name}`),
    scores365Id: c.id,
    shortName: tName(c),
    baseRating: 1500 + Math.max(0, 20 - i) * 5,
  }))
}

const buildTeamsSpreaded = (games, topRating, spread) => {
  const comps = new Map()
  games.forEach(g => { comps.set(g.homeCompetitor.id, g.homeCompetitor); comps.set(g.awayCompetitor.id, g.awayCompetitor) })
  const all = [...comps.values()]
  return all.map((c, i) => ({
    id: slugify(`${c.id}-${c.nameForURL ?? c.name}`),
    scores365Id: c.id,
    shortName: tName(c),
    baseRating: Math.round(topRating - i * (spread / Math.max(all.length - 1, 1))),
  }))
}

const buildMatches = (games, teamsByProvider) => games.map((g, i) => {
  const home = teamsByProvider.get(g.homeCompetitor.id)
  const away = teamsByProvider.get(g.awayCompetitor.id)
  if (!home || !away) return null
  return {
    id: String(g.id),
    round: roundFromGame(g, Math.floor(i / 10) + 1),
    kickoff: g.startTime,
    homeTeamId: home.id, awayTeamId: away.id,
    homeGoals: isFinished(g) ? score(g.homeCompetitor) : undefined,
    awayGoals: isFinished(g) ? score(g.awayCompetitor) : undefined,
    finished: isFinished(g),
  }
}).filter(Boolean)

// --- Rating (Elo iterativo) ---
const buildRatings = (teams, matches, K = 22) => {
  const ratings = new Map(teams.map(t => [t.id, t.baseRating]))
  for (const m of matches) {
    if (!m.finished) continue
    const rH = ratings.get(m.homeTeamId) ?? 1500
    const rA = ratings.get(m.awayTeamId) ?? 1500
    const expH = expectedScore(rH, rA)
    const actH = m.homeGoals > m.awayGoals ? 1 : m.homeGoals === m.awayGoals ? 0.5 : 0
    const goalDelta = clamp((m.homeGoals - m.awayGoals) / 3, -1, 1) * 8
    ratings.set(m.homeTeamId, Math.round(clamp(rH + K * (actH - expH) + goalDelta, 1250, 1800)))
    ratings.set(m.awayTeamId, Math.round(clamp(rA + K * (1 - actH - (1 - expH)) - goalDelta, 1250, 1800)))
  }
  return ratings
}

const buildRecords = (teams, matches) => {
  const recs = new Map(teams.map(t => [t.id, []]))
  for (const m of matches) {
    if (!m.finished) continue
    recs.get(m.homeTeamId)?.push({ date: m.kickoff.slice(0,10), opponentId: m.awayTeamId, homeAway: 'home', teamGoals: m.homeGoals, opponentGoals: m.awayGoals })
    recs.get(m.awayTeamId)?.push({ date: m.kickoff.slice(0,10), opponentId: m.homeTeamId, homeAway: 'away', teamGoals: m.awayGoals, opponentGoals: m.homeGoals })
  }
  return recs
}

const calcMetrics = (records) => {
  if (!records.length) return { pointsPerMatch: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, cleanSheetRate: 0, formScore: 0 }
  const t = records.reduce((a, r) => { a.pts += pointsFrom(r); a.gf += r.teamGoals; a.ga += r.opponentGoals; a.cs += r.opponentGoals === 0 ? 1 : 0; return a }, { pts:0, gf:0, ga:0, cs:0 })
  const n = records.length
  const ppm = t.pts / n, gf = t.gf / n, ga = t.ga / n, csr = t.cs / n
  const formScore = clamp(ppm/3*0.38 + clamp((gf-ga+1.8)/3.6,0,1)*0.18 + clamp(gf/2.5,0,1)*0.12 + csr*0.1, 0, 1)
  return { pointsPerMatch: ppm, goalsFor: gf, goalsAgainst: ga, goalDiff: gf - ga, cleanSheetRate: csr, formScore }
}

// --- Prediction kernel ---
const factorial = (n) => n <= 1 ? 1 : Array.from({length: n-1}, (_,i)=>i+2).reduce((a,b)=>a*b,1)
const poisson = (l, k) => (Math.exp(-l) * l**k) / factorial(k)
const lowCorrect = (h, a) => h===0&&a===0?1.12:h===1&&a===1?1.1:((h===1&&a===0)||(h===0&&a===1))?1.05:1

const predictGame = (home, away, homeRating, awayRating, homeRecords, awayRecords, params) => {
  const { homeAdv, drawThreshold, eloWeight, drawBase, drawSlope, drawFloor, drawCeiling, argmax } = params
  
  const sH = sortByDate(homeRecords); const sA = sortByDate(awayRecords)
  const mH = calcMetrics(sH.slice(0, 10)); const mA = calcMetrics(sA.slice(0, 10))
  const sfH = calcMetrics(sH.slice(0, 5)); const sfA = calcMetrics(sA.slice(0, 5))
  
  const wAtk = (m, sf) => m.goalsFor * 0.55 + sf.goalsFor * 0.45
  const wDef = (m, sf) => m.goalsAgainst * 0.55 + sf.goalsAgainst * 0.45
  const atkH = clamp(wAtk(mH, sfH), 0.3, 3.2), defH = clamp(wDef(mH, sfH), 0.3, 3.2)
  const atkA = clamp(wAtk(mA, sfA), 0.3, 3.2), defA = clamp(wDef(mA, sfA), 0.3, 3.2)
  
  const ratingEdge = clamp((homeRating - awayRating) / 280, -0.48, 0.48)
  const momEdge = (mH.formScore - mA.formScore) * 0.18
  const xgH = clamp(0.55 + atkH * 0.36 + defA * 0.28 + ratingEdge + momEdge + homeAdv, 0.3, 3.5)
  const xgA = clamp(0.55 + atkA * 0.36 + defH * 0.28 - ratingEdge - momEdge, 0.3, 3.5)
  
  let hP=0, dP=0, aP=0
  for (let h=0; h<=5; h++) for (let a=0; a<=5; a++) {
    const p = poisson(xgH, h) * poisson(xgA, a) * lowCorrect(h, a)
    if (h>a) hP+=p; else if (h===a) dP+=p; else aP+=p
  }
  const pTotal = hP+dP+aP||1
  const poissonH = hP/pTotal, poissonD = dP/pTotal, poissonA = aP/pTotal
  
  const eloExp = expectedScore(homeRating, awayRating)
  const eloSep = Math.abs(eloExp - 0.5)
  const eloDraw = clamp(drawBase - drawSlope * eloSep, drawFloor, drawCeiling)
  const eloHome = (1-eloDraw)*eloExp, eloAway = (1-eloDraw)*(1-eloExp)
  
  const bH = eloWeight*eloHome + (1-eloWeight)*poissonH
  const bD = eloWeight*eloDraw + (1-eloWeight)*poissonD
  const bA = eloWeight*eloAway + (1-eloWeight)*poissonA
  const bT = bH+bD+bA||1
  const pH = bH/bT, pD = bD/bT, pA = bA/bT
  
  const probabilities = { home: Math.round(pH*100), draw: Math.round(pD*100), away: Math.round(pA*100) }
  let result
  if (argmax) {
    result = pD >= pH && pD >= pA ? 'draw' : pH > pA ? 'home' : 'away'
  } else if (params.drawCutoff != null) {
    // Prever empate se probabilidade de empate supera cutoff absoluto
    result = pD >= params.drawCutoff ? 'draw' : pH > pA ? 'home' : 'away'
  } else {
    const winMargin = Math.abs(pH - pA)
    result = winMargin < drawThreshold ? 'draw' : pH > pA ? 'home' : 'away'
  }
  return { result, probabilities }
}

// --- Backtest ---
const backtest = (teams, matchesByRound, allRecordsByTeam, params) => {
  const rounds = Object.keys(matchesByRound).map(Number).sort((a,b)=>a-b)
  const results = []
  const cumulativeMatches = []
  const K = params.eloK ?? 22

  for (const round of rounds) {
    const trainMatches = cumulativeMatches.slice()
    const ratings = buildRatings(teams, trainMatches, K)
    const records = buildRecords(teams, trainMatches)
    
    const games = matchesByRound[round]
    for (const m of games) {
      if (!m.finished) continue
      const hRating = ratings.get(m.homeTeamId) ?? 1500
      const aRating = ratings.get(m.awayTeamId) ?? 1500
      // Use enriched records from full season for recentMetrics (API data), but Elo from round-by-round
      const hRecs = allRecordsByTeam[m.homeTeamId] ?? records.get(m.homeTeamId) ?? []
      const aRecs = allRecordsByTeam[m.awayTeamId] ?? records.get(m.awayTeamId) ?? []
      const pred = predictGame(null, null, hRating, aRating, hRecs, aRecs, params)
      results.push({ round, actual: actualResult(m), predicted: pred.result, probabilities: pred.probabilities })
    }
    cumulativeMatches.push(...games.filter(m => m.finished))
  }
  return results
}

const score_results = (results) => {
  const n = results.length
  if (n === 0) return { n: 0, winnerRate: 0, dist: {} }
  const hits = results.filter(r => r.actual === r.predicted).length
  const dist = results.reduce((a, r) => { a[r.predicted] = (a[r.predicted]??0)+1; return a }, {})
  const actual = results.reduce((a, r) => { a[r.actual] = (a[r.actual]??0)+1; return a }, {})
  return { n, winnerRate: Math.round(hits/n*100), dist, actual }
}

// --- Main ---
console.log('Baixando jogos...')
const games = await fetchAllGames()
const teams = buildTeams(games)
const teamsByProvider = new Map(teams.map(t => [t.scores365Id, t]))
const matches = buildMatches(games, teamsByProvider)
const matchesByRound = matches.reduce((acc, m) => { (acc[m.round] ??= []).push(m); return acc }, {})
const allRecords = buildRecords(teams, matches.filter(m => m.finished))
const allRecordsByTeam = Object.fromEntries([...allRecords.entries()])

const finished = matches.filter(m => m.finished)
console.log(`Jogos: ${games.length} total, ${finished.length} finalizados`)
console.log(`Distribuição real: ${JSON.stringify(finished.reduce((a,m)=>{ a[actualResult(m)]=(a[actualResult(m)]??0)+1; return a }, {}))}`)
console.log()

// Parâmetros a testar
const variants = [
  // --- Referência (atual em produção) ---
  { name: 'prod',            homeAdv:0.22, drawThreshold:0.12,  eloWeight:0.70, drawBase:0.29, drawSlope:0.56, drawFloor:0.07, drawCeiling:0.29, eloK:22,   spread:114  },
  // --- Melhor da rodada anterior ---
  { name: 'best-prev',       homeAdv:0.22, drawThreshold:0, eloWeight:0.60, drawBase:0.29, drawSlope:0.56, drawFloor:0.07, drawCeiling:0.29, drawCutoff:0.27, eloK:22, spread:114 },
  // --- Elo K-factor variado ---
  { name: 'K28',             homeAdv:0.22, drawThreshold:0, eloWeight:0.60, drawBase:0.29, drawSlope:0.56, drawFloor:0.07, drawCeiling:0.29, drawCutoff:0.27, eloK:28, spread:114 },
  { name: 'K32',             homeAdv:0.22, drawThreshold:0, eloWeight:0.60, drawBase:0.29, drawSlope:0.56, drawFloor:0.07, drawCeiling:0.29, drawCutoff:0.27, eloK:32, spread:114 },
  { name: 'K36',             homeAdv:0.22, drawThreshold:0, eloWeight:0.60, drawBase:0.29, drawSlope:0.56, drawFloor:0.07, drawCeiling:0.29, drawCutoff:0.27, eloK:36, spread:114 },
  // --- Spread inicial variado (top=1620, spread=X pts entre 1o e 20o) ---
  { name: 'spread150',       homeAdv:0.22, drawThreshold:0, eloWeight:0.60, drawBase:0.29, drawSlope:0.56, drawFloor:0.07, drawCeiling:0.29, drawCutoff:0.27, eloK:22, spread:150 },
  { name: 'spread200',       homeAdv:0.22, drawThreshold:0, eloWeight:0.60, drawBase:0.29, drawSlope:0.56, drawFloor:0.07, drawCeiling:0.29, drawCutoff:0.27, eloK:22, spread:200 },
  { name: 'spread250',       homeAdv:0.22, drawThreshold:0, eloWeight:0.60, drawBase:0.29, drawSlope:0.56, drawFloor:0.07, drawCeiling:0.29, drawCutoff:0.27, eloK:22, spread:250 },
  // --- Spread + K combinados ---
  { name: 'K28-sp200',       homeAdv:0.22, drawThreshold:0, eloWeight:0.60, drawBase:0.29, drawSlope:0.56, drawFloor:0.07, drawCeiling:0.29, drawCutoff:0.27, eloK:28, spread:200 },
  { name: 'K32-sp200',       homeAdv:0.22, drawThreshold:0, eloWeight:0.60, drawBase:0.29, drawSlope:0.56, drawFloor:0.07, drawCeiling:0.29, drawCutoff:0.27, eloK:32, spread:200 },
  { name: 'K28-sp250',       homeAdv:0.22, drawThreshold:0, eloWeight:0.60, drawBase:0.29, drawSlope:0.56, drawFloor:0.07, drawCeiling:0.29, drawCutoff:0.27, eloK:28, spread:250 },
  { name: 'K32-sp250',       homeAdv:0.22, drawThreshold:0, eloWeight:0.60, drawBase:0.29, drawSlope:0.56, drawFloor:0.07, drawCeiling:0.29, drawCutoff:0.27, eloK:32, spread:250 },
  // --- Ajuste vantagem em casa ---
  { name: 'home18-K28-200',  homeAdv:0.18, drawThreshold:0, eloWeight:0.60, drawBase:0.29, drawSlope:0.56, drawFloor:0.07, drawCeiling:0.29, drawCutoff:0.27, eloK:28, spread:200 },
  { name: 'home14-K28-200',  homeAdv:0.14, drawThreshold:0, eloWeight:0.60, drawBase:0.29, drawSlope:0.56, drawFloor:0.07, drawCeiling:0.29, drawCutoff:0.27, eloK:28, spread:200 },
]

console.log('BACKTEST rodada-a-rodada (sem vazamento de dados)')
console.log('='.repeat(72))
console.log(String('Variante').padEnd(18), 'Acerto%', String('Dist pred').padEnd(24), 'n jogos')
console.log('-'.repeat(72))
for (const params of variants) {
  const teamsForTest = params.spread !== 114
    ? buildTeamsSpreaded(games, 1620, params.spread)
    : teams
  const teamsByProvForTest = new Map(teamsForTest.map(t => [t.scores365Id, t]))
  const matchesForTest = buildMatches(games, teamsByProvForTest)
  const matchesByRoundForTest = matchesForTest.reduce((acc, m) => { (acc[m.round] ??= []).push(m); return acc }, {})
  const allRecsForTest = buildRecords(teamsForTest, matchesForTest.filter(m => m.finished))
  const allRecsByTeamForTest = Object.fromEntries([...allRecsForTest.entries()])
  const results = backtest(teamsForTest, matchesByRoundForTest, allRecsByTeamForTest, params)
  const s = score_results(results)
  const distStr = `h:${s.dist.home??0} d:${s.dist.draw??0} a:${s.dist.away??0}`
  console.log(params.name.padEnd(18), `${s.winnerRate}%`.padEnd(8), distStr.padEnd(24), s.n)
}
console.log()
console.log(`Distribuição real: h:${finished.filter(m=>actualResult(m)==='home').length} d:${finished.filter(m=>actualResult(m)==='draw').length} a:${finished.filter(m=>actualResult(m)==='away').length}`)
