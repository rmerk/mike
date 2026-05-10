# Mike

Open-source release containing the Mike frontend and backend.

## Contents

- `frontend/` - Next.js application
- `backend/` - Express API, Supabase access, document processing, and database schema
- `backend/schema.sql` - Supabase schema for fresh databases
- `backend/migrations/` - incremental database updates for existing deployments

## Prerequisites

- Node.js 20 or newer
- npm
- git
- A Supabase project
- A Cloudflare R2 bucket, MinIO bucket, or another S3-compatible bucket
- At least one supported model provider API key: Anthropic, Google Gemini, or OpenAI
- LibreOffice installed locally if you need DOC/DOCX to PDF conversion

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/willchen96/mike.git
cd mike
```

### 2. Install dependencies

```bash
npm install --prefix backend
npm install --prefix frontend
```

### 3. Create env files

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Then fill in the values. See [Environment Variables](#environment-variables) below.

### 4. Run the database schema

For a new Supabase database, open the Supabase SQL editor and run the contents of `backend/schema.sql`.

For an existing database, do not run the full schema file over production data. Apply the incremental files in `backend/migrations/` instead.

### 5. Start the backend

```bash
npm run dev --prefix backend
```

Backend runs on `http://localhost:3001`.

### 6. Start the frontend

```bash
npm run dev --prefix frontend
```

Open `http://localhost:3000`.

### 7. Sign up and add a model API key

Sign up in the app. If you did not set provider keys in `backend/.env`, open **Account > Models & API Keys** and add an Anthropic, Gemini, or OpenAI API key.

## Environment Variables

Supabase values come from the project dashboard. Use the project URL for `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`, the service role key for `SUPABASE_SECRET_KEY`, and the anon/public key for `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`. If your Supabase project shows multiple key formats, use the legacy JWT-style anon and service role keys expected by the Supabase client libraries.

### Backend (`backend/.env`)

| Variable | Notes |
| --- | --- |
| `PORT` | Defaults to `3001` |
| `FRONTEND_URL` | `http://localhost:3000` for local development |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Supabase service role key |
| `R2_ENDPOINT_URL` | Cloudflare R2, MinIO, or another S3-compatible endpoint |
| `R2_ACCESS_KEY_ID` | Object storage access key |
| `R2_SECRET_ACCESS_KEY` | Object storage secret key |
| `R2_BUCKET_NAME` | Object storage bucket name |
| `GEMINI_API_KEY` | Optional Google Gemini key |
| `ANTHROPIC_API_KEY` | Optional Anthropic key |
| `OPENAI_API_KEY` | Optional OpenAI key |
| `RESEND_API_KEY` | Optional, for email features |
| `USER_API_KEYS_ENCRYPTION_SECRET` | Secret used to encrypt per-user API keys |

### Frontend (`frontend/.env.local`)

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Supabase anon/public key |
| `SUPABASE_SECRET_KEY` | Supabase service role key |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:3001` for local development |

Provider keys are only needed for the models and email features you plan to use. Model provider keys can be configured in `backend/.env` for the whole instance, or per user in **Account > Models & API Keys**. If a provider key is present in `backend/.env`, that provider is available by default and the matching browser API key field is read-only.

## Troubleshooting

**Sign-up confirmation email never arrives.** Confirmation emails are sent by Supabase Auth, not by Mike. For local development, the simplest fix is to disable email confirmation in **Supabase > Authentication > Providers > Email**. For production, configure custom SMTP in Supabase; the built-in mailer is heavily rate-limited and may be restricted on newer projects.

**The model picker shows a missing-key warning.** Add a key for that provider in **Account > Models & API Keys**, or configure the provider key in `backend/.env` and restart the backend.

**DOC or DOCX conversion fails.** Install LibreOffice locally and restart the backend so document conversion commands are available on the process path.

## Useful Checks

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm run lint --prefix frontend
```

## License

AGPL-3.0-only. See `LICENSE`.
