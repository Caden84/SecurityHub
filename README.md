# PanelPath — Michigan v1

Hosted in the **SecurityHub** repo (`Caden84/SecurityHub`).

Static decision-support web app for fire/security sales reps in Michigan.

**Not a store. Not a Bluebeam clone. Not legal advice.**

## How to run

From the repo root:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in a browser.

You can also open `index.html` directly via `file://` — sessionStorage and all screens still work.

## Files

- `index.html` — screens: Intake → Results → Takeoff → Summary
- `styles.css` — dark shop-floor UI, amber accents, print styles
- `app.js` — gates, hard stops, prints quality, ceiling/lift, takeoff, pricing

## Product notes

- Top of intake: **Job scale**, **Scope**, **Prints** (required).
- **Job class** (new / add-on / takeover / replacement). Add-on/takeover/replacement require “devices marked on the print.”
- **Commercial hard stops** (block panel A/B/C): no prints; occupant load unknown; devices not on print; missing/unreadable upload.
- **Year built + hazards**; pre-1980 + “none known” → yellow flag (not a hard stop).
- **Ceiling height + Lift** required on commercial and residential stories ≥ 2.
- **Prints upload** (PDF/image) + quality gate + manual device checklist. Auto-read disabled.
- **Takeoff** after Results: device + wire lines, searchable starter catalog, sessionStorage persist.
- **Check-and-test**: labor on Results; devices/wire still on Takeoff labeled electrician furnish.
- Unit cost fields stay empty — no invented list prices.
- Disclaimer on Results / Takeoff / Summary.
