# Frontend

React + TypeScript + Vite + Tailwind. See the repository README for setup.

- `npm run dev`: dev server on :5173; `/api` is proxied to the backend on :8000.
- `npm run build`: production build to `dist/`, which the backend serves on :8000.
- `npx playwright test`: UI smoke tests against a running backend.
  Set `E2E_TOKEN` to the organiser token. `PW_CHROMIUM_PATH` is optional.

The organiser token is typed in at sign-in and kept in `sessionStorage`. No secret is part of the bundle.
