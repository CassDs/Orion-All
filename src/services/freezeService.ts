import { ORION_ENGINE_VERSION, predictMatch } from '../domain/prediction'
import type { Match } from '../domain/types'
import { fetchLeagueData365, LEAGUES_365, type League365Config } from './scores365'
import { fetchFrozenRows, insertFrozenRows, type FrozenRowInsert, type SupabaseConfig } from './supabaseFrozen'

export type FreezeResult = {
  leagueId: string
  frozen: number
  alreadyFrozen: number
  error?: string
}

const currentRoundFrom = (matches: Match[]) => {
  const orderedMatches = [...matches].sort(
    (first, second) => new Date(first.kickoff).getTime() - new Date(second.kickoff).getTime(),
  )
  const now = Date.now()
  const nextMatch = orderedMatches.find((match) => new Date(match.kickoff).getTime() >= now)

  if (nextMatch) return nextMatch.round

  return orderedMatches.at(-1)?.round ?? 1
}

// Congela (write-once) as predições dos jogos ainda não iniciados da rodada em foco
// e da seguinte. Com `includePast` (backfill único), também congela rodadas antigas —
// o motor aplica corte temporal (cutoffDate = kickoff), então é walk-forward honesto,
// e por ser write-once o resultado fica estável para sempre.
export const freezeLeague = async (
  league: League365Config,
  supabase: SupabaseConfig,
  options: { includePast?: boolean } = {},
): Promise<FreezeResult> => {
  const data = await fetchLeagueData365(league)
  const currentRound = currentRoundFrom(data.matches)
  const existingKeys = new Set(
    (await fetchFrozenRows(supabase, league.id, ORION_ENGINE_VERSION)).map((row) => row.storage_key),
  )
  const now = Date.now()

  const candidates = data.matches.filter(
    (match) =>
      match.round <= currentRound + 1 &&
      (options.includePast || (match.status === 'scheduled' && new Date(match.kickoff).getTime() > now)) &&
      !existingKeys.has(`${ORION_ENGINE_VERSION}:${match.id}`),
  )

  const rows: FrozenRowInsert[] = candidates.map((match) => {
    const prediction = predictMatch(match, data.teams, data.recordsByTeam)

    return {
      storage_key: `${ORION_ENGINE_VERSION}:${match.id}`,
      match_id: match.id,
      engine_version: ORION_ENGINE_VERSION,
      league_id: league.id,
      kickoff: match.kickoff,
      payload: { ...prediction, frozenSource: 'server' as const },
    }
  })

  const frozen = await insertFrozenRows(supabase, rows)

  return { leagueId: league.id, frozen, alreadyFrozen: existingKeys.size }
}

export const freezeAllLeagues = async (
  supabase: SupabaseConfig,
  leagueFilter?: string,
  options: { includePast?: boolean } = {},
) => {
  const results: FreezeResult[] = []

  for (const league of LEAGUES_365) {
    if (leagueFilter && !league.id.includes(leagueFilter)) continue

    try {
      results.push(await freezeLeague(league, supabase, options))
    } catch (error) {
      results.push({
        leagueId: league.id,
        frozen: 0,
        alreadyFrozen: 0,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return results
}
