# Skin-Aware Stylist

Hackathon entry for the YouCam API challenge (Skin AI + eCommerce Virtual Try-On).
A face photo goes to **YouCam Skin AI**, which scores radiance, redness, dark circles and moisture.
A rule-based stylist (no runtime LLM, no extra paid key) ranks a small garment catalog by those scores and writes a
"why this fits your skin result" line for each pick. **YouCam AI Clothes Virtual Try-On** then renders the top 3 looks on the same photo.

Node >= 20, zero npm dependencies.

## Run with a key

```
# .env.local (git-ignored, never commit it)
YOUCAM_API_KEY=your-key-here
# optional: YOUCAM_BASE=https://yce-api-01.makeupar.com  UNIT_CAP=800  PORT=8787  LEDGER_PATH=var/units.json
```

```
npm start        # http://localhost:8787, mode "live"
```

The key stays on the server. The **unit guard** (`src/units.js`) wraps every paid call and refuses once
`UNIT_CAP` (default 800 of the 1,000 free units) would be exceeded; the ledger persists in `var/units.json`.
Costs: skin analysis 9 units (4 SD concerns), try-on 2 units each (assumed, to be measured).

`node --env-file=.env.local scripts/live-smoke.js --yes-spend` runs one real skin analysis and one try-on (never run by tests).

## Demo mode (no key)

Without `YOUCAM_API_KEY` the app replays `fixtures/<sampleId>.json` for the bundled sample faces:
`{"skin": <data.results.output of a real skin task>, "tryon": {"<garmentId>": "<base64 image>"}}`.
Missing try-on entries fall back to the sample photo. Uploading your own photo needs a key.

## Tests

```
node --test                  # unit + integration, local mock of the YouCam API, no network
node scripts/e2e-mock.js     # scripted end-to-end transcript against the mock
```

## Privacy notice

- The photo is sent to the Perfect Corp YouCam API only, never to another third-party AI. Perfect Corp keeps the data for up to 30 days.
- You must tick the consent box before upload. Test faces are recommended.
- This app holds images in memory only, never on disk. They are deleted on "Delete my session" or after 10 minutes.
- The API key is server-side only and is not logged.

## AI-assisted development disclosure

Code written by Claude (Anthropic) under direction of the entrant; test images generated with Gemini; the entrant reviews and selects.

## License and terms

MIT, see `LICENSE`. Built to follow the Perfect Corp YouCam API terms of service (server-side key, consent before upload, YouCam-only processing, 30-day retention disclosed, images deleted after the session).
