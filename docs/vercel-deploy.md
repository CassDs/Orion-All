# Deploy no Vercel

Este projeto e uma aplicacao Vite + React + TypeScript. O deploy no Vercel e direto e nao exige backend adicional.

## Pre-requisitos

- Node.js instalado localmente para testes.
- Conta no Vercel.
- Repositorio Git com o projeto versionado, se for usar o fluxo via GitHub, GitLab ou Bitbucket.

## Validacao local antes do deploy

Rode os comandos abaixo na raiz do projeto:

```bash
npm install
npm run lint
npm run build
```

Se o build passar, o projeto esta pronto para ser publicado.

## Opcao 1: subir pelo dashboard do Vercel

1. Envie o projeto para um repositorio no GitHub, GitLab ou Bitbucket.
2. Entre em https://vercel.com.
3. Clique em `Add New...` > `Project`.
4. Importe o repositorio do Orion Prediction.
5. O Vercel deve detectar automaticamente que o projeto usa Vite.
6. Confira as configuracoes:

- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

7. Clique em `Deploy`.

## Opcao 2: subir pela CLI do Vercel

Instale a CLI:

```bash
npm install -g vercel
```

Depois, na raiz do projeto:

```bash
vercel
```

Na primeira execucao, a CLI vai pedir:

1. Login na conta Vercel.
2. Confirmacao do projeto atual.
3. Nome do projeto.
4. Configuracao de build.

Use estas respostas:

- Framework: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`

Para publicar em producao:

```bash
vercel --prod
```

## Variaveis de ambiente

Hoje o projeto nao depende de variaveis obrigatorias para compilar. Se no futuro voce mover integracoes sensiveis para backend, configure as variaveis no painel do Vercel em:

`Project Settings` > `Environment Variables`

## SPA e rotas

Como a aplicacao e uma SPA em React com Vite, o Vercel normalmente serve o `dist` sem problema. Se no futuro forem adicionadas rotas client-side mais complexas, pode ser util incluir um arquivo `vercel.json` com rewrite para `index.html`.

Exemplo:

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

No estado atual, isso nao e obrigatorio.

## Checklist final

1. `npm run lint`
2. `npm run build`
3. Confirmar `dist/` gerado sem erro
4. Publicar no Vercel
5. Testar login, entrada na liga e carregamento da competicao na URL publica
