# Vexto Pulse

Uptime monitor and public status page for the [vexto.app](https://vexto.app) portfolio. It runs 24/7 on a Raspberry Pi 3B+.

Every 5 minutes it checks each app's HTTP status, response time and TLS certificate expiry, stores the result in SQLite and serves a status page at `status.vexto.app`.

- **Status page** (`/`): overall state, each app's current state, uptime for 24h / 7d / 30d, a 24-hour response-time trace, and recent incidents. Light and dark mode, mobile-friendly, one HTML response with no external requests.
- **JSON** (`/api/status`): the same data, for future versions.
- **Incidents:** 2 or more failed checks in a row open an incident. It closes at the next successful check, with its start, end and duration recorded. A single failed check shows as "Failed last check" but isn't an incident.
- **Retention:** raw checks are kept for 90 days. Daily rollups (checks, successful checks, average ms per app per UTC day) are kept forever.

## How it works

| Part | What it is |
| --- | --- |
| `apps.json` | The apps to monitor: `name`, `url`, `category` |
| `src/checker.ts` | One run: check all apps, store results, update incidents, refresh rollups, prune. Started every 5 minutes by a systemd timer, then exits |
| `src/server.ts` | Small `node:http` server for the page and the JSON |
| `src/incidents.ts` | The incident rule, as a pure function with tests |
| `data/pulse.db` | SQLite via the built-in `node:sqlite` (created on first run) |

There are no runtime dependencies. TypeScript compiles to `dist/` with `tsc`.

**Memory.** The web server measures about 65 MB RSS on a Mac (expect a little less on the Pi), with a hard 100 MB cap set in systemd. The checker peaks at about 64 MB but only lives for 1–2 seconds every 5 minutes. Two choices keep this low: production runs compiled JavaScript (running `.ts` directly costs about 25 MB more per process), and checks use `node:https` instead of `fetch()` (`fetch` costs about 50 MB more).

## Run it locally

Needs Node 24.6 or newer (Node 26 LTS on the Pi).

```bash
npm install
npm run build
npm run check     # run the checker once; run it again to see incidents open
npm start         # http://127.0.0.1:3000
npm test          # incident logic tests
```

Environment variables: `PORT` (default `3000`), `HOST` (default `127.0.0.1`), `PULSE_DB` (default `data/pulse.db`), `PULSE_APPS` (default `apps.json`).

## Add an app

Add an entry to `apps.json`, commit and push, then run `./deploy.sh` on the Pi.

```json
{ "name": "Stackmark", "url": "https://stackmark.dev", "category": "Developer tools" }
```

`name` must be unique. It's the key the checks are stored under, so renaming an app starts a fresh history.

## Raspberry Pi setup

These steps assume a Raspberry Pi 3B+ with **Raspberry Pi OS Lite (64-bit)**, a user called `pi`, and the repo at `/home/pi/vexto-pulse`. If your username is different, see step 5.

**1. Flash and boot.** Use Raspberry Pi Imager and choose *Raspberry Pi OS Lite (64-bit)*. In the Imager settings, set a hostname (for example `pulse`), your username and password, Wi-Fi if needed, and enable SSH. Boot the Pi, then:

```bash
ssh pi@pulse.local
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y git
```

**2. Install Node.js 26 LTS** from NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_26.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # v26.x
```

**3. Clone and build:**

```bash
cd ~
git clone https://github.com/vextoapp/vexto-pulse.git
cd vexto-pulse
npm ci
npm run build
mkdir -p data
npm run check   # one manual run to confirm it works
```

**4. Install the systemd units:**

```bash
sudo cp deploy/vexto-pulse-web.service deploy/vexto-pulse-checker.service deploy/vexto-pulse-checker.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vexto-pulse-web vexto-pulse-checker.timer
```

Check it:

```bash
systemctl list-timers vexto-pulse-checker.timer
journalctl -u vexto-pulse-checker -n 20     # checker output
curl -s http://127.0.0.1:3000/api/status | head -c 300
```

**5. Different username or path?** Replace `pi` and `/home/pi/vexto-pulse` in the three unit files before step 4. For example, for user `mo`:

```bash
sed -i 's#/home/pi/#/home/mo/#g; s#^User=pi#User=mo#' deploy/*.service
```

**6. Deploy updates** from the Pi:

```bash
cd ~/vexto-pulse && ./deploy.sh
```

This pulls, runs `npm ci`, builds and restarts the web server. The checker uses the new build on its next run. If you change the unit files, repeat step 4.

### Make it public at status.vexto.app

The server only listens on `127.0.0.1`, so nothing on your home network is exposed. The simplest way to publish it is a **Cloudflare Tunnel**: an outbound connection from the Pi to Cloudflare, with no router port forwarding. It needs the `vexto.app` DNS zone to be on Cloudflare.

1. Install `cloudflared` for Debian arm64 from Cloudflare's [downloads page](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/).
2. Create the tunnel and DNS record:

   ```bash
   cloudflared tunnel login
   cloudflared tunnel create vexto-pulse
   cloudflared tunnel route dns vexto-pulse status.vexto.app
   ```

3. Create `~/.cloudflared/config.yml`:

   ```yaml
   tunnel: <TUNNEL_ID>
   credentials-file: /home/pi/.cloudflared/<TUNNEL_ID>.json
   ingress:
     - hostname: status.vexto.app
       service: http://127.0.0.1:3000
     - service: http_status:404
   ```

4. Run it as a service:

   ```bash
   sudo cloudflared --config /home/pi/.cloudflared/config.yml service install
   ```

## Roadmap

- **v1, is it alive** (this): checks every app every 5 minutes, public status page.
- **v2, is it good:** PageSpeed scores and Sentry error counts, combined into a health score.
- **v3, what should I do:** a Monday email summary with a suggested focus.
- **v4, make it physical:** one LED per app on the Pi's GPIO pins (green, amber, red).
- **v5 and beyond:** public changelog, experiment log, usage numbers, roadmap scoring.
