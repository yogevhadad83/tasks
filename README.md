# Game Demo

A minimal Vite + TypeScript canvas app that shows a full-screen black screen. Useful as a starting point for rapid iteration.

## Run locally

- Install dependencies
- Start the dev server

```sh
npm install
npm run dev
```

Then open the printed local URL (typically http://localhost:5173).

## Zero-install fallback

If installing dependencies hangs, you can still see the black screen without any tooling:

- Open `standalone.html` directly in your browser (double-click or drag into a tab). It renders a full-screen black canvas with no build step.

## Alternative package managers

If `npm install` is slow or stuck, try one of these:

```sh
# Enable corepack (Node 16.13+)
corepack enable

# Use pnpm
corepack prepare pnpm@latest --activate
pnpm install
pnpm dev

# Or use yarn
corepack prepare yarn@stable --activate
yarn
yarn dev
```

## Build

```sh
npm run build
npm run preview
```
