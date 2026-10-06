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
- `app.js` — gates, open questions for incomplete jobs, prints quality, ceiling/lift, takeoff, pricing

## Product notes

- Top of intake: **Job scale**, **Scope**, **Prints** (required).
- **Job class** (new / add-on / takeover / replacement). Add-on, takeover, and replacement still need devices marked on the print — Results asks; it does not block.
- **Incomplete jobs stay open.** Results lists each missing item and one plain-language question the estimator sends back to the rep. Panel path and Takeoff stay available and are marked incomplete until the matching Intake fields are filled. Holes: no prints; unreadable or missing upload; occupant load unknown; devices not marked on the print; year built blank; hazards blank; ceiling height blank; lift not answered on a commercial job, or on a residential job of two stories or more.
- **Year built + hazards**; pre-1980 + “none known” → yellow flag (unchanged; not a block).
- **Ceiling height + Lift** are asked when blank on commercial jobs, and on residential jobs of two or more stories.
- **Prints upload** (PDF/image) + quality check + manual device checklist. A missing or unreadable upload is a question, not a block. Auto-read disabled.
- **Takeoff** after Results: device + wire lines, searchable starter catalog, sessionStorage persist.
- **Check-and-test**: labor on Results; devices/wire still on Takeoff labeled electrician furnish.
- Unit cost fields stay empty — no invented list prices.
- Disclaimer on Results / Takeoff / Summary.
