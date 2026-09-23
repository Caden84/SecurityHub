/**
 * PanelPath — Michigan v1
 * Static decision-support for fire/security sales reps.
 * No invented list prices. No backend.
 *
 * =============================================================================
 * RECOMMENDATION HEURISTICS (document in code — implement exactly)
 * =============================================================================
 * highRise     = 75 ft checkbox (occupied floor > 75 ft above FD access)
 * voiceLikely  = voice is "already there" OR "required"
 *                OR highRise
 *                OR (occupancy === assembly AND (sqFt > 12000 OR occupantLoad > 300))
 * largeAssembly = occupancy === assembly AND (sqFt > 12000 OR occupantLoad > 300)
 * smallCommercial = occupancy NOT in healthcare/education
 *                   AND !highRise AND !largeAssembly AND sqFt <= 20000
 *
 * Rule priority:
 *   if voiceLikely || highRise || largeAssembly → rule 3
 *   else if system includes fire (fire|both)    → rule 2
 *   else                                        → rule 1
 *
 * Rule 1 — Burg or small combo, not voice, not high-rise:
 *   A Vista-20P class, B Vista-128 class,
 *   C small addressable fire only if fire also selected;
 *   if burg-only, C = "add fire panel later / confirm AHJ"
 *
 * Rule 2 — Fire, small commercial, not high-rise, not big assembly:
 *   A FireWarden / NFS-320 class, B NFS-640 class,
 *   C Vista only if fire is NOT required (burg-only path shouldn't hit here);
 *   if fire required, C = "NFS-320 + expanders / check manufacturer lock"
 *
 * Rule 3 — Voice evac likely OR high-rise OR large assembly:
 *   A NFS-640 / voice, B NFS-3030 / voice,
 *   C "do not bid horn-only / do not bid Vista-20P"
 *
 * Manufacturer lock: lightly noted in the "why" line; still show A/B/C per rules.
 * Healthcare / education: flag "verify voice and detection with AHJ"
 *
 * =============================================================================
 * DEVICE-COUNT HEURISTICS (ESTIMATE only — simple densities)
 * =============================================================================
 * smokes ≈ max(1, round(sqFt / 900)) for fire/both; 0 for burg-only
 *   mild occupancy tweak: healthcare/education → /800; storage/factory → /1100
 * pulls  ≈ max(1, stories * 2) for fire/both if stories >= 1;
 *          else max(1, round(sqFt / 5000)); 0 burg-only
 * horns/speakers ≈ smokes if voiceLikely else max(1, round(smokes * 0.7)); 0 burg-only
 * communicator = 1 if monitoring is yes or unknown, else 0
 * Panel qty always 1 in price block.
 */

(function () {
  "use strict";

  const STORAGE_KEY = "panelpath_intake_v1";
  const PRICES_KEY = "panelpath_prices_v1";
  const DISCLAIMER =
    "Decision support only. Confirm with AHJ and current Michigan Building Code / NFPA 72. Manufacturer calculators win on battery, voltage drop, and storage.";

  const screens = {
    1: document.getElementById("screen-1"),
    2: document.getElementById("screen-2"),
    3: document.getElementById("screen-3"),
  };

  let state = {
    intake: null,
    rec: null,
    devices: null,
    unitCosts: { panel: "", smokes: "", pulls: "", horns: "", communicator: "" },
    markup: 40,
  };

  /* ---------- navigation ---------- */
  function showScreen(n) {
    Object.keys(screens).forEach((k) => {
      const el = screens[k];
      if (!el) return;
      if (Number(k) === n) {
        el.hidden = false;
        el.removeAttribute("hidden");
      } else {
        el.hidden = true;
        el.setAttribute("hidden", "");
      }
    });
    window.scrollTo(0, 0);
  }

  /* ---------- intake helpers ---------- */
  function readForm(form) {
    const fd = new FormData(form);
    const get = (name) => {
      const v = fd.get(name);
      return v == null ? "" : String(v).trim();
    };
    const num = (name) => {
      const raw = get(name);
      if (raw === "") return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };
    return {
      job: get("job"),
      existingPanel: get("existingPanel"),
      ahj: get("ahj") || "unknown",
      occupancy: get("occupancy"),
      stories: num("stories") ?? 1,
      highRise75: form.elements.highRise75.checked,
      sqFt: num("sqFt"),
      sprinklered: get("sprinklered") || "unknown",
      occupantLoad: num("occupantLoad"),
      system: get("system"),
      monitoring: get("monitoring") || "unknown",
      voice: get("voice") || "unknown",
      elevators: get("elevators") || "none",
      mfrLock: get("mfrLock") || "none",
      markup: num("markup") ?? 40,
      notes: get("notes"),
    };
  }

  function softValidate(intake) {
    const missing = [];
    if (!intake.job) missing.push("Job");
    if (!intake.occupancy) missing.push("Occupancy");
    if (!intake.system) missing.push("System");
    if (intake.sqFt == null || intake.sqFt < 1) missing.push("Approx sq ft");
    return missing;
  }

  function fillForm(intake) {
    if (!intake) return;
    const form = document.getElementById("intake-form");
    const setRadio = (name, val) => {
      const el = form.querySelector(`input[name="${name}"][value="${CSS.escape(String(val))}"]`);
      if (el) el.checked = true;
    };
    setRadio("job", intake.job);
    form.elements.existingPanel.value = intake.existingPanel || "";
    setRadio("ahj", intake.ahj || "unknown");
    form.elements.occupancy.value = intake.occupancy || "";
    form.elements.stories.value = intake.stories ?? 1;
    form.elements.highRise75.checked = !!intake.highRise75;
    form.elements.sqFt.value = intake.sqFt ?? "";
    setRadio("sprinklered", intake.sprinklered || "unknown");
    form.elements.occupantLoad.value =
      intake.occupantLoad != null ? intake.occupantLoad : "";
    setRadio("system", intake.system);
    setRadio("monitoring", intake.monitoring || "unknown");
    setRadio("voice", intake.voice || "unknown");
    setRadio("elevators", intake.elevators || "none");
    setRadio("mfrLock", intake.mfrLock || "none");
    form.elements.markup.value = intake.markup ?? 40;
    form.elements.notes.value = intake.notes || "";
  }

  /* ---------- recommendation engine ---------- */
  function buildHeuristics(intake) {
    const highRise = !!intake.highRise75;
    const sqFt = intake.sqFt || 0;
    const load = intake.occupantLoad;
    const largeAssembly =
      intake.occupancy === "assembly" &&
      (sqFt > 12000 || (load != null && load > 300));
    const voiceLikely =
      intake.voice === "already" ||
      intake.voice === "required" ||
      highRise ||
      largeAssembly;
    const smallCommercial =
      intake.occupancy !== "healthcare" &&
      intake.occupancy !== "education" &&
      !highRise &&
      !largeAssembly &&
      sqFt <= 20000;
    const includesFire = intake.system === "fire" || intake.system === "both";
    const burgOnly = intake.system === "burg";

    let rule;
    if (voiceLikely || highRise || largeAssembly) rule = 3;
    else if (includesFire) rule = 2;
    else rule = 1;

    return {
      highRise,
      voiceLikely,
      largeAssembly,
      smallCommercial,
      includesFire,
      burgOnly,
      rule,
    };
  }

  function lockNote(intake) {
    if (!intake.mfrLock || intake.mfrLock === "none") return "";
    return ` lock: ${intake.mfrLock} — prefer matching class`;
  }

  function recommend(intake) {
    const h = buildHeuristics(intake);
    const lock = lockNote(intake);
    let A, B, C;

    if (h.rule === 3) {
      // Prefer rule 3 when voiceLikely || highRise || largeAssembly
      A = {
        label: "NFS-640 / voice class",
        tag: "likely",
        why: "Voice or high-rise / large assembly path." + lock,
      };
      B = {
        label: "NFS-3030 / voice class",
        tag: "check AHJ",
        why: "Larger networked / campus voice when AHJ or scale demands it." + lock,
      };
      C = {
        label: "Do not bid horn-only / do not bid Vista-20P",
        tag: "check AHJ",
        why: "Horn-only or 20P-class is the wrong bid on this path.",
      };
    } else if (h.rule === 2) {
      A = {
        label: "FireWarden / NFS-320 class",
        tag: "likely",
        why: "Fire, small commercial, not high-rise / big assembly." + lock,
      };
      B = {
        label: "NFS-640 class",
        tag: "check AHJ",
        why: "Step-up capacity or denser device count." + lock,
      };
      if (h.includesFire) {
        C = {
          label: "NFS-320 + expanders / check manufacturer lock",
          tag: "check AHJ",
          why: "Stay in addressable fire; expand rather than down-bid." + lock,
        };
      } else {
        C = {
          label: "Vista class (fire not required)",
          tag: "check AHJ",
          why: "Burg-only fallback — confirm fire is truly not required." + lock,
        };
      }
    } else {
      // Rule 1
      A = {
        label: "Vista-20P class",
        tag: "likely",
        why: "Burg or small combo; not voice; not high-rise." + lock,
      };
      B = {
        label: "Vista-128 class",
        tag: "check AHJ",
        why: "More zones / points or commercial burg scale." + lock,
      };
      if (h.includesFire) {
        C = {
          label: "Small addressable fire class",
          tag: "check AHJ",
          why: "Fire also selected — consider a small addressable FACP." + lock,
        };
      } else {
        C = {
          label: "Add fire panel later / confirm AHJ",
          tag: "check AHJ",
          why: "Burg-only today — confirm whether fire is deferred or not required.",
        };
      }
    }

    return { ...h, options: { A, B, C } };
  }

  /* ---------- device estimates ---------- */
  function estimateDevices(intake, heuristics) {
    const burgOnly = intake.system === "burg";
    const sqFt = intake.sqFt || 0;
    const stories = Math.max(0, intake.stories || 0);

    let smokeDiv = 900;
    if (intake.occupancy === "healthcare" || intake.occupancy === "education") {
      smokeDiv = 800;
    } else if (intake.occupancy === "storage" || intake.occupancy === "factory") {
      smokeDiv = 1100;
    }

    let smokes = 0;
    let pulls = 0;
    let horns = 0;

    if (!burgOnly) {
      smokes = Math.max(1, Math.round(sqFt / smokeDiv));
      if (stories >= 1) {
        pulls = Math.max(1, stories * 2);
      } else {
        pulls = Math.max(1, Math.round(sqFt / 5000));
      }
      if (heuristics.voiceLikely) {
        horns = smokes;
      } else {
        horns = Math.max(1, Math.round(smokes * 0.7));
      }
    }

    const communicator =
      intake.monitoring === "yes" || intake.monitoring === "unknown" ? 1 : 0;

    return {
      panel: 1,
      smokes,
      pulls,
      horns,
      communicator,
    };
  }

  /* ---------- render results ---------- */
  function renderFlags(rec, intake) {
    const box = document.getElementById("flags");
    box.innerHTML = "";
    const add = (text, cls) => {
      const span = document.createElement("span");
      span.className = "flag-chip " + (cls || "warn");
      span.textContent = text;
      box.appendChild(span);
    };
    // Always show confirm AHJ
    add("confirm AHJ", "warn");
    if (rec.voiceLikely) add("voice likely", "warn");
    if (rec.highRise) add("high-rise", "alert");
    if (rec.rule === 3) add("don't sell 20P", "alert");
    if (intake.ahj === "unknown") add("AHJ unknown", "warn");

    const occFlag = document.getElementById("occ-flag");
    if (intake.occupancy === "healthcare" || intake.occupancy === "education") {
      occFlag.hidden = false;
      occFlag.textContent = "verify voice and detection with AHJ";
    } else {
      occFlag.hidden = true;
      occFlag.textContent = "";
    }
  }

  function renderOptions(rec) {
    const box = document.getElementById("options");
    box.innerHTML = "";
    ["A", "B", "C"].forEach((letter) => {
      const o = rec.options[letter];
      const card = document.createElement("article");
      card.className = "option-card";
      const tagClass = o.tag === "likely" ? "likely-tag" : "check-tag";
      card.innerHTML =
        "<h4><span class=\"opt-letter\">" +
        letter +
        "</span> " +
        escapeHtml(o.label) +
        ' <span class="' +
        tagClass +
        '">' +
        escapeHtml(o.tag) +
        "</span></h4>" +
        '<p class="why">' +
        escapeHtml(o.why) +
        "</p>";
      box.appendChild(card);
    });
  }

  function renderDevices(devices) {
    const ul = document.getElementById("device-counts");
    const rows = [
      ["Smokes", devices.smokes],
      ["Pulls", devices.pulls],
      ["Horns / Speakers", devices.horns],
      ["Communicator", devices.communicator],
    ];
    ul.innerHTML = rows
      .map(
        ([lbl, qty]) =>
          "<li><span class=\"qty\">" +
          qty +
          '</span><span class="lbl">' +
          escapeHtml(lbl) +
          " (ESTIMATE)</span></li>"
      )
      .join("");
  }

  function renderPriceTable(devices, markup, unitCosts) {
    const body = document.getElementById("price-body");
    const rows = [
      { key: "panel", label: "Panel", qty: devices.panel },
      { key: "smokes", label: "Smokes", qty: devices.smokes },
      { key: "pulls", label: "Pulls", qty: devices.pulls },
      { key: "horns", label: "Horns/Speakers", qty: devices.horns },
      { key: "communicator", label: "Communicator", qty: devices.communicator },
    ];
    body.innerHTML = "";
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      const unitVal = unitCosts[r.key] === "" || unitCosts[r.key] == null ? "" : unitCosts[r.key];
      tr.innerHTML =
        "<td>" +
        escapeHtml(r.label) +
        '</td><td class="qty-cell">' +
        r.qty +
        '</td><td><input type="number" min="0" step="0.01" data-cost="' +
        r.key +
        '" placeholder="—" value="' +
        escapeAttr(unitVal) +
        '" aria-label="' +
        escapeAttr(r.label) +
        ' unit cost" /></td><td class="ext" data-ext="' +
        r.key +
        '">$0.00</td>';
      body.appendChild(tr);
    });
    document.getElementById("markup-live").value = markup;
    recalcPrices();
  }

  function recalcPrices() {
    const markup = Number(document.getElementById("markup-live").value);
    const m = Number.isFinite(markup) ? markup : 0;
    state.markup = m;
    let total = 0;
    const inputs = document.querySelectorAll("#price-body input[data-cost]");
    inputs.forEach((inp) => {
      const key = inp.getAttribute("data-cost");
      const qtyCell = inp.closest("tr").querySelector(".qty-cell");
      const qty = Number(qtyCell.textContent) || 0;
      const unit = inp.value === "" ? NaN : Number(inp.value);
      state.unitCosts[key] = inp.value === "" ? "" : inp.value;
      let ext = 0;
      if (Number.isFinite(unit) && unit >= 0) {
        ext = qty * unit * (1 + m / 100);
      }
      total += ext;
      const extCell = document.querySelector('[data-ext="' + key + '"]');
      if (extCell) extCell.textContent = formatMoney(ext);
    });
    document.getElementById("price-total").textContent = formatMoney(total);
    try {
      sessionStorage.setItem(
        PRICES_KEY,
        JSON.stringify({ unitCosts: state.unitCosts, markup: state.markup })
      );
    } catch (_) {}
  }

  /* ---------- summary ---------- */
  function labelMap(key, val) {
    const maps = {
      job: { new: "New", replace: "Replace", "add-on": "Add-on" },
      ahj: {
        city: "City",
        township: "Township",
        "state-fire": "State fire",
        unknown: "Unknown",
      },
      sprinklered: {
        yes: "Yes",
        no: "No",
        partial: "Partial",
        unknown: "Unknown",
      },
      system: { fire: "Fire", burg: "Burg", both: "Both" },
      monitoring: { yes: "Yes", no: "No", unknown: "Unknown" },
      voice: {
        already: "Already there",
        required: "Required",
        unknown: "Unknown",
        none: "None",
      },
      elevators: { none: "None", "1": "1 bank", "2+": "2+ banks" },
    };
    if (maps[key] && maps[key][val] != null) return maps[key][val];
    if (val === "" || val == null) return "—";
    return String(val);
  }

  function renderSummary() {
    const intake = state.intake;
    const rec = state.rec;
    const devices = state.devices;
    const body = document.getElementById("summary-body");

    const intakeRows = [
      ["Job", labelMap("job", intake.job)],
      ["Existing panel", intake.existingPanel || "—"],
      ["AHJ", labelMap("ahj", intake.ahj)],
      ["Occupancy", intake.occupancy],
      ["Stories", String(intake.stories)],
      [
        "75 ft+ occupied floor",
        intake.highRise75 ? "Yes" : "No",
      ],
      ["Approx sq ft", String(intake.sqFt)],
      ["Sprinklered", labelMap("sprinklered", intake.sprinklered)],
      [
        "Occupant load",
        intake.occupantLoad != null ? String(intake.occupantLoad) : "—",
      ],
      ["System", labelMap("system", intake.system)],
      ["Monitoring", labelMap("monitoring", intake.monitoring)],
      ["Voice evac", labelMap("voice", intake.voice)],
      ["Elevators", labelMap("elevators", intake.elevators)],
      ["Manufacturer lock", intake.mfrLock || "none"],
      ["Rep markup %", String(state.markup)],
      ["Notes", intake.notes || "—"],
    ];

    let html = "<h4>Intake</h4><dl>";
    intakeRows.forEach(([k, v]) => {
      html +=
        "<dt>" +
        escapeHtml(k) +
        "</dt><dd>" +
        escapeHtml(v) +
        "</dd>";
    });
    html += "</dl>";

    html += "<h4>Recommendations</h4>";
    ["A", "B", "C"].forEach((letter) => {
      const o = rec.options[letter];
      html +=
        "<p><strong>" +
        letter +
        " — " +
        escapeHtml(o.label) +
        "</strong> (" +
        escapeHtml(o.tag) +
        ")<br />" +
        escapeHtml(o.why) +
        "</p>";
    });

    html += "<h4>Flags</h4><ul>";
    html += "<li>confirm AHJ</li>";
    if (rec.voiceLikely) html += "<li>voice likely</li>";
    if (rec.highRise) html += "<li>high-rise</li>";
    if (rec.rule === 3) html += "<li>don't sell 20P</li>";
    if (intake.occupancy === "healthcare" || intake.occupancy === "education") {
      html += "<li>verify voice and detection with AHJ</li>";
    }
    html += "</ul>";

    html +=
      "<h4>Device counts <span class=\"est-label\">ESTIMATE</span></h4><ul>" +
      "<li>Panel: 1</li>" +
      "<li>Smokes: " +
      devices.smokes +
      "</li>" +
      "<li>Pulls: " +
      devices.pulls +
      "</li>" +
      "<li>Horns/Speakers: " +
      devices.horns +
      "</li>" +
      "<li>Communicator: " +
      devices.communicator +
      "</li></ul>";

    const m = state.markup;
    const costRows = [
      ["Panel", devices.panel, state.unitCosts.panel],
      ["Smokes", devices.smokes, state.unitCosts.smokes],
      ["Pulls", devices.pulls, state.unitCosts.pulls],
      ["Horns/Speakers", devices.horns, state.unitCosts.horns],
      ["Communicator", devices.communicator, state.unitCosts.communicator],
    ];
    let total = 0;
    html +=
      "<h4>Price table</h4><p>Markup " +
      escapeHtml(String(m)) +
      "%</p><table><thead><tr><th>Item</th><th>Qty</th><th>Unit $</th><th>Extended</th></tr></thead><tbody>";
    costRows.forEach(([label, qty, unitRaw]) => {
      const unit = unitRaw === "" || unitRaw == null ? NaN : Number(unitRaw);
      let ext = 0;
      const unitDisp = Number.isFinite(unit) ? formatMoney(unit) : "—";
      if (Number.isFinite(unit) && unit >= 0) {
        ext = qty * unit * (1 + m / 100);
        total += ext;
      }
      html +=
        "<tr><td>" +
        escapeHtml(label) +
        "</td><td>" +
        qty +
        "</td><td>" +
        unitDisp +
        "</td><td>" +
        formatMoney(ext) +
        "</td></tr>";
    });
    html +=
      '</tbody><tfoot><tr><td colspan="3"><strong>Total</strong></td><td><strong>' +
      formatMoney(total) +
      "</strong></td></tr></tfoot></table>";

    body.innerHTML = html;
  }

  /* ---------- utils ---------- */
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }
  function formatMoney(n) {
    if (!Number.isFinite(n)) return "$0.00";
    return (
      "$" +
      n.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  function goResults() {
    const rec = recommend(state.intake);
    const devices = estimateDevices(state.intake, rec);
    state.rec = rec;
    state.devices = devices;
    state.markup = state.intake.markup ?? 40;
    renderFlags(rec, state.intake);
    renderOptions(rec);
    renderDevices(devices);
    renderPriceTable(devices, state.markup, state.unitCosts);
    showScreen(2);
  }

  /* ---------- wire events ---------- */
  document.getElementById("intake-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const err = document.getElementById("intake-error");
    const intake = readForm(e.target);
    const missing = softValidate(intake);
    if (missing.length) {
      err.hidden = false;
      err.textContent = "Required: " + missing.join(", ");
      return;
    }
    err.hidden = true;
    state.intake = intake;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(intake));
    } catch (_) {}
    goResults();
  });

  document.getElementById("btn-back-intake").addEventListener("click", () => {
    showScreen(1);
  });

  document.getElementById("btn-summary").addEventListener("click", () => {
    renderSummary();
    showScreen(3);
  });

  document.getElementById("btn-back-results").addEventListener("click", () => {
    showScreen(2);
  });

  document.getElementById("btn-print").addEventListener("click", () => {
    window.print();
  });

  document.getElementById("btn-exact-vision").addEventListener("click", () => {
    const msg = document.getElementById("exact-vision-msg");
    msg.hidden = false;
    msg.textContent = "paste dealer URL later";
  });

  document.getElementById("price-body").addEventListener("input", (e) => {
    if (e.target.matches("input[data-cost]")) recalcPrices();
  });
  document.getElementById("markup-live").addEventListener("input", recalcPrices);

  /* ---------- restore ---------- */
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.intake = parsed;
      fillForm(parsed);
    }
  } catch (_) {}
  try {
    const prow = sessionStorage.getItem(PRICES_KEY);
    if (prow) {
      const p = JSON.parse(prow);
      if (p.unitCosts) state.unitCosts = Object.assign(state.unitCosts, p.unitCosts);
      if (p.markup != null) state.markup = p.markup;
    }
  } catch (_) {}

  showScreen(1);

  // Expose for quick sanity / debug (optional)
  window.PanelPath = {
    DISCLAIMER,
    recommend,
    estimateDevices,
    buildHeuristics,
  };
})();
