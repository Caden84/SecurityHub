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

You can also open `index.html` directly via `file://` — sessionStorage and all screens still work. PDF markup and export load two scripts from a CDN, so that part needs a network connection.

## Files

- `index.html` — screens: Intake → Results → Takeoff → Summary. Takeoff includes print markup.
- `styles.css` — dark shop-floor UI, amber accents, print styles
- `app.js` — gates, open questions for incomplete jobs, prints quality, ceiling/lift, takeoff, print markup, pricing

Print markup uses these CDN libraries (not vendored):

- [pdf.js 3.11.174](https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js) and its [worker](https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js) render PDF pages in the browser.
- [pdf-lib 1.17.1](https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js) builds the downloaded marked-up PDF.

## Product notes

- Top of intake: **Job scale**, **Scope**, **Prints** (required).
- **Job class** (new / add-on / takeover / replacement). Add-on, takeover, and replacement still need devices marked on the print — Results asks; it does not block.
- **Incomplete jobs stay open.** Results lists each missing item and one plain-language question the estimator sends back to the rep. Panel path and Takeoff stay available and are marked incomplete until the matching Intake fields are filled. Holes: no prints; unreadable or missing upload; occupant load unknown; devices not marked on the print; year built blank; hazards blank; ceiling height blank; lift not answered on a commercial job, or on a residential job of two stories or more.
- **Year built + hazards**; pre-1980 + “none known” → yellow flag (unchanged; not a block).
- **Ceiling height + Lift** are asked when blank on commercial jobs, and on residential jobs of two or more stories.
- **Prints upload** (PDF/image) + quality check + manual device checklist. A missing or unreadable upload is a question, not a block. Auto-read disabled.
- **Takeoff** after Results: device + wire lines, searchable starter catalog, sessionStorage persist.
- **Print markup** stays on Takeoff (no extra screen) because the symbols exist to fill device qty. Import a PDF or image there, or use the Intake upload. Pick a starter-catalog device, click the page to place it, click a symbol and Remove to take it off. Qty on the matching device line follows symbols on every page and is marked “from print.” Unit costs stay empty. The manual checklist is not filled from symbols.
- **Marked-up export** downloads `panelpath-marked-prints.pdf`: each page has the symbols drawn on it and a legend of symbols and counts for that page, plus a summary page of counts per page. No prices, wire, or labor in that file.
- **Check-and-test**: labor on Results; devices/wire still on Takeoff labeled electrician furnish.
- Unit cost fields stay empty — no invented list prices.
- Disclaimer on Results / Takeoff / Summary. The marked-up PDF repeats that disclaimer on the legend summary page.

## Limits for a rep testing print markup

- Use the local server above when marking a PDF. Opening `index.html` as a file often blocks the pdf.js worker, so the pages will not render. Image import can still fail the same way if the CDN scripts did not load.
- One file at a time. A PDF can be multiple pages. An image is one page.
- The drawing and the symbols stay in this browser tab. A refresh drops both. Device lines already stored in sessionStorage stay, but they are no longer locked to the print until you mark it again.
- Intake quality check is unchanged: images under about 800px on the long edge, or with almost no linework, are flagged; a PDF still needs “Looks readable” on Intake. A flagged file can still be marked. Auto-read stays off.
- Symbols replace the qty on the first matching catalog line. Extra manual lines you add yourself are left alone. Deleting a “from print” line removes every symbol of that device. Wire feet are not measured from the symbols.
- The export draws symbols on a picture of each page, so text in the original PDF is not selectable. The legend text is. Very large sheets are scaled so the long edge is about 1000pt in the PDF. A page with no symbols still gets a legend that says so.
