# Rapor

**Rapor** is a monorepo application designed to aggregate, organize, and view school report cards (*rapor*) stored across Google Drive and Google Sheets.

It automatically parses hierarchical folder and spreadsheet structures in Google Drive, stores the compiled navigation structure in SQLite, backs up sheets into `.ods` format, and renders an interactive web portal for users to view reports.

---

## 🏗️ Architecture

```text
                        ┌───────────────────────────────┐
                        │       Caddy Reverse Proxy     │
                        │     (TLS & Route Dispatch)    │
                        └──────────────┬────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
         /api/*     ▼                                     ▼   /*
  ┌─────────────────────────────────┐   ┌─────────────────────────────────┐
  │  Backend (Node.js / Express)    │   │     Frontend (Astro + Alpine)   │
  │  - Google Drive & Sheets Sync   │   │  - Report Viewer Portal         │
  │  - SQLite Database Storage      │   │  - Semester Switcher & Nav Menu │
  │  - Backup creation (.ods files) │   │  - Admin Logs UI (/admin/logs)  │
  │  - Scheduled Cron Job           │   └─────────────────────────────────┘
  └────────────────┬────────────────┘
                   │
                   ▼
  ┌─────────────────────────────────┐
  │      Google Cloud APIs          │
  │  (Google Drive + Google Sheets) │
  └─────────────────────────────────┘
```

The stack has three runtime services:

- **`backend`**: Node.js + Express API, SQLite storage, Google Drive/Sheets integration, exponential backoff retries, and scheduled sync jobs.
- **`frontend`**: Astro site powered by Alpine.js and DaisyUI for interactive client-side state, providing both the main report viewer and a secure Admin Log Dashboard.
- **`caddy`**: Reverse proxy and TLS terminator. Requests to `/api/*` go to the backend; everything else goes to the frontend.

### High-level flow:

1. The backend traverses a configured Google Drive root folder (`ROOT_DRIVE_FOLDER`).
2. It reads spreadsheet metadata from Drive/Sheets with retry mechanisms.
3. It compiles a `nav.json`-style hierarchy tree and stores the latest version and sync logs in SQLite.
4. It exposes authenticated API endpoints (`/api/*` protected via `x-api-key`) for manual sync, status polling, and data retrieval.
5. It uploads backup files (`.ods` files and `nav.json`) to the configured Google Drive backup folder (`BACKUP_DRIVE_FOLDER`).

---

## Repository Layout

```text
.
├── .env.example
├── Caddyfile
├── docker-compose.yml
├── README.md
├── backend-sheet-aggregator-rapor/
│   ├── Dockerfile
│   ├── README.md
│   ├── cron.js
│   ├── database.js
│   ├── index.js
│   ├── integrations/
│   ├── routes/
│   ├── services/
│   └── dev guide/
└── frontend-astro-rapor/
    ├── Dockerfile
    ├── README.md
    ├── public/
    └── src/
```

## Prerequisites

For local development without Docker:

- Node.js `22.x`
- npm

For containerized deployment:

- Docker Engine
- Docker Compose support
- Optional but recommended: Portainer for stack management

External dependencies:

- Google Cloud project with Google Drive API and Google Sheets API enabled
- Access to the target Google Drive root folder
- A Google Drive folder ID for storing daily backups
- Public DNS record for your production domain if using automatic TLS with Caddy

## Environment Variables

Copy the root example file:

```bash
cp .env.example .env
```

Current required variables:

```dotenv
DOMAIN=localhost
BACKEND_PORT=3000
API_SECRET_KEY=replace_with_a_strong_random_secret_key
ROOT_DRIVE_FOLDER=your_root_folder_id_here
BACKUP_DRIVE_FOLDER=your_master_backup_folder_id_here
GCP_PROJECT_ID=your-project-id
GCP_CLIENT_EMAIL=your-service-account-email
GCP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE... \n-----END PRIVATE KEY-----\n"
```

Notes:

- `DOMAIN=localhost` keeps local development simple. In production this must be your real domain.
- `API_SECRET_KEY` is required for all `/api/*` routes via the `x-api-key` header.
- `GCP_PROJECT_ID`, `GCP_CLIENT_EMAIL`, and `GCP_PRIVATE_KEY` are extracted from your Google Service Account JSON file.
- `ROOT_DRIVE_FOLDER` must be the folder ID, not the full Google Drive URL.

Generate a strong API secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Credential Setup

### Google Drive and Google Sheets Access

This project uses a service account. Google credentials are now provided via environment variables (GCP_PROJECT_ID, etc.) instead of a JSON file.

1. Open Google Cloud Console.
2. Create or select a project.
3. Enable `Google Drive API` and `Google Sheets API`.
4. Go to `IAM & Admin → Service Accounts`.
5. Create a service account (e.g., `rapor-sync-bot`).
6. Open the service account, go to **Keys**, and create a new **JSON key**.
7. Download the JSON key file.
8. Share the target Google Drive root folder with the service account email using at least **Viewer** access.

#### Extracting Keys for `.env`

Open the downloaded `.json` file in a text editor. Copy the values into your `.env` file:

- `GCP_PROJECT_ID`: Copy the value for `"project_id"`.
- `GCP_CLIENT_EMAIL`: Copy the value for `"client_email"`.
- `GCP_PRIVATE_KEY`: Copy the **entire** value for `"private_key"`, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` markers and all `\n` characters.

> [!TIP]
> Ensure the `GCP_PRIVATE_KEY` is wrapped in quotes in your `.env` file if it contains multiple lines or special characters.

```dotenv
GCP_PROJECT_ID=your-project-id
GCP_CLIENT_EMAIL=rapor-sync-bot@your-project.iam.gserviceaccount.com
GCP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASC...\n-----END PRIVATE KEY-----\n"
```

To get the Drive folder ID:

```text
https://drive.google.com/drive/folders/1VFXen2Q4O9vRIMr--g6TTHvxrX1pNUIE
                                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                       This part is ROOT_DRIVE_FOLDER
```

### Google Drive Backup Setup

The backend requires a `BACKUP_DRIVE_FOLDER` environment variable.

1. Create a new folder in Google Drive to act as the master backup location.
2. Share this folder with your service account email (from the step above) granting it **Editor** access so it can create daily subfolders and copy files.
3. Copy the master backup folder ID from its URL and use it as your `BACKUP_DRIVE_FOLDER`.

## Running Locally

### Option 1: Docker Compose

This matches production most closely.

1. Create `.env` from `.env.example`.
2. Configure your Google Service Account keys in `.env` (see **Credential Setup** above).
3. Start the stack:

```bash
docker compose up --build
```

The services will be available through Caddy:

- frontend: `http://localhost`
- admin dashboard: `http://localhost/admin/logs`
- API: `http://localhost/api/rapor/status`, `/api/rapor/data`, `/api/rapor/sync`

### Option 2: Run Frontend and Backend Separately

Backend:

```bash
cd backend-sheet-aggregator-rapor
cp .env.example .env
npm install
npm run dev
```

Frontend:

```bash
cd frontend-astro-rapor
npm install
npm run dev
```

Important:

- The backend standalone `.env.example` exists only for isolated backend development. The monorepo source of truth is the root `.env.example`.
- The frontend requires Node `>=22.12.0`.

## Admin Dashboard

An admin interface is available at `/admin/logs` (e.g., `http://localhost/admin/logs` when running via Compose, or `http://localhost:4321/admin/logs` directly). 
It features a live-updating historical execution dashboard built with Astro and Alpine.js. Access to the dashboard is protected by a password-only login (configured via `ADMIN_PASSWORD_HASH` in `.env`), preventing unauthorized access without needing a username. The frontend securely polls the backend's `/api/rapor/status` endpoint directly using the provided password for authentication, successfully hiding the `API_SECRET_KEY` from the client. The dashboard shows an accordion list of previous runs, detailed step logs, the final API payload data for each, and real-time running progress. It also provides a button to trigger and monitor a force-sync from the UI.

## API Reference

All `/api/*` routes require the `x-api-key` header matching `API_SECRET_KEY`.

Use one of these base URLs depending on how you run the app:

- Docker Compose with Caddy: `http://localhost/api/rapor`
- Standalone backend process: `http://localhost:3000/api/rapor`

### `GET` or `POST /api/rapor/sync`

Starts a background sync job and returns `202 Accepted`.

Example:

```bash
curl -X POST \
  -H "x-api-key: YOUR_API_SECRET_KEY" \
  http://localhost/api/rapor/sync
```

### `GET /api/rapor/status`

Returns an array of sync run histories (including their statuses, logs, execution durations, and final data trees) used for live progress tracking and historical system reviews.

```bash
curl \
  -H "x-api-key: YOUR_API_SECRET_KEY" \
  http://localhost/api/rapor/status
```

### `GET /api/rapor/data`

Returns the latest compiled navigation tree from SQLite.

```bash
curl \
  -H "x-api-key: YOUR_API_SECRET_KEY" \
  http://localhost/api/rapor/data
```

Rate limiting:

- `GET/POST /sync`: 1 request per 5 minutes per IP
- `GET /status` and `GET /data`: 60 requests per minute per IP

## Data Structure Expectations

### Google Drive Layout

The sync logic expects a strict hierarchy under `ROOT_DRIVE_FOLDER`:

```text
[Root Rapor Folder]
└── 2026/2027
    ├── Semester 1
    │   ├── Nilai Ekstrakurikuler
    │   ├── Kelas 1
    │   │   ├── Nilai Mapel Kelas 1A
    │   │   ├── Nilai Mapel Kelas 1B
    │   ├── Kelas 2
    │   └── ...
    └── Semester 2
```

### Compiled Navigation Shape

The backend generates a tree consumed by the frontend. At the top level it looks like:

```json
{
  "title": "Rapor SD",
  "data": [
    {
      "tahunAjaran": "2025/2026",
      "semester": 1,
      "data": {
        "dataMapel": [],
        "dataEkskul": []
      }
    }
  ]
}
```

Implementation details carried over from the backend design docs:

- `dataMapel` groups subject sheets and helper groups like Rekapitulasi, Cetak Rapor, Cover, and Biodata.
- `dataEkskul` groups extracurricular data by class level and subclass.
- Several frontend-facing values are stored as stringified JSON payloads for compatibility with the existing UI.

## Implementation Guide

The backend is no longer an n8n workflow; it is an Express service with SQLite state and scheduled sync execution.

Current implementation model:

1. `index.js` loads environment variables, initializes SQLite, registers cron jobs, and starts Express.
2. `routes/api.js` exposes sync, status, and data endpoints with API-key protection and rate limiting.
3. `services/syncService.js` performs the Drive traversal and output construction, and handles backing up data to Google Drive.
4. `integrations/googleApi.js` handles Drive and Sheets calls, including file copying for backups, using the service account key.
5. `cron.js` schedules the nightly sync.

Areas to pay attention to when extending the backend:

- Subject-name mapping is driven by spreadsheet/tab naming rules and may need expansion as naming conventions evolve.
- Extracurricular row mapping depends on the source sheet structure; keep the parser aligned with the real SETUP sheet format.
- The frontend expects the backend payload shape to stay stable, including the stringified value objects.
- Health and deployment behavior assume the backend root path `/` remains available for container healthchecks.

## Manual Verification Checklist

Use this after setup or deployment:

1. Confirm `docker compose up --build` or the equivalent Portainer stack starts all three services.
2. Open the frontend and verify the page loads through Caddy.
3. Call `GET /api/rapor/status` with the correct `x-api-key` or `?api_key=` param.
4. Trigger `GET or POST /api/rapor/sync`.
5. Watch `/api/rapor/status` until the job completes or fails.
6. Call `GET /api/rapor/data` and verify the payload matches the expected school year and semester structure.
7. Confirm the SQLite database persists after a container restart.
8. Confirm backup files (ODS and nav.json) are successfully copied to daily subfolders within your Google Drive backup folder.

## 🚀 Deployment & Production Setup

### Historical Context & Architecture Evolution

Originally, report synchronization and aggregation was performed via an **n8n automation workflow** with a separate static web viewer. The system was subsequently re-architected into a standalone monorepo consisting of:
- A dedicated **Express.js API** replacing n8n, managing Google Drive/Sheets traversal, SQLite persistence, and `.ods` backups.
- An **Astro + Alpine.js** frontend with DaisyUI providing both the student report viewer and a password-authenticated Admin Logs dashboard.
- A **Caddy** reverse proxy container handling routing (`/api/*` to backend, all else to frontend) and automated TLS termination.

### Deployment with Docker Compose & Portainer

The primary production deployment model uses the root [docker-compose.yml](file:///home/abuhafi/Project/rapor/docker-compose.yml).

```text
                              [ Public Traffic ]
                                      │
                                      ▼
                        ┌───────────────────────────┐
                        │   Caddy (caddy:2-alpine)   │
                        │     Ports :80 / :443      │
                        │  (Automatic Let's Encrypt)│
                        └─────────────┬─────────────┘
                                      │
                      ┌───────────────┴───────────────┐
                      │  Docker Network: rapor-internal│
                      ▼                               ▼
       ┌───────────────────────────────┐  ┌───────────────────────────────┐
       │   rapor-backend (Port 3000)   │  │   rapor-frontend (Port 4321)  │
       │    Node.js / Express API      │  │        Astro SSR / Static     │
       │  Volume: backend_data (SQLite)│  └───────────────────────────────┘
       └───────────────────────────────┘
```

### Deployment with Portainer (Git Repository Stack)

The production setup runs directly inside Portainer via a **Git Repository Stack** pulling from GitHub.

```text
       ┌────────────────────────┐
       │   GitHub Repository    │
       │ (decaller/rapor-sd...) │
       └───────────┬────────────┘
                   │ Git Pull / Webhook
                   ▼
       ┌─────────────────────────────────────────────────────────────┐
       │                  Portainer Git Stack Host                   │
       │                                                             │
       │                      [ Public Traffic ]                     │
       │                              │                              │
       │                              ▼                              │
       │                ┌───────────────────────────┐                │
       │                │   Caddy (caddy:2-alpine)   │                │
       │                │     Ports :80 / :443      │                │
       │                │   (inputrapor.sd.insan...)│                │
       │                └─────────────┬─────────────┘                │
       │                              │                              │
       │              ┌───────────────┴───────────────┐              │
       │              │  Docker Network: rapor-internal│              │
       │              ▼                               ▼              │
       │┌───────────────────────────────┐ ┌─────────────────────────┐│
       ││   rapor-backend (Port 3000)   │ │  rapor-frontend (4321)  ││
       ││    Node.js / Express API      │ │    Astro SSR / Static   ││
       ││  Volume: backend_data (SQLite)│ └─────────────────────────┘│
       │└───────────────────────────────┘                            │
       └─────────────────────────────────────────────────────────────┘
```

#### Portainer Git Stack Configuration:

1. **Create Stack**: In Portainer, go to **Stacks** $\rightarrow$ **Add Stack**.
2. **Select Build Method**: Choose **Repository**.
3. **Repository Settings**:
   - **Repository URL**: `https://github.com/decaller/rapor-sd-frontend-backend.git`
   - **Repository reference**: `refs/heads/master`
   - **Compose path**: `docker-compose.yml`
4. **Environment Variables**: Add the variables in the Portainer Stack UI:
   - `DOMAIN`: `inputrapor.sd.insantaqwa.org`
   - `BEHIND_PROXY`: `true` (if behind Cloudflare / upstream reverse proxy) or `false`
   - `BACKEND_PORT`: `3000`
   - `HTTP_PORT`: `80` / `HTTPS_PORT`: `443`
   - `API_SECRET_KEY` & `ADMIN_PASSWORD_HASH`
   - `ROOT_DRIVE_FOLDER` & `BACKUP_DRIVE_FOLDER`
   - `GCP_PROJECT_ID`, `GCP_CLIENT_EMAIL`, and `GCP_PRIVATE_KEY`
5. **Deploy the Stack**: Click **Deploy the stack**.

#### How to Update / Redeploy:
Whenever changes are pushed to GitHub `master`:
1. Open the **Rapor Stack** in Portainer.
2. Click **"Update the stack"** / **"Pull and redeploy"**.
3. Enable **"Re-pull image and redeploy"** (forces Docker Compose build step) and click **Update**.
4. Portainer pulls the latest commit, builds the containers, and performs a zero-downtime rolling restart.

## Operational Notes

- Backend data is stored in the named Docker volume `backend_data`.
- Caddy state is stored in `caddy_data` and `caddy_config`.
- The backend cron job is initialized at startup and is currently intended to run daily at 2:00 AM.
- The backend root path `/` returns a simple string and is used by the container healthcheck.

## Existing Source Documents

The material in this README was consolidated from:

- [`backend-sheet-aggregator-rapor/README.md`](/home/abuhafi/Project/rapor/backend-sheet-aggregator-rapor/README.md)
- [`frontend-astro-rapor/README.md`](/home/abuhafi/Project/rapor/frontend-astro-rapor/README.md)
- [`backend-sheet-aggregator-rapor/dev guide/Rapor Sync API Documentation.md`](/home/abuhafi/Project/rapor/backend-sheet-aggregator-rapor/dev guide/Rapor Sync API Documentation.md)
- [`backend-sheet-aggregator-rapor/dev guide/Data Structure Guide.md`](/home/abuhafi/Project/rapor/backend-sheet-aggregator-rapor/dev guide/Data Structure Guide.md)
- [`backend-sheet-aggregator-rapor/dev guide/Navigation JSON Structure.md`](/home/abuhafi/Project/rapor/backend-sheet-aggregator-rapor/dev guide/Navigation JSON Structure.md)
- [`backend-sheet-aggregator-rapor/dev guide/Plan Checklist.md`](/home/abuhafi/Project/rapor/backend-sheet-aggregator-rapor/dev guide/Plan Checklist.md)

I left the original markdown files in place. Remove them only if you want the root README to become the single source of truth.
