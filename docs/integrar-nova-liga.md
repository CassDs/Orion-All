# Como integrar uma nova liga no Orion Prediction

Sim, é fácil: toda a integração é orientada por configuração. O sistema inteiro (sincronização 365Scores, motor de predição, congelamento no Supabase, cron, tela inicial) itera sobre a lista `LEAGUES_365` em [src/services/scores365.ts](../src/services/scores365.ts). Adicionar uma liga = adicionar **uma entrada nessa lista**.

## Passo 1 — Descobrir o ID da competição na 365Scores

Duas formas:

**A) Pela URL do site.** Abra https://www.365scores.com, navegue até a liga e olhe a URL:
```
https://www.365scores.com/pt-br/football/league/brasileirao-serie-a-113
                                                                    ^^^ id = 113
```

**B) Pela API (PowerShell).** Liste as competições de um país (o `countries` é o ID do país na 365Scores; Brasil = 21, Inglaterra = 6, Espanha = 2, Itália = 3, Alemanha = 4, França = 5, Argentina = 8):

```powershell
$r = Invoke-RestMethod -Uri "https://webws.365scores.com/web/competitions/?appTypeId=5&langId=31&countries=21" -Headers @{accept='application/json'; 'user-agent'='Mozilla/5.0'}
$r.competitions | ForEach-Object { "$($_.id) => $($_.name)" }
```

IDs já conhecidos:
| Liga | ID |
|---|---|
| Brasileirão Série A | 113 |
| Brasileirão Série B | 116 |
| Brasileirão Série C | 5518 |
| Brasileirão Série D | 5519 |

## Passo 2 — Adicionar a entrada em `LEAGUES_365`

Em [src/services/scores365.ts](../src/services/scores365.ts), adicione ao array `LEAGUES_365`:

```ts
{
  id: 'brasileirao-serie-a-2026',      // slug único (usado no banco e nas rotas)
  scores365Id: 113,                     // ID descoberto no passo 1
  name: 'Brasileirao Serie A',
  country: 'Brasil',
  level: 1,                             // divisão (aparece no card da liga)
  tagline: 'Elite do futebol brasileiro com dados 365Scores',
  primaryColor: '#009c3b',              // cores do tema da liga no painel
  secondaryColor: '#ffdf00',
  accentColor: '#002776',
},
```

**Isso é tudo para o essencial.** Automáticos, sem código adicional:
- A liga aparece na tela inicial (card com logo oficial da 365Scores).
- Sincronização de jogos, classificação, histórico dos times e estatísticas avançadas.
- Fases eliminatórias/grupos: rodadas são normalizadas em sequência contígua (`normalizeRounds`), mata-mata com ida/volta vira rodadas separadas.
- O congelamento (cron diário `/api/freeze` e `npm run freeze`) passa a incluir a liga automaticamente.

## Passo 3 — País novo? Adicione a bandeira

Se a liga for de um país que ainda não existe no app, adicione o emoji em `countryFlags` no [src/App.tsx](../src/App.tsx):

```ts
const countryFlags: Record<string, string> = {
  Brasil: '🇧🇷',
  Inglaterra: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
}
```

O filtro de países da tela inicial é gerado automaticamente a partir das ligas cadastradas.

## Passo 4 — Backfill único das rodadas já jogadas

Depois do deploy (ou localmente com `.env.local` configurado):

```powershell
npm run freeze -- serie-a --backfill
```

O filtro é qualquer trecho do `id` da liga. Isso gera as predições das rodadas antigas **uma única vez** (walk-forward com corte temporal — sem dados futuros) e as grava no Supabase write-once. Daí em diante o cron diário congela cada rodada antes dos jogos.

## Limitações e cuidados

1. **Temporada por ano-calendário.** O filtro atual usa `SEASON = 2026` comparando com o **ano do jogo** (`gameSeason`). Funciona para ligas de calendário anual (Brasil, Argentina, MLS, nórdicos). **Ligas europeias (ago–mai) cruzam o ano** e hoje perderiam os jogos da primeira metade — para integrá-las é preciso ajustar `gameSeason`/`SEASON` em `scores365.ts` para aceitar um intervalo de datas por liga (mudança pequena, me peça quando precisar).
2. **Fallback local só existe para a Série B.** Ligas novas mostram mensagem de erro se a API 365Scores falhar (comportamento intencional para não exibir dados errados).
3. **Ligas grandes são mais lentas na 1ª sincronização.** O tempo cresce com o nº de times (histórico por time). Série D (64 times) leva alguns minutos; ligas de 18–20 times, ~30–60s.
4. **Rating inicial usa a classificação atual.** Em ligas sem tabela (fase de mata-mata pura) o rating cai para o fallback por popularidade — qualidade de predição menor no início.
5. **`engineVersion`:** se você mudar o motor (`ORION_ENGINE_VERSION`), todas as ligas precisam de novo backfill, pois as predições congeladas são chaveadas por versão.

## Checklist rápido

- [ ] ID da 365Scores descoberto
- [ ] Entrada adicionada em `LEAGUES_365`
- [ ] Bandeira do país em `countryFlags` (se país novo)
- [ ] Liga de ano-calendário? (se europeia, pedir ajuste do filtro de temporada)
- [ ] `npm run build` ok
- [ ] Deploy + `npm run freeze -- <filtro> --backfill` uma vez
