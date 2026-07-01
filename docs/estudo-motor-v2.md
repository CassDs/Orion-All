# Estudo: Motor Preditivo Orion Club v2 — Modelo de 4 Pesos

**Status:** Estudo pré-implementação  
**Data:** Julho 2026  
**Motor atual:** orion-club-v0.6 (acerto resultado ≈ 50%)  
**Objetivo:** Definir arquitetura antes de codificar

---

## 1. Diagnóstico do Motor Atual

O motor v0.6 usa três janelas temporais — temporada toda, últimos 10 e últimos 5 jogos — mas as mistura sem separação de mando (casa/fora) e sem confrontos diretos. Os pesos do xG ainda são pequenos apesar do aumento feito. O backtest honesto (sem vazamento de dados) mostrou que o teto é **40-41%** sem xG e **50%** com xG da API.

Principais fraquezas identificadas:
- Registros de casa e fora misturados — um time pode ter 70% de vitórias em casa e 20% fora, e o modelo trata como 45% em ambos.
- Sem dados da temporada anterior — times promovidos da Série A ou rebaixados da Série B carregam histórico relevante.
- Sem confrontos diretos (H2H) — padrões históricos entre dois times específicos não são capturados.
- Data de corte nas previsões históricas — quando se analisa uma rodada passada, o modelo usa dados futuros àquela data (leakage).

---

## 2. Arquitetura Proposta: 4 Pesos Temporais

```
Coeficiente Final = (P1 × w1) + (P2 × w2) + (P3 × w3) + (P4 × w4)
                   + Ajuste H2H
                   × Fator de Mando
```

### P1 — Temporada Anterior (recorte 12 meses)

**O que captura:** identidade tática do time, qualidade de elenco base, padrão de longa duração.  
**Por que importa:** times que sobem da Série A ou que têm elenco estável carregam sinal histórico forte. Times recém-promovidos tiveram desempenho diferente na Série C e esse dado deve ter peso reduzido.

**Dados necessários:**
- Resultado de cada jogo (W/D/L)
- Gols feitos e sofridos por jogo
- xG (quando disponível)
- Mando (casa/fora)

**Dados disponíveis:** A API do 365Scores retorna jogos via `/games/results/?competitors={id}`. Ao paginar, é possível obter jogos de 2025. Cada time exige 1 requisição adicional. Para 20 times = 20 requisições extras no primeiro sync.

**Peso proposto:** `w1 = 0.15`  
**Justificativa:** É o sinal mais antigo e pode estar desatualizado (mudanças de treinador, elenco). Serve como ancoragem, não como fator dominante. Times em divisão diferente em 2025 (e.g., Série A → B) teriam peso atenuado adicionalmente.

---

### P2 — Temporada Atual (todos os jogos de 2026)

**O que captura:** posição na tabela, forma geral da temporada, identidade tática atual.  
**Por que importa:** é o sinal mais completo e menos ruidoso — maior amostra de dados do contexto exato (mesma competição, mesmo nível).

**Dados disponíveis:** já disponíveis integralmente. São os 15–38 jogos jogados no ano.

**Peso proposto:** `w2 = 0.35`  
**Justificativa:** maior peso porque é o contexto mais relevante — mesma competição, mesmos adversários de nível similar.

---

### P3 — Últimos 10 Jogos

**O que captura:** forma recente, momentum, estado físico/emocional do time.  
**Por que importa:** times mudam de treinador, têm lesões, passam por crises. Os últimos 10 jogos capturam a tendência atual melhor que a temporada toda.

**Dados disponíveis:** os primeiros 14 resultados de `fetchRecentTeamGames365` já incluem os últimos 10.

**Peso proposto:** `w3 = 0.30`  
**Justificativa:** forte sinal de momentum. Porém 10 jogos ainda podem ter ruído por adversários muito fracos/fortes. Complementa P2.

---

### P4 — Últimos 5 Jogos

**O que captura:** estado imediato do time — últimas semanas.  
**Por que importa:** é onde residem xG, finalizações, escanteios e estatísticas avançadas (os primeiros 5 jogos têm `hasStats = true` na API). Captura também o ritmo de partidas (fadiga ou descanso).

**Dados disponíveis:** já buscados via `fetchGameAdvancedStats365`. Inclui: xG, chutes, chutes ao alvo, escanteios, cartões.

**Peso proposto:** `w4 = 0.20`  
**Justificativa:** menor número de jogos = mais ruído, mas inclui as melhores estatísticas. O xG dos últimos 5 jogos é o dado mais preditivo disponível.

---

## 3. Componentes de cada Peso

Cada janela temporal gera um **Score** que agrega diferentes dimensões:

```
PScore = PPM × 0.32
       + GolsFeitos × 0.16
       + (−GolsSofridos) × 0.14
       + xGDiff × 0.18          ← apenas P4 e parcialmente P3 quando disponível
       + CleanSheetRate × 0.10
       + FinalizaçõesAoAlvo × 0.06  ← apenas P3/P4 com hasStats
       + (−CartoesAmarelos × 0.04)  ← disciplina ofensiva
```

> **Nota:** os pesos internos de cada componente devem ser ajustados empiricamente. Os valores acima são um ponto de partida razoável baseado na literatura de football analytics (Dixon-Coles, Maher, Opta/StatsBomb research).

**Por que xGDiff com peso 0.18 (alto):**  
- xG mede a qualidade real das chances criadas e cedidas, não o acaso de gols marcados.
- Em 5 jogos, xG prevê melhor gols futuros do que gols reais (correlação ~2x maior).
- Peso alto em P4 (quando disponível) e moderado em P3.

---

## 4. Mando de Campo (Casa/Fora) por Time

**Problema atual:** o modelo usa uma vantagem doméstica fixa de `+0.22 gols` para todo time. Na realidade, há times com vantagem doméstica forte (+0.5 gols) e outros quase nula (+0.05 gols).

**Solução proposta:** calcular vantagem doméstica específica por time.

```
homeAdvantageTeam = médiaGolsEmCasa − médiaGolsFora
                  (mínimo de 5 jogos casa + 5 fora para ser confiável)
```

**Implementação nos pesos:**

Cada janela temporal (P2, P3, P4) gera dois sub-scores separados:

| Sub-score | Usado quando |
|---|---|
| `homeScore` | time joga em casa |
| `awayScore` | time joga fora |

O Expected Goals final usa:
```
λ_home = f(homeScore_casa, awayScore_fora)
λ_away = f(awayScore_fora, homeScore_casa)
```

**Impacto esperado:** +2–3% de acurácia. Times como CRB (forte em casa), Náutico (fraco fora) são hoje mal previstos porque o modelo generaliza a vantagem doméstica.

---

## 5. Confrontos Diretos (H2H — últimos 5)

**O que captura:** padrão histórico específico entre os dois times — dominância, equilíbrio, estilo de jogo.

**Dados disponíveis:**  
- Os registros já carregados incluem `opponentId`. Filtrar `records.filter(r => r.opponentId === opponent.id)` fornece os H2H disponíveis.
- No banco atual: ao todo 15 rodadas × 2 confrontos esperados por par de times = até 2 jogos na temporada. Com dados de 2025, podemos ter até 4–6 confrontos.

**Ajuste H2H:**
```
h2hBalance = (vitórias H2H − derrotas H2H) / total H2H jogos
h2hAdjustment = clamp(h2hBalance × 0.06, −0.05, +0.05)
```

O ajuste máximo é ±5% na probabilidade final — pequeno, mas vai na direção correta.

**Limitações:**
- Menos de 3 jogos H2H disponíveis → ajuste = 0 (sem sinal suficiente)
- Times que se encontram pela primeira vez na Série B = sem H2H
- Dados de temporadas anteriores em outras divisões têm menos peso

**Impacto esperado:** +0.5–1% de acurácia. Pequeno, mas acumula com os outros.

---

## 6. Data de Corte para Previsões Históricas

**Problema identificado:** quando o modelo prevê um jogo da rodada 5 hoje (com dados da rodada 15 disponíveis), ele usa xG e gols de jogos que ainda não tinham acontecido. Isso é data leakage — infla a acurácia aparente.

**Solução:** passar `cutoffDate: string` para a função de previsão.

```typescript
// ATUAL
const home = forecastTeam(homeTeam, recordsByTeam[homeTeam.id])

// PROPOSTO
const home = forecastTeam(homeTeam, recordsByTeam[homeTeam.id], cutoffDate)
// forecastTeam filtra: records.filter(r => r.date < cutoffDate)
```

**Quando aplicar:**
- Previsões de rodadas passadas (modo análise): usar `match.kickoff` como cutoff
- Previsões de próximas rodadas (modo operacional): sem corte (todos os dados disponíveis)

**Impacto na acurácia exibida:** vai REDUZIR o número de acertos exibido na UI para rodadas passadas — porque atualmente o modelo "trapaceia" ao usar dados futuros. Mas torna o número honesto.

---

## 7. Estatísticas Avançadas (P3/P4)

Atualmente apenas P4 usa xG e chutes. A proposta é incluí-los também em P3 quando disponíveis.

### Dados disponíveis por jogo (via `fetchGameAdvancedStats365`):

| Estatística | Campo | Disponível |
|---|---|---|
| xG feito | `xgFor` | ✓ (últimos 5 jogos) |
| xG sofrido | `xgAgainst` | ✓ |
| Chutes | `shotsFor` | ✓ |
| Chutes ao alvo | `shotsOnTargetFor` | ✓ |
| Escanteios | `cornersFor` | ✓ |
| Cartões amarelos | `yellowCardsFor` | ✓ |
| Cartões vermelhos | `redCardsFor` | ✓ |
| Faltas sofridas | ✗ | Não mapeado ainda |
| Defesas do goleiro | ✗ | Não disponível na API |
| Posse de bola | ✗ | Não disponível no endpoint atual |
| Impedimentos | ✗ | Não disponível consistentemente |

**Defesas do goleiro:** a API do 365Scores não expõe saves diretamente nos events — seria preciso um endpoint de estatísticas por jogador. Fora do escopo agora.

### Como usar finalizações ao alvo (P3):

```
shotEfficiency = shotsOnTargetFor / max(shotsFor, 1)
shotSuppressionRate = shotsOnTargetAgainst / max(shotsAgainst, 1)  ← menor é melhor
```

Esses dois índices capturam:
- **Eficiência ofensiva**: time que converte chutes em finalizações ao alvo
- **Pressão defensiva**: time que força o adversário a chuter para fora

---

## 8. Avaliação de Viabilidade

### Custo de implementação

| Componente | Esforço | Novas chamadas API | Impacto estimado |
|---|---|---|---|
| P1 (temporada anterior) | Médio | +20 requisições no sync | +1–2% acurácia |
| P2 separado (atual) | Pequeno | 0 | Reorganização |
| P3/P4 com casa/fora | Médio | 0 | +2–3% acurácia |
| H2H últimos 5 | Pequeno | 0 | +0.5–1% acurácia |
| Stats avançadas P3 | Médio | +10–20 requisições | +1% acurácia |
| Data de corte histórica | Médio | 0 | Correção de honestidade |

**Total esperado:** +4–7% de acurácia real → projeção 54–57%

### Risco principal: P1 (temporada anterior)

Times que mudaram de divisão entre 2025 e 2026 têm histórico não-comparável:
- Vila Nova estava na Série A em 2025? → histórico mais forte
- Londrina estava na Série C em 2025? → histórico mais fraco

A mitigação é: ponderar P1 pela mesma divisão (`competitionId === 116`). Se o time não jogou a Série B 2025, P1 = média da liga.

### Risco secundário: H2H com poucos dados

Menos de 3 jogos H2H = ajuste zero. Isso é conservador e correto.

---

## 9. Estrutura de Dados Proposta

### Novo `TeamMatchRecord` (extensão)

```typescript
type TeamMatchRecord = {
  // existente
  matchId: string
  date: string
  competitionId: string
  opponentId: string
  opponentRating: number
  homeAway: HomeAway
  teamGoals: number
  opponentGoals: number
  // existente avançado
  shotsFor?: number
  shotsOnTargetFor?: number
  xgFor?: number
  // ... outros campos já existentes
  
  // NOVO — identificação de temporada para P1 vs P2
  season?: number     // 2025 ou 2026
}
```

### Novo `TeamForecast` (extensão)

```typescript
type TeamForecast = {
  // existente
  team: Team
  rating: number
  
  // NOVO — métricas por janela temporal
  prevSeasonMetrics: TeamMetrics    // P1
  seasonMetrics: TeamMetrics        // P2 (existente, renomeado se necessário)
  recentMetrics: TeamMetrics        // P3 (existente)
  shortFormMetrics: TeamMetrics     // P4 (existente)
  
  // NOVO — métricas por mando
  homeMetrics: TeamMetrics          // casa apenas (P2+P3+P4)
  awayMetrics: TeamMetrics          // fora apenas
  
  // NOVO
  h2hBalance: number                // -1 a +1 contra o adversário específico
  homeAdvantageCoeff: number        // vantagem doméstica específica
  
  // existente
  attackIndex: number
  defenseIndex: number
  // ...
}
```

---

## 10. Impacto na Arquitetura

### Fluxo atual
```
fetchSerieBData365()
  └─ records de cada time (últimos 14 jogos, 5 com xG)
      └─ forecastTeam(team, records)
          └─ predictMatch(match, teams, records)
```

### Fluxo proposto
```
fetchSerieBData365()
  ├─ standings (já implementado)
  ├─ records 2026 de cada time (todos os jogos da temporada)
  ├─ records 2025 de cada time (P1 — chamada nova)
  └─ h2h por par de times (filtrado dos records existentes)

forecastTeam(team, { prev, season, recent, shortForm, home, away }, h2hRecords)
  └─ predictMatch com cutoffDate opcional
```

---

## 11. Ordem de Implementação Recomendada

A sequência abaixo maximiza o impacto por esforço e permite testar cada mudança individualmente:

### Etapa 1 — Casa/Fora separados (maior impacto, zero custo de API)
Separar os registros já disponíveis em `homeRecords` e `awayRecords`. Calcular `expectedGoalsFor` usando o mando específico de cada time.

**Teste:** rodar backtest2.mjs com a nova lógica e comparar acurácia.

### Etapa 2 — H2H (baixo esforço, zero custo de API)
Filtrar `recordsByTeam[homeTeam.id].filter(r => r.opponentId === awayTeam.id)` e criar o ajuste H2H.

**Teste:** verificar impacto no backtest.

### Etapa 3 — P1 Temporada Anterior (médio esforço, +20 requisições)
Adicionar busca de jogos de 2025 por time. Filtrar por `competitionId = 116` (Série B). Usar como P1 com peso 0.15.

**Teste:** comparar acurácia nos primeiros 5 rounds (onde P1 tem mais influência por falta de dados 2026).

### Etapa 4 — Data de Corte Histórica
Adicionar parâmetro `cutoffDate` ao `forecastTeam`. Aplicar nas previsões de rodadas passadas.

**Efeito colateral esperado:** acurácia exibida vai cair para rodadas 1–10 (onde o modelo atualmente usa dados futuros). Esse número mais baixo é mais honesto.

### Etapa 5 — Stats avançadas em P3
Buscar stats para mais jogos além dos 5 atuais. Avaliar viabilidade de chamadas extras por jogo.

---

## 12. Conclusão e Recomendação

**Vale a pena implementar?** Sim. As etapas 1 e 2 têm relação custo/benefício excelente — zero chamadas de API extras, estimativa de +2–4% de acurácia real. A etapa 3 (P1) agrega principalmente nos primeiros rounds de uma temporada nova, quando os dados de 2026 são escassos.

**Projeção de acurácia com modelo completo:**
- Atual (v0.6): ~50%
- Com etapas 1+2: ~52–54%
- Com todas as etapas: ~54–57%

**Teto realístico para Série B** com dados disponíveis: ~55–58%. Modelos profissionais (Opta, StatsBomb) com dados completos atingem ~57–62% em ligas secundárias. Atingir 55% seria um resultado sólido e competitivo.

**Ponto de atenção importante:** a acurácia na UI (50%) inclui dados de xG que não estão no backtest. O número honesto sem xG é 40%. Parte de qualquer melhoria futura vai ser "naturalizar" o que já existe de bom, e parte vai adicionar sinal novo. O que muda de verdade: separar casa/fora e adicionar H2H.
