# Configuração Supabase + Vercel — Predições Congeladas no Banco

Este guia lista **tudo que você precisa criar/configurar** (passos manuais nos painéis) para que o congelamento de predições saia do IndexedDB do navegador e passe a ser feito **uma única vez, no servidor, antes de cada jogo** — eliminando o risco de placares/predições mudarem retroativamente.

## Visão geral da arquitetura

```
Vercel Cron (1x/dia)
   └─> /api/freeze  (serverless function)
         ├─ busca jogos da rodada em foco na 365Scores
         ├─ gera predições com o motor Orion
         └─ INSERT no Supabase (nunca UPDATE — write-once)

Navegador (app React)
   └─ apenas LÊ as predições congeladas do Supabase
      (IndexedDB vira só cache local)
```

Regras de integridade:
- Chave única `engine_version:match_id` — inserção com "on conflict do nothing".
- Toda predição tem `created_at`; o cálculo de acurácia só considera predições com `created_at < kickoff`.
- O frontend usa a **anon key** (somente leitura via RLS). A escrita usa a **service role key**, que só existe no servidor.

---

## Parte 1 — Supabase

### 1.1 Criar o projeto
1. Acesse https://supabase.com e crie uma conta (pode usar o login do GitHub).
2. **New project**:
   - Organization: a sua
   - Name: `orion-prediction`
   - Database password: gere uma forte e **guarde** (não vamos usar no app, mas é preciso para o painel)
   - Region: `South America (São Paulo)` — menor latência
   - Plano: **Free** é suficiente
3. Aguarde o provisionamento (~2 min).

### 1.2 Criar a tabela e as políticas de acesso
No painel do projeto, abra **SQL Editor** → **New query**, cole e execute o SQL abaixo:

```sql
-- Tabela de predições congeladas (write-once)
create table public.frozen_predictions (
  storage_key    text primary key,          -- `${engine_version}:${match_id}`
  match_id       text not null,
  engine_version text not null,
  league_id      text not null,             -- ex: brasileirao-serie-b-2026
  kickoff        timestamptz not null,      -- data/hora do jogo
  payload        jsonb not null,            -- MatchPrediction completo
  created_at     timestamptz not null default now()
);

create index idx_frozen_league on public.frozen_predictions (league_id, engine_version);
create index idx_frozen_match on public.frozen_predictions (match_id);

-- RLS: leitura pública, escrita bloqueada (só a service role escreve)
alter table public.frozen_predictions enable row level security;

create policy "leitura publica"
  on public.frozen_predictions
  for select
  to anon, authenticated
  using (true);

-- Nenhuma policy de INSERT/UPDATE/DELETE para anon:
-- escrita só via service role key (que ignora RLS), usada apenas no servidor.
```

### 1.3 Anotar as credenciais
Em **Project Settings → API**, copie:

| Item | Onde fica | Uso |
|---|---|---|
| `Project URL` | API Settings | frontend + serverless |
| `anon public` key | API Settings → Project API keys | frontend (só leitura) |
| `service_role` key | API Settings → Project API keys | **somente** na serverless da Vercel — nunca no frontend, nunca commitada |

---

## Parte 2 — Vercel

### 2.1 Projeto
Se o app ainda não está na Vercel, importe o repositório `CassDs/Orion-All` e configure:
- **Root Directory**: `Orion Prediction`
- Framework preset: Vite

### 2.2 Variáveis de ambiente
Em **Settings → Environment Variables** do projeto, crie (para Production, Preview e Development):

| Nome | Valor | Exposta ao browser? |
|---|---|---|
| `VITE_SUPABASE_URL` | Project URL do Supabase | Sim (prefixo VITE_) |
| `VITE_SUPABASE_ANON_KEY` | anon public key | Sim (é segura para exposição, RLS protege) |
| `SUPABASE_URL` | Project URL do Supabase | Não (usada na function) |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key | **Não — jamais com prefixo VITE_** |
| `CRON_SECRET` | uma string aleatória longa (ex: gere com `openssl rand -hex 32`) | Não |

> `CRON_SECRET` protege o endpoint `/api/freeze` para que só o cron da Vercel (ou você) consiga acioná-lo.

### 2.3 Cron Job
Nada a fazer no painel: o agendamento vai no arquivo `vercel.json` do projeto (eu crio no código), por exemplo:

```json
{
  "crons": [
    { "path": "/api/freeze", "schedule": "0 9 * * *" }
  ]
}
```

> Plano Hobby da Vercel permite cron com frequência mínima diária — suficiente, pois congelamos a rodada inteira antes dos jogos. Se quiser congelar mais perto do kickoff (ex.: de hora em hora), é preciso plano Pro.

### 2.4 Ambiente local (`.env.local`)
Para desenvolvimento local, crie `Orion Prediction/.env.local` (já deve estar no `.gitignore`):

```
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

---

## Parte 3 — O que eu implemento depois disso

Com o acima pronto, eu faço no código:

1. **`api/freeze.ts`** (Vercel serverless): busca jogos das 3 ligas, gera predições dos jogos ainda não congelados cujo kickoff é futuro, insere no Supabase com `on conflict do nothing`, protegido por `CRON_SECRET`.
2. **`vercel.json`** com o cron diário.
3. **`predictionStore.ts`**: leitura das predições no Supabase (anon key); IndexedDB rebaixado a cache. Sem predição no banco para jogo já iniciado → aparece "sem predição registrada" (nunca recalcula com viés).
4. **Acurácia**: contabiliza apenas predições com `created_at < kickoff`.

## Checklist do que você me entrega

- [ ] Projeto Supabase criado e SQL da seção 1.2 executado
- [ ] `VITE_SUPABASE_URL` / Project URL
- [ ] `VITE_SUPABASE_ANON_KEY` / anon key
- [ ] Confirmação de que `SUPABASE_SERVICE_ROLE_KEY` e `CRON_SECRET` foram cadastradas na Vercel (não precisa me mandar os valores — aliás, **não** me mande a service role key nem o cron secret pelo chat; cadastre direto na Vercel)
- [ ] Projeto na Vercel com Root Directory `Orion Prediction`
