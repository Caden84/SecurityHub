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
- `app.js` — intake, recommendation rules, device estimates, pricing

## Notes

- Unit cost fields stay empty for the rep to fill — no Honeywell/EPS list prices invented.
- Exact Vision calculator button is a placeholder (“paste dealer URL later”).
- Disclaimer appears on Screen 2 banner and Screen 3 banner + footer.
