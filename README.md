# CodeTrail

CodeTrail is a full-stack coding and learning tracker for self-taught developers. It tracks coding hours, learning sessions, projects, technologies, goals, streaks, insights, and AI weekly summaries.

## Stack

- React + Vite + TypeScript frontend
- Node + Express + TypeScript backend
- PostgreSQL + Prisma
- Render deployment config

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy API environment variables:

   ```bash
   cp apps/api/.env.example apps/api/.env
   ```

3. Set `DATABASE_URL` to a PostgreSQL database.

4. Generate Prisma client and migrate:

   ```bash
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   ```

5. Run the app:

   ```bash
   npm run dev
   ```

The frontend runs on `http://localhost:5173` and proxies API calls to `http://localhost:4000`.

## Deployment

`render.yaml` contains a Render blueprint for the API, static frontend, and managed PostgreSQL database.

1. Push the repo to GitHub.
2. In Render, choose **New > Blueprint**.
3. Connect the GitHub repo and let Render read `render.yaml`.
4. Create the resources.
5. If Render gives either service a different public URL, update:

   - API service `CORS_ORIGIN`
   - Web service `VITE_API_URL`

The API pre-deploy command runs Prisma migrations and seeds the first demo dataset. Add `OPENAI_API_KEY` to the API service if you want live AI weekly summaries.
