# Orion Prediction

Aplicacao React + TypeScript + Vite para leitura preditiva de ligas, com foco atual no Brasileirao Serie B.

## O que o projeto entrega hoje

- Tela de login local para entrada no ambiente.
- Home inicial com selecao de liga e resumo operacional.
- Loading screen ao entrar na competicao.
- Dashboard da rodada com previsoes congeladas, xG, placares provaveis e mercados de aposta.
- Painel de apostas com filtros, ranking de mercados e opcao de minimizar/expandir.
- Integracao com 365Scores para carregar partidas, standings e historico recente.

## Stack

- React 19
- TypeScript
- Vite
- ESLint

## Scripts

```bash
npm install
npm run dev
npm run lint
npm run build
npm run preview
```

## Estrutura principal

- `src/App.tsx`: fluxo de login, home, loading e dashboard.
- `src/App.css`: layout e estilos da experiencia.
- `src/domain/prediction.ts`: motor preditivo principal.
- `src/domain/betting.ts`: mercados de aposta derivados do motor.
- `src/services/scores365.ts`: integracao com a fonte 365Scores.
- `src/services/predictionStore.ts`: congelamento local das previsoes via IndexedDB.

## Desenvolvimento local

1. Instale as dependencias com `npm install`.
2. Rode `npm run dev`.
3. Abra a URL exibida pelo Vite, normalmente `http://127.0.0.1:5173` ou a porta livre mostrada no terminal.
4. Rode `npm run lint` antes de publicar alteracoes.
5. Gere o bundle de producao com `npm run build`.

## Deploy no Vercel

O passo a passo completo esta em [docs/vercel-deploy.md](./docs/vercel-deploy.md).
