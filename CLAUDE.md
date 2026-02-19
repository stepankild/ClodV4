# True Source — Farm Management Portal

Cannabis cultivation management portal with Raspberry Pi hardware integration (scale + barcode scanner).

## Quick Reference

| What | Where |
|------|-------|
| **Production URL** | `https://clodv4-production.up.railway.app` |
| **Frontend** | React 18 + Vite 5 + Tailwind CSS |
| **Backend** | Node.js/Express + MongoDB (Mongoose) |
| **Real-time** | Socket.io (Pi ↔ Server ↔ Browser) |
| **Deploy** | Railway (auto-deploy from `main` branch) |
| **Pi SSH** | `ssh stepan@100.95.73.8` (Tailscale) |
| **Language** | UI in Russian, code/comments mix RU/EN |

## Architecture

```
┌─────────────┐     WebSocket      ┌──────────────┐     WebSocket     ┌───────────┐
│ Raspberry Pi │ ──────────────────→│   Railway     │←──────────────── │  Browser   │
│ (farm.local) │   scale:weight     │   Express +   │   scale:weight   │  React SPA │
│              │   scale:debug      │   Socket.io   │   barcode:scan   │            │
│  - Ohaus     │   barcode:scan     │   MongoDB     │                  │            │
│  - Honeywell │←──────────────────│               │──────────────────→│            │
│  - Tailscale │   scale:status     │  Port: 5000   │   REST API       │  Vite:5173 │
└─────────────┘                    └──────────────┘                    └───────────┘
```

## Deploy & Push

```bash
# Push changes (Railway auto-deploys from main):
git push origin claude/unruffled-davinci:main

# Deploy Pi files (via Tailscale SSH):
scp pi-scale-client/scale_reader.py pi-scale-client/pi_client.py stepan@100.95.73.8:/home/stepan/pi-scale-client/
ssh stepan@100.95.73.8 "sudo systemctl restart scale-client"

# Check Pi service logs:
ssh stepan@100.95.73.8 "journalctl -u scale-client -f --no-pager -n 50"

# Build client locally:
cd client && npm run build
```

## Raspberry Pi Setup

- **Device**: Raspberry Pi 4 on farm LAN
- **Tailscale IP**: `100.95.73.8` (hostname: `farm`)
- **User**: `stepan`
- **Service**: `scale-client` (systemd, auto-restart)
- **Python**: 3.13.5 (venv at `/home/stepan/pi-scale-client/venv/`)
- **Working dir**: `/home/stepan/pi-scale-client/`
- **Scale**: Ohaus R31P3 via RS-232→USB at `/dev/ttyUSB0`, 9600 baud
- **Scanner**: Honeywell Voyager XP 1470g via USB HID at `/dev/input/event4`
- **Scale mode**: CP (continuous print) + IP polling for unstable readings

### Pi systemd service

```ini
[Service]
User=stepan
SupplementaryGroups=input
WorkingDirectory=/home/stepan/pi-scale-client
ExecStart=/home/stepan/pi-scale-client/venv/bin/python pi_client.py
Restart=always
RestartSec=5
```

### Pi files

| File | Purpose |
|------|---------|
| `pi_client.py` | Main client: reads scale+barcode, sends to server via Socket.io |
| `scale_reader.py` | Serial communication with Ohaus R31P3 (CP + IP commands) |
| `barcode_reader.py` | evdev-based USB HID barcode scanner reader |
| `.env` | Config (SERVER_URL, SCALE_API_KEY, SERIAL_PORT, etc.) |

## Project Structure

```
├── client/                    # React frontend (Vite)
│   └── src/
│       ├── components/        # Reusable UI components
│       │   ├── Layout/        # MainLayout, Sidebar (with Pi status indicator)
│       │   ├── FlowerRoom/    # RoomCard
│       │   ├── RoomMap/       # Plant grid visualization (RoomMap, PlantCell, HeatMap)
│       │   └── Logo.jsx       # True Source SVG logo
│       ├── context/AuthContext.jsx  # JWT auth + RBAC permissions
│       ├── hooks/
│       │   ├── useScale.js    # Scale weight/status from Socket.io
│       │   └── useBarcode.js  # Barcode scan events from Socket.io
│       ├── services/          # Axios API clients (one per entity)
│       │   └── scaleSocket.js # Socket.io client for Pi
│       ├── pages/             # Route page components (see Routes below)
│       └── fonts/             # Roboto Regular + Bold (for PDF generation)
├── server/                    # Express backend
│   ├── server.js              # Entry point: Express + Socket.io + MongoDB
│   ├── socket/index.js        # Socket.io handlers (Pi auth, weight, barcode)
│   ├── models/                # 15 Mongoose models
│   ├── routes/                # 11 REST API route files
│   ├── controllers/           # Business logic
│   ├── middleware/
│   │   ├── auth.js            # JWT verification
│   │   └── rbac.js            # Permission checking
│   ├── utils/                 # JWT, audit log, soft delete helpers
│   ├── seeds/initial.js       # Initial roles/users/permissions
│   └── scripts/               # DB maintenance scripts
├── pi-scale-client/           # Raspberry Pi Python client
└── railway.toml               # Railway deploy config
```

## Routes (Frontend)

| Path | Page | Permission |
|------|------|------------|
| `/` | Overview (farm dashboard) | `overview:view` |
| `/active` | Active flower rooms | `active:view` |
| `/labels` | Bracelet label printing (PDF) | `active:view` |
| `/harvest` | Harvest sessions (weighing) | `harvest:view` |
| `/trim` | Trim operations | `trim:view` |
| `/clones` | Clone cut management | `clones:view` |
| `/vegetation` | Veg batch management | `vegetation:view` |
| `/archive` | Cycle archive history | `archive:view` |
| `/archive/:id` | Archive detail view | `archive:view` |
| `/stats` | Statistics & charts | `stats:view` |
| `/strains` | Strain database | *(no permission)* |
| `/workers` | Worker management | `users:read` |
| `/audit` | Audit action log | `audit:read` |
| `/trash` | Soft-deleted items | `audit:read` |

## API Endpoints (Server)

| Prefix | Resource |
|--------|----------|
| `/api/auth` | Login, logout, refresh token, `/me` |
| `/api/users` | User CRUD, roles |
| `/api/rooms` | Flower rooms + plants CRUD |
| `/api/archive` | Cycle archive |
| `/api/tasks` | Room tasks |
| `/api/harvest` | Harvest sessions |
| `/api/clone-cuts` | Clone propagation |
| `/api/veg-batches` | Veg batches |
| `/api/trim` | Trim operations |
| `/api/strains` | Strain database |
| `/api/audit-logs` | Audit trail |
| `/api/health` | Health check |

## MongoDB Models

| Model | Key Fields |
|-------|-----------|
| `User` | name, login, password (bcrypt), role, isActive, deletedAt |
| `Role` | name, permissions[] |
| `Permission` | code (e.g. `overview:view`), description |
| `FlowerRoom` | name, strain, plants[], startDate, status, phase |
| `CycleArchive` | Archived room cycle with stats |
| `HarvestSession` | room, plants[], weights[], worker |
| `TrimLog` | harvest, weight, worker |
| `CloneCut` | strain, quantity, date, motherPlant |
| `VegBatch` | strain, plants, startDate |
| `Strain` | name, type (sativa/indica/hybrid), notes |
| `RoomTask` | room, title, status, assignee |
| `RoomTemplate` | Reusable room configurations |
| `RoomLog` | Room activity log entries |
| `PlannedCycle` | Planned growing cycles |
| `AuditLog` | user, action, entity, ip, userAgent |

## Socket.io Events

### Pi → Server
| Event | Data | Description |
|-------|------|-------------|
| `scale:weight` | `{ weight, unit, stable }` | Current scale reading |
| `scale:status` | `{ connected }` | Scale physically connected to Pi |
| `scale:error` | `{ message }` | Error from Pi |
| `scale:debug` | `{ scaleConnected, barcodeConnected, uptime, ... }` | Diagnostics (every 5s) |
| `barcode:scan` | `{ barcode }` | Scanned barcode value |

### Server → Browser
Same events are broadcast to all browser clients. On browser connect, server sends current `scale:status` and last `scale:weight`.

### Auth
- **Pi**: `{ apiKey: SCALE_API_KEY, deviceType: 'pi' }` in handshake
- **Browser**: `{ token: JWT_ACCESS_TOKEN }` in handshake
- Heartbeat timeout: 15 seconds (no data → scale marked offline)

## Key Technical Details

- **JWT**: Access token 15min + refresh token 7d, proactive refresh on client
- **RBAC**: Permission-based (`hasPermission('harvest:view')`) checked on both client routes and server middleware
- **Soft delete**: Users/items have `deletedAt` field, recoverable from `/trash`
- **Label printing**: jsPDF generates PDF with JsBarcode barcodes. Vertical bracelets use `angle: -90` rotation (clockwise, top-to-bottom)
- **Scale weight**: CP mode for stable readings + IP (Immediate Print) polling every 300ms for unstable readings
- **Barcode scanner**: evdev-based reader, auto-reconnect on USB re-plug (`os.stat()` check for device node)
- **Pi status in sidebar**: Green (Pi online) / Yellow (socket connected but no Pi data) / Red (offline), with sub-indicators for scale and scanner

## Common Operations

```bash
# View Pi logs in real-time:
ssh stepan@100.95.73.8 "journalctl -u scale-client -f -n 30"

# Restart Pi service:
ssh stepan@100.95.73.8 "sudo systemctl restart scale-client"

# Check Pi service status:
ssh stepan@100.95.73.8 "systemctl status scale-client --no-pager"

# Deploy updated Pi files:
scp pi-scale-client/*.py stepan@100.95.73.8:/home/stepan/pi-scale-client/

# Build and check frontend:
cd client && npm run build

# Push to production:
git push origin claude/unruffled-davinci:main

# Seed database (initial setup):
cd server && node seeds/initial.js

# Run tests:
cd server && npm test
```

## Working Branch

- **Dev branch**: `claude/unruffled-davinci` (or similar `claude/*`)
- **Production**: `main` (Railway auto-deploys)
- **Push pattern**: `git push origin <branch>:main`
- **Never force push to main**
