/**
 * Backtest v2 — completamente honesto, sem vazamento de dados.
 * 
 * Para cada rodada R:
 *   - Treina usando APENAS jogos finalizados das rodadas 1..R-1
 *   - Prevê os jogos da rodada R
 *   - Compara com resultados reais
 * 
 * Testa 5 abordagens distintas.
 */

const BASE_URL = 'https://webws.365scores.com/web'
const SERIE_B_365_ID = 116
const SEASON = 2026
const MAX_PAGES = 24

// --- Utils ---
const clamp = (v, mn, mx) => Math.min(Math.max(v, mn), mx)
const sortByDate = (recs) => [...recs].sort((a, b) => new Date(b.date) - new Date(a.date))
const pointsFrom = (r) => r.teamGoals > r.opponentGoals ? 3 : r.teamGoals === r.opponentGoals ? 1 : 0
const actualResult = (m) => m.homeGoals > m.awayGoals ? 'home' : m.homeGoals < m.awayGoals ? 'away' : 'draw'
const factorial = (n) => n <= 1 ? 1 : Array.from({length: n - 1}, (_, i) => i + 2).reduce((a, b) => a * b, 1)
const poissonP = (l, k) => (Math.exp(-l) * l ** k) / factorial(k)

// --- API ---
const request = async (path) => {
  const p = path.startsWith('/web/') ? path.slice(4) : path
  const res = await fetch(`${BASE_URL}${p}`, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`)
  return res.json()
}

const fetchPaged = async (path, direction) => {
  const byId = new Map()
  let next = path
  let pages = 0
  while (next && pages < MAX_PAGES) {
    const data = await request(next)
    const games = (data.games ?? []).filter(g =>
      g.competitionId === SERIE_B_365_ID && new Date(g.startTime).getUTCFullYear() === SEASON
    )
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
    scores365Id: c.id, shortName: tName(c),
    baseRating: 1500 + Math.max(0, 20 - i) * 6,
  }))
}

const buildTeamsFromStandings = (games, standings) => {
  const comps = new Map()
  games.forEach(g => { comps.set(g.homeCompetitor.id, g.homeCompetitor); comps.set(g.awayCompetitor.id, g.awayCompetitor) })
  return [...comps.values()].map((c, i) => ({
    id: slugify(`${c.id}-${c.nameForURL ?? c.name}`),
    scores365Id: c.id, shortName: tName(c),
    baseRating: ratingFromStanding(standings.get(c.id), i),
  }))
}

const buildMatches = (games, teamsByProvider) => games.map((g, i) => {
  const home = teamsByProvider.get(g.homeCompetitor.id)
  const away = teamsByProvider.get(g.awayCompetitor.id)
  if (!home || !away) return null
  return {
    id: String(g.id), round: roundFromGame(g, Math.floor(i / 10) + 1),
    kickoff: g.startTime, homeTeamId: home.id, awayTeamId: away.id,
    homeGoals: isFinished(g) ? score(g.homeCompetitor) : undefined,
    awayGoals: isFinished(g) ? score(g.awayCompetitor) : undefined,
    finished: isFinished(g),
  }
}).filter(Boolean)

// =====================================================================
// MODELO 1: Elo K-factor (atual)
// =====================================================================
const buildEloRatings = (teams, matches, K = 22) => {
  const R = new Map(teams.map(t => [t.id, t.baseRating]))
  for (const m of matches) {
    if (!m.finished) continue
    const rH = R.get(m.homeTeamId) ?? 1500, rA = R.get(m.awayTeamId) ?? 1500
    const expH = 1 / (1 + 10 ** ((rA - rH) / 400))
    const actH = m.homeGoals > m.awayGoals ? 1 : m.homeGoals === m.awayGoals ? 0.5 : 0
    const gd = clamp((m.homeGoals - m.awayGoals) / 3, -1, 1) * 8
    R.set(m.homeTeamId, Math.round(clamp(rH + K * (actH - expH) + gd, 1250, 1800)))
    R.set(m.awayTeamId, Math.round(clamp(rA + K * (1 - actH - (1 - expH)) - gd, 1250, 1800)))
  }
  return R
}

// =====================================================================
// MODELO 2: PPM (Points Per Match) direto → Elo derivado
// =====================================================================
const buildPPMRatings = (teams, matches) => {
  const stats = new Map(teams.map(t => [t.id, { pts: 0, gf: 0, ga: 0, n: 0 }]))
  for (const m of matches) {
    if (!m.finished) continue
    const h = stats.get(m.homeTeamId), a = stats.get(m.awayTeamId)
    if (!h || !a) continue
    const hPts = m.homeGoals > m.awayGoals ? 3 : m.homeGoals === m.awayGoals ? 1 : 0
    const aPts = m.awayGoals > m.homeGoals ? 3 : m.awayGoals === m.homeGoals ? 1 : 0
    h.pts += hPts; h.gf += m.homeGoals; h.ga += m.awayGoals; h.n++
    a.pts += aPts; a.gf += m.awayGoals; a.ga += m.homeGoals; a.n++
  }
  const R = new Map()
  for (const [id, s] of stats) {
    if (s.n === 0) { R.set(id, 1500); continue }
    const ppm = s.pts / s.n
    const gd = clamp((s.gf - s.ga) / s.n, -2, 2)
    // PPM 0..3 + saldo → escala 1350..1800
    const strength = ppm / 3 * 0.70 + (gd + 2) / 4 * 0.30
    R.set(id, Math.round(1350 + strength * 450))
  }
  return R
}

// =====================================================================
// MODELO 3: Attack × Defense multiplicativo (Dixon-Coles simplificado)
// =====================================================================
const buildAttackDefense = (teams, matches) => {
  const stats = new Map(teams.map(t => [t.id, { gf: 0, ga: 0, n: 0 }]))
  for (const m of matches) {
    if (!m.finished) continue
    const h = stats.get(m.homeTeamId), a = stats.get(m.awayTeamId)
    if (!h || !a) continue
    h.gf += m.homeGoals; h.ga += m.awayGoals; h.n++
    a.gf += m.awayGoals; a.ga += m.homeGoals; a.n++
  }
  const finished = matches.filter(m => m.finished)
  const totalGoals = finished.reduce((s, m) => s + m.homeGoals + m.awayGoals, 0)
  const avgGoals = finished.length > 0 ? totalGoals / (2 * finished.length) : 1.2
  const atk = new Map(), def = new Map()
  for (const [id, s] of stats) {
    const avg = s.n > 0 ? (s.gf / s.n + s.ga / s.n) / 2 : avgGoals
    // Shrink toward league average (Bayesian shrinkage, n games of weight)
    const w = Math.min(s.n / 8, 1)
    atk.set(id, w * (s.gf / Math.max(s.n, 1)) + (1 - w) * avgGoals)
    def.set(id, w * (s.ga / Math.max(s.n, 1)) + (1 - w) * avgGoals)
    void avg
  }
  return { atk, def, avgGoals }
}

const predictDixonColes = (hAtk, hDef, aAtk, aDef, avgGoals, homeAdv) => {
  // λ_home = (home_atk / avg) * (away_def / avg) * avg * exp(homeAdv)
  // λ_away = (away_atk / avg) * (home_def / avg) * avg
  const lH = clamp((hAtk / avgGoals) * (aDef / avgGoals) * avgGoals * Math.exp(homeAdv), 0.3, 4.0)
  const lA = clamp((aAtk / avgGoals) * (hDef / avgGoals) * avgGoals, 0.3, 4.0)
  // Dixon-Coles correction factor ρ for low scores
  const rho = -0.13
  let hP = 0, dP = 0, aP = 0
  for (let h = 0; h <= 6; h++) for (let a = 0; a <= 6; a++) {
    let p = poissonP(lH, h) * poissonP(lA, a)
    if (h === 0 && a === 0) p *= (1 - rho * lH * lA)
    else if (h === 1 && a === 0) p *= (1 + rho * lA)
    else if (h === 0 && a === 1) p *= (1 + rho * lH)
    else if (h === 1 && a === 1) p *= (1 - rho)
    if (h > a) hP += p; else if (h === a) dP += p; else aP += p
  }
  const t = hP + dP + aP || 1
  return { h: hP / t, d: dP / t, a: aP / t, lH, lA }
}

// =====================================================================
// MODELO 4: Abordagem home/away separada
// =====================================================================
const buildHomeAwayStats = (teams, matches) => {
  const home = new Map(teams.map(t => [t.id, { gf: 0, ga: 0, pts: 0, n: 0 }]))
  const away = new Map(teams.map(t => [t.id, { gf: 0, ga: 0, pts: 0, n: 0 }]))
  for (const m of matches) {
    if (!m.finished) continue
    const h = home.get(m.homeTeamId), a = away.get(m.awayTeamId)
    if (h) { h.gf += m.homeGoals; h.ga += m.awayGoals; h.pts += m.homeGoals > m.awayGoals ? 3 : m.homeGoals === m.awayGoals ? 1 : 0; h.n++ }
    if (a) { a.gf += m.awayGoals; a.ga += m.homeGoals; a.pts += m.awayGoals > m.homeGoals ? 3 : m.awayGoals === m.homeGoals ? 1 : 0; a.n++ }
  }
  const finished = matches.filter(m => m.finished)
  const avgGF = finished.length ? finished.reduce((s, m) => s + m.homeGoals + m.awayGoals, 0) / (2 * finished.length) : 1.2
  return { home, away, avgGF }
}

const predictHomeAway = (hId, aId, homeStats, awayStats, allStats, avgGF) => {
  const getAtk = (map, id, n) => n > 0 ? map.get(id).gf / n : avgGF
  const getDef = (map, id, n) => n > 0 ? map.get(id).ga / n : avgGF
  const hs = homeStats.get(hId) ?? { gf: 0, ga: 0, n: 0 }
  const as_ = awayStats.get(aId) ?? { gf: 0, ga: 0, n: 0 }
  const allH = allStats.home.get(hId) ?? { gf: 0, ga: 0, n: 0 }
  const allA = allStats.away.get(aId) ?? { gf: 0, ga: 0, n: 0 }

  const wH = Math.min(hs.n / 6, 1), wA = Math.min(as_.n / 6, 1)
  const hAtk = wH * getAtk(homeStats, hId, hs.n) + (1 - wH) * avgGF
  const hDef = wH * getDef(homeStats, hId, hs.n) + (1 - wH) * avgGF
  const aAtk = wA * getAtk(awayStats, aId, as_.n) + (1 - wA) * avgGF
  const aDef = wA * getDef(awayStats, aId, as_.n) + (1 - wA) * avgGF

  const rho = -0.13
  const lH = clamp((hAtk / avgGF) * (aDef / avgGF) * avgGF, 0.3, 3.8)
  const lA = clamp((aAtk / avgGF) * (hDef / avgGF) * avgGF, 0.3, 3.8)
  let hP = 0, dP = 0, aP = 0
  for (let h = 0; h <= 6; h++) for (let a = 0; a <= 6; a++) {
    let p = poissonP(lH, h) * poissonP(lA, a)
    if (h === 0 && a === 0) p *= (1 - rho * lH * lA)
    else if (h === 1 && a === 0) p *= (1 + rho * lA)
    else if (h === 0 && a === 1) p *= (1 + rho * lH)
    else if (h === 1 && a === 1) p *= (1 - rho)
    if (h > a) hP += p; else if (h === a) dP += p; else aP += p
  }
  const t = hP + dP + aP || 1
  return { h: hP / t, d: dP / t, a: aP / t, lH, lA }
  void allH; void allA
}

// =====================================================================
// KERNEL UNIFICADO DE DECISÃO
// =====================================================================
const decide = (h, d, a, params) => {
  const { drawCutoff, drawThreshold, argmax } = params
  if (argmax) return d >= h && d >= a ? 'draw' : h > a ? 'home' : 'away'
  if (drawCutoff != null) return d >= drawCutoff ? 'draw' : h > a ? 'home' : 'away'
  const margin = Math.abs(h - a)
  return margin < drawThreshold ? 'draw' : h > a ? 'home' : 'away'
}

// =====================================================================
// BACKTEST COMPLETO HONESTO
// =====================================================================
const runBacktest = (label, teams, matchesByRound, buildPred) => {
  const rounds = Object.keys(matchesByRound).map(Number).sort((a, b) => a - b)
  const results = []
  const pastMatches = []
  for (const round of rounds) {
    const pred = buildPred(teams, pastMatches)
    for (const m of matchesByRound[round]) {
      if (!m.finished) continue
      const r = pred(m)
      results.push({ round, actual: actualResult(m), predicted: r })
    }
    pastMatches.push(...matchesByRound[round].filter(m => m.finished))
  }
  const n = results.length, hits = results.filter(r => r.actual === r.predicted).length
  const dist = results.reduce((a, r) => { a[r.predicted] = (a[r.predicted] ?? 0) + 1; return a }, {})
  const pct = n ? Math.round(hits / n * 100) : 0
  const d = `h:${dist.home ?? 0} d:${dist.draw ?? 0} a:${dist.away ?? 0}`
  console.log(label.padEnd(28), `${pct}%`.padEnd(7), d.padEnd(22), `(n=${n})`)
  return { label, pct, dist, n, results }
}

// Modo VAZADO (mesma metodologia do Orion World Cup): métricas de TODOS os jogos,
// inclusive os posteriores à partida prevista. Serve só para comparação justa.
const runLeaked = (label, teams, matchesByRound, buildPred) => {
  const rounds = Object.keys(matchesByRound).map(Number).sort((a, b) => a - b)
  const allMatches = rounds.flatMap((round) => matchesByRound[round].filter((m) => m.finished))
  const pred = buildPred(teams, allMatches)
  const results = []
  for (const round of rounds) {
    for (const m of matchesByRound[round]) {
      if (!m.finished) continue
      results.push({ round, actual: actualResult(m), predicted: pred(m) })
    }
  }
  const n = results.length, hits = results.filter((r) => r.actual === r.predicted).length
  const pct = n ? Math.round(hits / n * 100) : 0
  console.log(label.padEnd(28), `${pct}%`.padEnd(7), ''.padEnd(22), `(n=${n})`)
  return { label, pct, n, results }
}

const reportByBucket = (label, results) => {
  const buckets = [[1, 5], [6, 10], [11, 99]]
  const parts = buckets.map(([lo, hi]) => {
    const sub = results.filter((r) => r.round >= lo && r.round <= hi)
    const hits = sub.filter((r) => r.actual === r.predicted).length
    const pct = sub.length ? Math.round(hits / sub.length * 100) : 0
    return `R${lo}-${hi === 99 ? '+' : hi}: ${pct}% (n=${sub.length})`
  })
  console.log(`  ${label}: ${parts.join('  |  ')}`)
}

// =====================================================================
// FETCH STANDINGS
// =====================================================================
const fetchStandings = async () => {
  const params = new URLSearchParams({ appTypeId: '5', langId: '1', timezoneName: 'UTC', userCountryId: '21', competitions: String(SERIE_B_365_ID), groupId: '0' })
  const data = await request(`/standings/?${params}`)
  const map = new Map()
  for (const table of data.standings ?? []) {
    for (const row of table.rows ?? []) {
      map.set(row.competitor.id, { id: row.competitor.id, points: row.points, gamePlayed: row.gamePlayed, gf: row.for, ga: row.against, position: row.position })
    }
  }
  return map
}

const ratingFromStanding = (s, index) => {
  if (!s || s.gamePlayed === 0) return 1500 + Math.max(0, 20 - index) * 6
  const regW = Math.min(s.gamePlayed / 10, 1)
  const ppm = s.points / s.gamePlayed
  const smoothPPM = regW * ppm + (1 - regW) * 1.0
  const gdPerGame = clamp((s.gf - s.ga) / s.gamePlayed, -2.5, 2.5)
  const strength = (smoothPPM / 3) * 0.70 + ((gdPerGame + 2.5) / 5) * 0.30
  return Math.round(1360 + strength * 290) // 1360..1650
}

// =====================================================================
// MAIN
// =====================================================================
console.log('Baixando jogos e standings...')
const [games, standingsMap] = await Promise.all([fetchAllGames(), fetchStandings()])
const teams = buildTeams(games)
const teamsFromStandings = buildTeamsFromStandings(games, standingsMap)
const teamsByProvider = new Map(teams.map(t => [t.scores365Id, t]))
const matches = buildMatches(games, teamsByProvider)
const matchesByRound = matches.reduce((acc, m) => { (acc[m.round] ??= []).push(m); return acc }, {})
const finished = matches.filter(m => m.finished)
const realDist = finished.reduce((a, m) => { a[actualResult(m)] = (a[actualResult(m)] ?? 0) + 1; return a }, {})

console.log(`Jogos: ${games.length} total, ${finished.length} finalizados`)
console.log(`Distribuição real: h:${realDist.home} d:${realDist.draw} a:${realDist.away}`)
console.log()
console.log('BACKTEST HONESTO (sem vazamento de dados)')
console.log('='.repeat(66))
console.log('Modelo'.padEnd(28), 'Acerto ', 'Dist pred'.padEnd(22), 'N')
console.log('-'.repeat(66))

// --- M1: Elo K=22 + cutoff 0.27 (produção v0.5) ---
runBacktest('M1:Elo22+cutoff27 [prod]', teams, matchesByRound, (t, past) => {
  const R = buildEloRatings(t, past, 22)
  const recs = new Map(t.map(tm => [tm.id, []]))
  for (const m of past) {
    recs.get(m.homeTeamId)?.push({ date: m.kickoff.slice(0, 10), teamGoals: m.homeGoals, opponentGoals: m.awayGoals })
    recs.get(m.awayTeamId)?.push({ date: m.kickoff.slice(0, 10), teamGoals: m.awayGoals, opponentGoals: m.homeGoals })
  }
  return (m) => {
    const rH = R.get(m.homeTeamId) ?? 1500, rA = R.get(m.awayTeamId) ?? 1500
    const exp = 1 / (1 + 10 ** ((rA - rH) / 400))
    const sep = Math.abs(exp - 0.5)
    const eloDraw = clamp(0.29 - 0.56 * sep, 0.07, 0.29)
    const eloH = (1 - eloDraw) * exp, eloA = (1 - eloDraw) * (1 - exp)
    const hRecs = sortByDate(recs.get(m.homeTeamId) ?? [])
    const aRecs = sortByDate(recs.get(m.awayTeamId) ?? [])
    const avgGF = (r, n) => r.slice(0, n).reduce((s, x) => s + x.teamGoals, 0) / Math.max(r.slice(0, n).length, 1)
    const avgGA = (r, n) => r.slice(0, n).reduce((s, x) => s + x.opponentGoals, 0) / Math.max(r.slice(0, n).length, 1)
    const xgH = clamp(0.55 + avgGF(hRecs, 10) * 0.36 + avgGA(aRecs, 10) * 0.28 + (rH - rA) / 280 + 0.22, 0.3, 4.0)
    const xgA = clamp(0.55 + avgGF(aRecs, 10) * 0.36 + avgGA(hRecs, 10) * 0.28 - (rH - rA) / 280, 0.3, 4.0)
    let hP = 0, dP = 0, aP = 0
    for (let h = 0; h <= 5; h++) for (let a = 0; a <= 5; a++) {
      const p = poissonP(xgH, h) * poissonP(xgA, a)
      if (h > a) hP += p; else if (h === a) dP += p; else aP += p
    }
    const t2 = hP + dP + aP || 1
    const bH = 0.6 * eloH + 0.4 * hP / t2, bD = 0.6 * eloDraw + 0.4 * dP / t2, bA = 0.6 * eloA + 0.4 * aP / t2
    const bt = bH + bD + bA || 1
    const pH = bH / bt, pD = bD / bt, pA = bA / bt
    return decide(pH, pD, pA, { drawCutoff: 0.27 })
  }
})

// --- M2: PPM-based + cutoff 0.27 ---
runBacktest('M2:PPM+cutoff27', teams, matchesByRound, (t, past) => {
  const R = buildPPMRatings(t, past)
  const recs = new Map(t.map(tm => [tm.id, []]))
  for (const m of past) {
    recs.get(m.homeTeamId)?.push({ date: m.kickoff.slice(0, 10), teamGoals: m.homeGoals, opponentGoals: m.awayGoals })
    recs.get(m.awayTeamId)?.push({ date: m.kickoff.slice(0, 10), teamGoals: m.awayGoals, opponentGoals: m.homeGoals })
  }
  return (m) => {
    const rH = R.get(m.homeTeamId) ?? 1500, rA = R.get(m.awayTeamId) ?? 1500
    const exp = 1 / (1 + 10 ** ((rA - rH) / 400))
    const sep = Math.abs(exp - 0.5)
    const eloDraw = clamp(0.30 - 0.55 * sep, 0.08, 0.30)
    const eloH = (1 - eloDraw) * exp, eloA = (1 - eloDraw) * (1 - exp)
    const hRecs = sortByDate(recs.get(m.homeTeamId) ?? [])
    const aRecs = sortByDate(recs.get(m.awayTeamId) ?? [])
    const avgGF = (r, n) => r.slice(0, n).reduce((s, x) => s + x.teamGoals, 0) / Math.max(r.slice(0, n).length, 1)
    const avgGA = (r, n) => r.slice(0, n).reduce((s, x) => s + x.opponentGoals, 0) / Math.max(r.slice(0, n).length, 1)
    const xgH = clamp(0.55 + avgGF(hRecs, 10) * 0.36 + avgGA(aRecs, 10) * 0.28 + (rH - rA) / 280 + 0.22, 0.3, 4.0)
    const xgA = clamp(0.55 + avgGF(aRecs, 10) * 0.36 + avgGA(hRecs, 10) * 0.28 - (rH - rA) / 280, 0.3, 4.0)
    let hP = 0, dP = 0, aP = 0
    for (let h = 0; h <= 5; h++) for (let a = 0; a <= 5; a++) {
      const p = poissonP(xgH, h) * poissonP(xgA, a)
      if (h > a) hP += p; else if (h === a) dP += p; else aP += p
    }
    const t2 = hP + dP + aP || 1
    const bH = 0.55 * eloH + 0.45 * hP / t2, bD = 0.55 * eloDraw + 0.45 * dP / t2, bA = 0.55 * eloA + 0.45 * aP / t2
    const bt = bH + bD + bA || 1
    const pH = bH / bt, pD = bD / bt, pA = bA / bt
    return decide(pH, pD, pA, { drawCutoff: 0.27 })
  }
})

// --- M3: Dixon-Coles full (ataque×defesa multiplicativo) ---
for (const [label, cut] of [['M3:DC-basic+cut26', 0.26], ['M3:DC-basic+cut27', 0.27], ['M3:DC-basic+cut28', 0.28]]) {
  runBacktest(label, teams, matchesByRound, (t, past) => {
    const { atk, def, avgGoals } = buildAttackDefense(t, past)
    return (m) => {
      const hAtk = atk.get(m.homeTeamId) ?? avgGoals
      const hDef = def.get(m.homeTeamId) ?? avgGoals
      const aAtk = atk.get(m.awayTeamId) ?? avgGoals
      const aDef = def.get(m.awayTeamId) ?? avgGoals
      const { h, d, a } = predictDixonColes(hAtk, hDef, aAtk, aDef, avgGoals, 0.15)
      return decide(h, d, a, { drawCutoff: cut })
    }
  })
}

// --- M4: Home/Away específico + DC ---
for (const [label, cut] of [['M4:HomeAway+cut26', 0.26], ['M4:HomeAway+cut27', 0.27]]) {
  runBacktest(label, teams, matchesByRound, (t, past) => {
    const allStats = buildHomeAwayStats(t, past)
    return (m) => {
      const { h, d, a } = predictHomeAway(m.homeTeamId, m.awayTeamId, allStats.home, allStats.away, allStats, allStats.avgGF)
      return decide(h, d, a, { drawCutoff: cut })
    }
  })
}

// --- M5: PPM + DC combinados (ensemble) ---
for (const [label, w, cut] of [
  ['M5:PPM+DC-blend w60+cut27', 0.60, 0.27],
  ['M5:PPM+DC-blend w50+cut27', 0.50, 0.27],
  ['M5:PPM+DC-blend w40+cut27', 0.40, 0.27],
  ['M5:PPM+DC-blend w50+cut26', 0.50, 0.26],
]) {
  runBacktest(label, teams, matchesByRound, (t, past) => {
    const R = buildPPMRatings(t, past)
    const { atk, def, avgGoals } = buildAttackDefense(t, past)
    return (m) => {
      const rH = R.get(m.homeTeamId) ?? 1500, rA = R.get(m.awayTeamId) ?? 1500
      const exp = 1 / (1 + 10 ** ((rA - rH) / 400))
      const sep = Math.abs(exp - 0.5)
      const eloDraw = clamp(0.30 - 0.55 * sep, 0.08, 0.30)
      const eloH = (1 - eloDraw) * exp, eloA = (1 - eloDraw) * (1 - exp)
      const hAtk = atk.get(m.homeTeamId) ?? avgGoals, hDef = def.get(m.homeTeamId) ?? avgGoals
      const aAtk = atk.get(m.awayTeamId) ?? avgGoals, aDef = def.get(m.awayTeamId) ?? avgGoals
      const dc = predictDixonColes(hAtk, hDef, aAtk, aDef, avgGoals, 0.15)
      const bH = w * eloH + (1 - w) * dc.h
      const bD = w * eloDraw + (1 - w) * dc.d
      const bA = w * eloA + (1 - w) * dc.a
      const bt = bH + bD + bA || 1
      return decide(bH / bt, bD / bt, bA / bt, { drawCutoff: cut })
    }
  })
}

// --- M6: Baseline ingênuo (sempre home) ---
runBacktest('M6:baseline-always-home', teams, matchesByRound, () => () => 'home')
runBacktest('M6:baseline-freq-dist', teams, matchesByRound, () => (_, i) => {
  void i
  const r = Math.random()
  return r < 0.39 ? 'home' : r < 0.69 ? 'draw' : 'away'
})

// --- M7: Standings-seeded + PPM cutoff 0.27 ---
const matchesByRoundStd = buildMatches(games, new Map(teamsFromStandings.map(t => [t.scores365Id, t]))).reduce((acc, m) => { (acc[m.round] ??= []).push(m); return acc }, {})
console.log()
console.log('--- COM STANDINGS COMO PRIOR ---')
runBacktest('M7:standings+PPM+cut27', teamsFromStandings, matchesByRoundStd, (t, past) => {
  const R = buildPPMRatings(t, past)
  const recs = new Map(t.map(tm => [tm.id, []]))
  for (const m of past) {
    recs.get(m.homeTeamId)?.push({ date: m.kickoff.slice(0, 10), teamGoals: m.homeGoals, opponentGoals: m.awayGoals })
    recs.get(m.awayTeamId)?.push({ date: m.kickoff.slice(0, 10), teamGoals: m.awayGoals, opponentGoals: m.homeGoals })
  }
  return (m) => {
    const rH = R.get(m.homeTeamId) ?? 1500, rA = R.get(m.awayTeamId) ?? 1500
    const exp = 1 / (1 + 10 ** ((rA - rH) / 400))
    const sep = Math.abs(exp - 0.5)
    const eloDraw = clamp(0.30 - 0.55 * sep, 0.08, 0.30)
    const eloH = (1 - eloDraw) * exp, eloA = (1 - eloDraw) * (1 - exp)
    const hRecs = sortByDate(recs.get(m.homeTeamId) ?? [])
    const aRecs = sortByDate(recs.get(m.awayTeamId) ?? [])
    const avgGF = (r, n) => r.slice(0, n).reduce((s, x) => s + x.teamGoals, 0) / Math.max(r.slice(0, n).length, 1)
    const avgGA = (r, n) => r.slice(0, n).reduce((s, x) => s + x.opponentGoals, 0) / Math.max(r.slice(0, n).length, 1)
    const xgH = clamp(0.55 + avgGF(hRecs, 10) * 0.36 + avgGA(aRecs, 10) * 0.28 + (rH - rA) / 280 + 0.20, 0.3, 4.0)
    const xgA = clamp(0.55 + avgGF(aRecs, 10) * 0.36 + avgGA(hRecs, 10) * 0.28 - (rH - rA) / 280, 0.3, 4.0)
    let hP = 0, dP = 0, aP = 0
    for (let h = 0; h <= 5; h++) for (let a = 0; a <= 5; a++) {
      const p = poissonP(xgH, h) * poissonP(xgA, a)
      if (h > a) hP += p; else if (h === a) dP += p; else aP += p
    }
    const t2 = hP + dP + aP || 1
    const bH = 0.55 * eloH + 0.45 * hP / t2, bD = 0.55 * eloDraw + 0.45 * dP / t2, bA = 0.55 * eloA + 0.45 * aP / t2
    const bt = bH + bD + bA || 1
    return decide(bH / bt, bD / bt, bA / bt, { drawCutoff: 0.27 })
  }
})

// Mostrar spread de ratings gerados por standings
const stdRatings = teamsFromStandings.map(t => t.baseRating).sort((a,b)=>b-a)
console.log(`\nSpread de ratings (standings-seeded): min=${stdRatings.at(-1)} max=${stdRatings[0]} spread=${stdRatings[0]-stdRatings.at(-1)}`)
console.log(`Spread de ratings (index-based): min=${teams.map(t=>t.baseRating).sort((a,b)=>a-b)[0]} max=${teams.map(t=>t.baseRating).sort((a,b)=>b-a)[0]} spread=${teams.map(t=>t.baseRating).sort((a,b)=>b-a)[0]-teams.map(t=>t.baseRating).sort((a,b)=>a-b)[0]}`)

console.log()
console.log(`Distribuição real: h:${realDist.home} d:${realDist.draw} a:${realDist.away}`)

// =====================================================================
// COMPARAÇÃO JUSTA: HONESTO (com corte) vs VAZADO (metodologia World Cup)
// =====================================================================
const buildM7Pred = (t, matches) => {
  const R = buildPPMRatings(t, matches)
  const recs = new Map(t.map((tm) => [tm.id, []]))
  for (const m of matches) {
    recs.get(m.homeTeamId)?.push({ date: m.kickoff.slice(0, 10), teamGoals: m.homeGoals, opponentGoals: m.awayGoals })
    recs.get(m.awayTeamId)?.push({ date: m.kickoff.slice(0, 10), teamGoals: m.awayGoals, opponentGoals: m.homeGoals })
  }
  return (m) => {
    const rH = R.get(m.homeTeamId) ?? 1500, rA = R.get(m.awayTeamId) ?? 1500
    const exp = 1 / (1 + 10 ** ((rA - rH) / 400))
    const sep = Math.abs(exp - 0.5)
    const eloDraw = clamp(0.30 - 0.55 * sep, 0.08, 0.30)
    const eloH = (1 - eloDraw) * exp, eloA = (1 - eloDraw) * (1 - exp)
    const hRecs = sortByDate(recs.get(m.homeTeamId) ?? [])
    const aRecs = sortByDate(recs.get(m.awayTeamId) ?? [])
    const avgGF = (r, n) => r.slice(0, n).reduce((s, x) => s + x.teamGoals, 0) / Math.max(r.slice(0, n).length, 1)
    const avgGA = (r, n) => r.slice(0, n).reduce((s, x) => s + x.opponentGoals, 0) / Math.max(r.slice(0, n).length, 1)
    const xgH = clamp(0.55 + avgGF(hRecs, 10) * 0.36 + avgGA(aRecs, 10) * 0.28 + (rH - rA) / 280 + 0.20, 0.3, 4.0)
    const xgA = clamp(0.55 + avgGF(aRecs, 10) * 0.36 + avgGA(hRecs, 10) * 0.28 - (rH - rA) / 280, 0.3, 4.0)
    let hP = 0, dP = 0, aP = 0
    for (let h = 0; h <= 5; h++) for (let a = 0; a <= 5; a++) {
      const p = poissonP(xgH, h) * poissonP(xgA, a)
      if (h > a) hP += p; else if (h === a) dP += p; else aP += p
    }
    const t2 = hP + dP + aP || 1
    const bH = 0.55 * eloH + 0.45 * hP / t2, bD = 0.55 * eloDraw + 0.45 * dP / t2, bA = 0.55 * eloA + 0.45 * aP / t2
    const bt = bH + bD + bA || 1
    return decide(bH / bt, bD / bt, bA / bt, { drawCutoff: 0.27 })
  }
}

console.log()
console.log('=== COMPARAÇÃO DE METODOLOGIA (mesmo motor M7) ===')
const honest = runBacktest('HONESTO (walk-forward)', teamsFromStandings, matchesByRoundStd, buildM7Pred)
reportByBucket('honesto por rodada', honest.results)
const leaked = runLeaked('VAZADO (=World Cup)', teamsFromStandings, matchesByRoundStd, buildM7Pred)
reportByBucket('vazado por rodada', leaked.results)
console.log()
console.log('Nota: "VAZADO" usa TODOS os jogos (inclusive posteriores) para prever cada partida,')
console.log('exatamente como o Orion World Cup faz. O número honesto é o único sem colar da gabarito.')

// =====================================================================
// BACKTEST HONESTO DOS MERCADOS DE APOSTA (over/under, ambas marcam)
// =====================================================================
const buildM7Lambdas = (t, matches) => {
  const R = buildPPMRatings(t, matches)
  const recs = new Map(t.map((tm) => [tm.id, []]))
  for (const m of matches) {
    recs.get(m.homeTeamId)?.push({ date: m.kickoff.slice(0, 10), teamGoals: m.homeGoals, opponentGoals: m.awayGoals })
    recs.get(m.awayTeamId)?.push({ date: m.kickoff.slice(0, 10), teamGoals: m.awayGoals, opponentGoals: m.homeGoals })
  }
  return (m) => {
    const rH = R.get(m.homeTeamId) ?? 1500, rA = R.get(m.awayTeamId) ?? 1500
    const hRecs = sortByDate(recs.get(m.homeTeamId) ?? [])
    const aRecs = sortByDate(recs.get(m.awayTeamId) ?? [])
    const avgGF = (r, n) => r.slice(0, n).reduce((s, x) => s + x.teamGoals, 0) / Math.max(r.slice(0, n).length, 1)
    const avgGA = (r, n) => r.slice(0, n).reduce((s, x) => s + x.opponentGoals, 0) / Math.max(r.slice(0, n).length, 1)
    const xgH = clamp(0.55 + avgGF(hRecs, 10) * 0.36 + avgGA(aRecs, 10) * 0.28 + (rH - rA) / 280 + 0.20, 0.3, 4.0)
    const xgA = clamp(0.55 + avgGF(aRecs, 10) * 0.36 + avgGA(hRecs, 10) * 0.28 - (rH - rA) / 280, 0.3, 4.0)
    const exp = 1 / (1 + 10 ** ((rA - rH) / 400))
    const sep = Math.abs(exp - 0.5)
    const eloDraw = clamp(0.30 - 0.55 * sep, 0.08, 0.30)
    let hP = 0, dP = 0, aP = 0
    for (let h = 0; h <= 5; h++) for (let a = 0; a <= 5; a++) {
      const p = poissonP(xgH, h) * poissonP(xgA, a)
      if (h > a) hP += p; else if (h === a) dP += p; else aP += p
    }
    const pt = hP + dP + aP || 1
    const pH = 0.55 * ((1 - eloDraw) * exp) + 0.45 * hP / pt
    const pD = 0.55 * eloDraw + 0.45 * dP / pt
    const pA = 0.55 * ((1 - eloDraw) * (1 - exp)) + 0.45 * aP / pt
    const pTot = pH + pD + pA || 1
    return { xgH, xgA, pH: pH / pTot, pD: pD / pTot, pA: pA / pTot }
  }
}

const poissonAtLeast = (lambda, k) => {
  let below = 0
  for (let i = 0; i < k; i++) below += poissonP(lambda, i)
  return 1 - below
}

const runMarketBacktest = () => {
  const rounds = Object.keys(matchesByRoundStd).map(Number).sort((a, b) => a - b)
  const past = []
  const stats = { ou25: { h: 0, n: 0 }, btts: { h: 0, n: 0 }, ou15: { h: 0, n: 0 }, bestGoals: { h: 0, n: 0 }, bestBtts: { h: 0, n: 0 }, dc: { h: 0, n: 0 } }
  for (const round of rounds) {
    const lambdas = buildM7Lambdas(teamsFromStandings, past)
    for (const m of matchesByRoundStd[round]) {
      if (!m.finished) continue
      const { xgH, xgA } = lambdas(m)
      const total = m.homeGoals + m.awayGoals
      const bothScored = m.homeGoals > 0 && m.awayGoals > 0
      const lambdaTotal = xgH + xgA
      // Over/Under 2.5
      const pOver25 = poissonAtLeast(lambdaTotal, 3)
      const pick25 = pOver25 >= 0.5 ? 'over' : 'under'
      const hit25 = pick25 === 'over' ? total > 2.5 : total < 2.5
      stats.ou25.n++; if (hit25) stats.ou25.h++
      // Over/Under 1.5
      const pOver15 = poissonAtLeast(lambdaTotal, 2)
      const pick15 = pOver15 >= 0.5 ? 'over' : 'under'
      const hit15 = pick15 === 'over' ? total > 1.5 : total < 1.5
      stats.ou15.n++; if (hit15) stats.ou15.h++
      // MELHOR linha de gols (mesma logica do dashboard: escolhe maior probabilidade entre 1.5/2.5/3.5)
      const goalCands = [1.5, 2.5, 3.5].flatMap((line) => {
        const pOver = poissonAtLeast(lambdaTotal, Math.ceil(line))
        return [
          { line, side: 'over', p: pOver },
          { line, side: 'under', p: 1 - pOver },
        ]
      }).sort((a, b) => b.p - a.p)
      const bg = goalCands[0]
      const hitBG = bg.side === 'over' ? total > bg.line : total < bg.line
      stats.bestGoals.n++; if (hitBG) stats.bestGoals.h++
      // BTTS
      const pBtts = (1 - poissonP(xgH, 0)) * (1 - poissonP(xgA, 0))
      const pickBtts = pBtts >= 0.5 ? 'yes' : 'no'
      const hitBtts = pickBtts === 'yes' ? bothScored : !bothScored
      stats.btts.n++; if (hitBtts) stats.btts.h++
      // Melhor lado BTTS (maior probabilidade)
      const bttsHit = Math.max(pBtts, 1 - pBtts) === pBtts ? bothScored : !bothScored
      stats.bestBtts.n++; if (bttsHit) stats.bestBtts.h++
      // Dupla chance (mesma logica do dashboard: cobre os dois resultados mais provaveis)
      const { pH, pD, pA } = lambdas(m)
      const actual = m.homeGoals > m.awayGoals ? 'home' : m.homeGoals < m.awayGoals ? 'away' : 'draw'
      const dcOptions = [
        { excl: 'away', p: pH + pD },
        { excl: 'draw', p: pH + pA },
        { excl: 'home', p: pD + pA },
      ].sort((a, b) => b.p - a.p)
      const dcHit = actual !== dcOptions[0].excl
      stats.dc.n++; if (dcHit) stats.dc.h++
    }
    past.push(...matchesByRoundStd[round].filter((m) => m.finished))
  }
  const pct = (o) => `${Math.round(o.h / o.n * 100)}% (${o.h}/${o.n})`
  console.log()
  console.log('=== MERCADOS DE APOSTA (walk-forward honesto) ===')
  console.log('Over/Under 2.5 fixo   :', pct(stats.ou25))
  console.log('Over/Under 1.5 fixo   :', pct(stats.ou15))
  console.log('Ambas marcam fixo     :', pct(stats.btts))
  console.log('--- o que o dashboard realmente recomenda ---')
  console.log('Melhor linha de gols  :', pct(stats.bestGoals))
  console.log('Dupla chance          :', pct(stats.dc))
  console.log('Melhor lado BTTS      :', pct(stats.bestBtts))
}
runMarketBacktest()