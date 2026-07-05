/// <reference types="node" />
// Executa o congelamento localmente: npm run freeze [filtro-da-liga] [--backfill]
// Ex.: npm run freeze                       -> todas as ligas (só jogos futuros)
//      npm run freeze serie-d               -> apenas Série D
//      npm run freeze -- serie-b --backfill -> Série B incluindo rodadas antigas (retroativas, uma vez só)
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freezeAllLeagues } from '../src/services/freezeService'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = resolve(root, '.env.local')

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const parsed = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/)
    if (parsed && process.env[parsed[1]] === undefined) {
      process.env[parsed[1]] = parsed[2].replace(/^['"]|['"]$/g, '')
    }
  }
}

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const apiKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !apiKey) {
  console.error('Configure SUPABASE_URL e SUPABASE_SECRET_KEY no .env.local')
  process.exit(1)
}

const args = process.argv.slice(2)
const includePast = args.includes('--backfill')
const leagueFilter = args.find((arg) => !arg.startsWith('--'))
console.log(`Congelando predicoes${leagueFilter ? ` (filtro: ${leagueFilter})` : ''}${includePast ? ' [backfill]' : ''}...`)

const results = await freezeAllLeagues({ url, apiKey }, leagueFilter, { includePast })
console.log(JSON.stringify(results, null, 2))

if (results.some((result) => result.error)) process.exit(1)
