/// <reference types="node" />
import { freezeAllLeagues } from '../src/services/freezeService'

type VercelRequest = {
  headers: Record<string, string | string[] | undefined>
  query?: Record<string, string | string[] | undefined>
}

type VercelResponse = {
  status: (code: number) => VercelResponse
  json: (body: unknown) => void
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET
  const authorization = req.headers.authorization

  if (secret && authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const apiKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !apiKey) {
    res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SECRET_KEY nao configuradas' })
    return
  }

  const leagueFilter = typeof req.query?.league === 'string' ? req.query.league : undefined
  const results = await freezeAllLeagues({ url, apiKey }, leagueFilter)
  const hasError = results.some((result) => result.error)

  res.status(hasError ? 207 : 200).json({ ok: !hasError, ranAt: new Date().toISOString(), results })
}
