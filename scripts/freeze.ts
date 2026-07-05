/// <reference types="node" />
// Executa o congelamento localmente: npm run freeze [filtro-da-liga]
// Ex.: npm run freeze            -> todas as ligas
//      npm run freeze serie-d    -> apenas Série D
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

const leagueFilter = process.argv[2]
console.log(`Congelando predicoes${leagueFilter ? ` (filtro: ${leagueFilter})` : ''}...`)

const results = await freezeAllLeagues({ url, apiKey }, leagueFilter)
console.log(JSON.stringify(results, null, 2))

if (results.some((result) => result.error)) process.exit(1)
