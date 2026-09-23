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

- `index.html` — three screens (Intake → Results → Summary)
- `styles.css` — dark shop-floor UI, amber accents, print styles
- `app.js` — intake gates, residential/commercial branches, recommendations, pricing

## Product notes

- Top of intake: **Job scale**, **Scope**, **Prints** (required). Rest of form shows after those are set.
- **Commercial + no prints** → hard stop only (copy-paste message). No panel A/B/C, no bid device counts.
- **Residential + no prints** → hard-stop warning + residential questions + detector strategy A/B/C. No fake floor plan. Panel A/B/C only if control panel system is fire/burg/both.
- **Check-and-test** scope → Program / Test / Certification labor rows only.
- **Spec vs code** columns when education/assembly/healthcare, voice required, or high-rise.
- Unit cost fields stay empty — no invented list prices.
- Disclaimer on Screen 2 banner and Screen 3 banner + footer.
