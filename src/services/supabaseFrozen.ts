import type { MatchPrediction } from '../domain/types'

export type SupabaseConfig = {
  url: string
  apiKey: string
}

export type FrozenRow = {
  storage_key: string
  match_id: string
  engine_version: string
  league_id: string
  kickoff: string
  payload: MatchPrediction
  created_at: string
}

export type FrozenRowInsert = Omit<FrozenRow, 'created_at'>

const buildHeaders = (apiKey: string) => ({
  apikey: apiKey,
  authorization: `Bearer ${apiKey}`,
  'content-type': 'application/json',
})

export const fetchFrozenRows = async (
  config: SupabaseConfig,
  leagueId: string,
  engineVersion: string,
): Promise<FrozenRow[]> => {
  const params = new URLSearchParams({
    league_id: `eq.${leagueId}`,
    engine_version: `eq.${engineVersion}`,
    select: 'storage_key,match_id,engine_version,league_id,kickoff,payload,created_at',
  })
  const response = await fetch(`${config.url}/rest/v1/frozen_predictions?${params.toString()}`, {
    headers: buildHeaders(config.apiKey),
  })

  if (!response.ok) {
    throw new Error(`Supabase read failed: ${response.status}`)
  }

  return response.json() as Promise<FrozenRow[]>
}

// Write-once: conflitos de chave são ignorados (nunca sobrescreve predição existente).
// Inserção em lotes para não estourar o limite de payload (backfill pode ter centenas de linhas).
export const insertFrozenRows = async (config: SupabaseConfig, rows: FrozenRowInsert[]): Promise<number> => {
  if (rows.length === 0) return 0

  const CHUNK_SIZE = 40
  let inserted = 0

  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    const chunk = rows.slice(start, start + CHUNK_SIZE)
    const response = await fetch(`${config.url}/rest/v1/frozen_predictions?on_conflict=storage_key`, {
      method: 'POST',
      headers: {
        ...buildHeaders(config.apiKey),
        prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Supabase insert failed: ${response.status} ${detail}`)
    }

    inserted += chunk.length
  }

  return inserted
}
