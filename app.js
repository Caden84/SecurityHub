/**
 * PanelPath — Michigan v1
 * Static decision-support for fire/security sales reps.
 * No invented list prices. No backend. No fake floor plans.
 *
 * =============================================================================
 * RECOMMENDATION HEURISTICS (commercial panel A/B/C)
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
 * Residential: ALWAYS show detector strategy A/B/C.
 * Panel A/B/C only when resSystem is fire|burg|both (not none).
 *
 * Prints gate:
 *   Commercial + no prints → hard stop only
 *   Residential + no prints → hard-stop warning + residential Qs + detector strategy
 *                             (no sq-ft bid counts, no commercial panel A/B/C unless
 *                              control panel system selected)
 */

(function () {
  "use strict";

  const STORAGE_KEY = "panelpath_intake_v2";
  const PRICES_KEY = "panelpath_prices_v2";
  const DISCLAIMER =
    "Decision support only. Confirm with AHJ and current Michigan Building Code / NFPA 72. Manufacturer calculators win on battery, voltage drop, and storage.";

  const HARD_STOP_MSG =
    "I can price this once I have prints (or a simple floor sketch with rooms labeled). Without that I’m guessing and the bid will be wrong.";

  const screens = {
    1: document.getElementById("screen-1"),
    2: document.getElementById("screen-2"),
    3: document.getElementById("screen-3"),
  };

  let state = {
    intake: null,
    rec: null,
    devices: null,
    detectorStrategy: null,
    showHardStopOnly: false,
    showSpecCode: false,
    unitCosts: {
      panel: "",
      smokes: "",
      pulls: "",
      horns: "",
      communicator: "",
      program: "",
      test: "",
      certification: "",
    },
    unitCostsSpec: {},
    unitCostsCode: {},
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

  /* ---------- intake gate / branch visibility ---------- */
  function getGateValues(form) {
    const fd = new FormData(form);
    return {
      jobScale: (fd.get("jobScale") || "").toString(),
      scope: (fd.get("scope") || "").toString(),
      prints: (fd.get("prints") || "").toString(),
    };
  }

  function updateIntakeVisibility() {
    const form = document.getElementById("intake-form");
    const gate = getGateValues(form);
    const body = document.getElementById("intake-body");
    const res = document.getElementById("residential-fields");
    const com = document.getElementById("commercial-fields");

    const gatesReady = !!(gate.jobScale && gate.scope && gate.prints);

    // Commercial + no prints: hard stop on continue — hide commercial detail fields
    // so we don't invent layout. Still show shared markup/notes? Spec says hard stop
    // only — hide rest of commercial form.
    if (!gatesReady) {
      body.hidden = true;
      res.hidden = true;
      com.hidden = true;
      return;
    }

    if (gate.jobScale === "commercial" && gate.prints === "none") {
      // Hard-stop on Continue — do not show commercial intake fields.
      body.hidden = true;
      res.hidden = true;
      com.hidden = true;
      return;
    }

    body.hidden = false;
    if (gate.jobScale === "residential") {
      res.hidden = false;
      com.hidden = true;
    } else {
      res.hidden = true;
      com.hidden = false;
    }
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

    const jobScale = get("jobScale");
    const scope = get("scope");
    const prints = get("prints");

    const base = {
      jobScale,
      scope,
      prints,
      job: get("job"),
      existingPanel: get("existingPanel"),
      ahj: get("ahj") || "unknown",
      markup: num("markup") ?? 40,
      notes: get("notes"),
    };

    if (jobScale === "residential") {
      return Object.assign(base, {
        stories: num("resStories") ?? 1,
        bedrooms: num("bedrooms") ?? 0,
        basement: get("basement") || "no",
        existingDetectors: get("existingDetectors") || "no",
        interconnected: get("interconnected") || "no",
        detectorPower: get("detectorPower") || "hardwired",
        coRequired: get("coRequired") || "unknown",
        resSystem: get("resSystem") || "none",
        // Commercial fields unused
        occupancy: "",
        highRise75: false,
        sqFt: null,
        sprinklered: "unknown",
        occupantLoad: null,
        system: get("resSystem") || "none",
        monitoring: "unknown",
        voice: "unknown",
        elevators: "none",
        mfrLock: "none",
      });
    }

    return Object.assign(base, {
      occupancy: get("occupancy"),
      stories: num("stories") ?? 1,
      highRise75: !!(form.elements.highRise75 && form.elements.highRise75.checked),
      sqFt: num("sqFt"),
      sprinklered: get("sprinklered") || "unknown",
      occupantLoad: num("occupantLoad"),
      system: get("system"),
      monitoring: get("monitoring") || "unknown",
      voice: get("voice") || "unknown",
      elevators: get("elevators") || "none",
      mfrLock: get("mfrLock") || "none",
      // Residential unused
      bedrooms: null,
      basement: "",
      existingDetectors: "",
      interconnected: "",
      detectorPower: "",
      coRequired: "",
      resSystem: "",
    });
  }

  function softValidate(intake) {
    const missing = [];
    if (!intake.jobScale) missing.push("Job scale");
    if (!intake.scope) missing.push("Scope");
    if (!intake.prints) missing.push("Prints");

    // Commercial + no prints: only gates required (hard stop)
    if (intake.jobScale === "commercial" && intake.prints === "none") {
      return missing;
    }

    if (!intake.job) missing.push("Job");

    if (intake.jobScale === "residential") {
      // Residential always needs residential answers for strategy path
      if (intake.bedrooms == null) missing.push("Bedrooms");
      if (!intake.resSystem && intake.resSystem !== "none") {
        /* defaulted */
      }
    } else if (intake.jobScale === "commercial") {
      if (!intake.occupancy) missing.push("Occupancy");
      if (!intake.system) missing.push("System");
      if (intake.prints === "have" && (intake.sqFt == null || intake.sqFt < 1)) {
        missing.push("Approx sq ft");
      }
    }
    return missing;
  }

  function fillForm(intake) {
    if (!intake) return;
    const form = document.getElementById("intake-form");
    const setRadio = (name, val) => {
      if (val == null || val === "") return;
      const el = form.querySelector(
        `input[name="${name}"][value="${CSS.escape(String(val))}"]`
      );
      if (el) el.checked = true;
    };
    setRadio("jobScale", intake.jobScale);
    setRadio("scope", intake.scope);
    setRadio("prints", intake.prints);
    setRadio("job", intake.job);
    form.elements.existingPanel.value = intake.existingPanel || "";
    setRadio("ahj", intake.ahj || "unknown");

    if (intake.jobScale === "residential") {
      form.elements.resStories.value = intake.stories ?? 1;
      form.elements.bedrooms.value = intake.bedrooms ?? 3;
      setRadio("basement", intake.basement || "no");
      setRadio("existingDetectors", intake.existingDetectors || "no");
      setRadio("interconnected", intake.interconnected || "no");
      setRadio("detectorPower", intake.detectorPower || "hardwired");
      setRadio("coRequired", intake.coRequired || "unknown");
      setRadio("resSystem", intake.resSystem || intake.system || "none");
    } else {
      form.elements.occupancy.value = intake.occupancy || "";
      form.elements.stories.value = intake.stories ?? 1;
      if (form.elements.highRise75) {
        form.elements.highRise75.checked = !!intake.highRise75;
      }
      form.elements.sqFt.value = intake.sqFt ?? "";
      setRadio("sprinklered", intake.sprinklered || "unknown");
      form.elements.occupantLoad.value =
        intake.occupantLoad != null ? intake.occupantLoad : "";
      setRadio("system", intake.system);
      setRadio("monitoring", intake.monitoring || "unknown");
      setRadio("voice", intake.voice || "unknown");
      setRadio("elevators", intake.elevators || "none");
      setRadio("mfrLock", intake.mfrLock || "none");
    }

    form.elements.markup.value = intake.markup ?? 40;
    form.elements.notes.value = intake.notes || "";
    updateIntakeVisibility();
  }

  /* ---------- recommendation engine (commercial / panel) ---------- */
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
    const system = intake.system || intake.resSystem || "none";
    const includesFire = system === "fire" || system === "both";
    const burgOnly = system === "burg";

    let rule;
    if (voiceLikely || highRise || largeAssembly) rule = 3;
    else if (includesFire) rule = 2;
    else rule = 1;

    const needsSpecCode =
      intake.jobScale === "commercial" &&
      (intake.occupancy === "education" ||
        intake.occupancy === "assembly" ||
        intake.occupancy === "healthcare" ||
        intake.voice === "required" ||
        highRise);

    return {
      highRise,
      voiceLikely,
      largeAssembly,
      smallCommercial,
      includesFire,
      burgOnly,
      rule,
      needsSpecCode,
      system,
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

  /* ---------- residential detector strategy ---------- */
  function detectorStrategy(intake) {
    return {
      A: {
        label: "Code-minimum placement checklist",
        tag: "likely",
        why:
          "Sleeping rooms, outside each sleeping area, each story, basement" +
          (intake.basement === "yes" ? " (basement yes)" : "") +
          ". Confirm with AHJ / MI residential rules.",
      },
      B: {
        label: "Same + interconnected hardwired",
        tag: "check AHJ",
        why:
          "Code-minimum locations plus interconnected hardwired 120V with battery backup" +
          (intake.detectorPower === "battery"
            ? " (intake said battery-only — upgrade path)."
            : "."),
      },
      C: {
        label: "Combo smoke/CO where it makes sense",
        tag: "check AHJ",
        why:
          "Same placement with combo smoke/CO where CO is required or likely" +
          (intake.coRequired === "yes"
            ? " (CO required: yes)."
            : intake.coRequired === "no"
              ? " (CO marked no — confirm)."
              : " (CO unknown — verify)."),
      },
    };
  }

  /* ---------- device estimates ---------- */
  function estimateDevices(intake, heuristics) {
    // Residential without prints: no sq-ft bid quantities
    if (intake.jobScale === "residential" && intake.prints === "none") {
      return {
        panel: heuristics.system && heuristics.system !== "none" ? 1 : 0,
        smokes: 0,
        pulls: 0,
        horns: 0,
        communicator: 0,
        checklistOnly: true,
      };
    }

    if (intake.jobScale === "residential") {
      // With prints: still no invented sq-ft densities — checklist only for detectors
      const hasPanel = heuristics.system && heuristics.system !== "none";
      return {
        panel: hasPanel ? 1 : 0,
        smokes: 0,
        pulls: 0,
        horns: 0,
        communicator: 0,
        checklistOnly: true,
      };
    }

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
      checklistOnly: false,
    };
  }

  /* ---------- render results ---------- */
  function renderHardStop(showOnly) {
    const card = document.getElementById("hard-stop");
    const main = document.getElementById("results-main");
    card.hidden = false;
    document.getElementById("hard-stop-msg").value = HARD_STOP_MSG;
    if (showOnly) {
      main.hidden = true;
    } else {
      main.hidden = false;
    }
  }

  function hideHardStop() {
    document.getElementById("hard-stop").hidden = true;
    document.getElementById("results-main").hidden = false;
  }

  function renderFlags(rec, intake) {
    const box = document.getElementById("flags");
    box.innerHTML = "";
    const add = (text, cls) => {
      const span = document.createElement("span");
      span.className = "flag-chip " + (cls || "warn");
      span.textContent = text;
      box.appendChild(span);
    };
    add("confirm AHJ", "warn");
    if (intake.jobScale === "residential") add("residential", "warn");
    if (intake.jobScale === "commercial") add("commercial", "warn");
    if (intake.scope === "check-and-test") add("check-and-test", "warn");
    if (intake.scope === "turnkey") add("turnkey", "warn");
    if (intake.prints === "none") add("no prints", "alert");
    if (rec && rec.voiceLikely) add("voice likely", "warn");
    if (rec && rec.highRise) add("high-rise", "alert");
    if (rec && rec.rule === 3) add("don't sell 20P", "alert");
    if (intake.ahj === "unknown") add("AHJ unknown", "warn");
    if (rec && rec.needsSpecCode) add("Spec vs code", "alert");

    const occFlag = document.getElementById("occ-flag");
    if (
      intake.jobScale === "commercial" &&
      (intake.occupancy === "healthcare" || intake.occupancy === "education")
    ) {
      occFlag.hidden = false;
      occFlag.textContent = "verify voice and detection with AHJ";
    } else {
      occFlag.hidden = true;
      occFlag.textContent = "";
    }

    const specWarn = document.getElementById("spec-code-warn");
    if (rec && rec.needsSpecCode) {
      specWarn.hidden = false;
      specWarn.textContent =
        "Spec may show horns only. Michigan/IBC path often wants voice. Bidding the spec as-is can win the number and hose the customer. Show both prices: spec-as-drawn vs code-corrected.";
    } else {
      specWarn.hidden = true;
      specWarn.textContent = "";
    }
  }

  function renderOptionCards(container, options) {
    container.innerHTML = "";
    ["A", "B", "C"].forEach((letter) => {
      const o = options[letter];
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
      container.appendChild(card);
    });
  }

  function renderDevices(intake, devices) {
    const ul = document.getElementById("device-counts");
    const checklist = document.getElementById("res-checklist");
    const byOthers = document.getElementById("device-by-others");
    const estLabel = document.getElementById("device-est-label");

    if (intake.scope === "check-and-test") {
      byOthers.hidden = false;
    } else {
      byOthers.hidden = true;
    }

    if (devices.checklistOnly) {
      ul.innerHTML = "";
      ul.hidden = true;
      checklist.hidden = false;
      estLabel.textContent = "CHECKLIST — not bid quantities";
      const items = [
        "Sleeping rooms — smoke (confirm count with prints / walk)",
        "Outside each sleeping area",
        "Each story including basement if present",
        intake.coRequired === "yes"
          ? "CO / combo where required"
          : "CO — verify if required",
      ];
      checklist.innerHTML =
        "<p class=\"hint\">No sq-ft ESTIMATE counts as bid quantities without a floor plan.</p><ul>" +
        items.map((t) => "<li>" + escapeHtml(t) + "</li>").join("") +
        "</ul>";
      return;
    }

    checklist.hidden = true;
    checklist.innerHTML = "";
    ul.hidden = false;
    estLabel.textContent = "ESTIMATE";
    const rows = [
      ["Smokes", devices.smokes],
      ["Pulls", devices.pulls],
      ["Horns / Speakers", devices.horns],
      ["Communicator", devices.communicator],
    ];
    if (intake.scope === "check-and-test") {
      ul.innerHTML = rows
        .map(
          ([lbl, qty]) =>
            "<li><span class=\"qty\">" +
            qty +
            '</span><span class="lbl">' +
            escapeHtml(lbl) +
            " (ESTIMATE — devices by others)</span></li>"
        )
        .join("");
    } else {
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
  }

  function priceRowsFor(intake, devices) {
    if (intake.scope === "check-and-test") {
      return [
        { key: "program", label: "Program", qty: 1 },
        { key: "test", label: "Test", qty: 1 },
        { key: "certification", label: "Certification", qty: 1 },
      ];
    }
    // Turnkey
    if (devices.checklistOnly) {
      const rows = [];
      if (devices.panel) {
        rows.push({ key: "panel", label: "Panel", qty: devices.panel });
      }
      rows.push(
        { key: "program", label: "Program / setup (labor)", qty: 1 },
        { key: "test", label: "Test", qty: 1 },
        { key: "certification", label: "Certification", qty: 1 }
      );
      return rows;
    }
    return [
      { key: "panel", label: "Panel", qty: devices.panel },
      { key: "smokes", label: "Smokes", qty: devices.smokes },
      { key: "pulls", label: "Pulls", qty: devices.pulls },
      { key: "horns", label: "Horns/Speakers", qty: devices.horns },
      {
        key: "communicator",
        label: "Communicator",
        qty: devices.communicator,
      },
    ];
  }

  function fillPriceBody(tbody, rows, unitCosts, prefix) {
    tbody.innerHTML = "";
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      const unitVal =
        unitCosts[r.key] === "" || unitCosts[r.key] == null
          ? ""
          : unitCosts[r.key];
      const costAttr = prefix ? prefix + ":" + r.key : r.key;
      tr.innerHTML =
        "<td>" +
        escapeHtml(r.label) +
        '</td><td class="qty-cell">' +
        r.qty +
        '</td><td><input type="number" min="0" step="0.01" data-cost="' +
        escapeAttr(costAttr) +
        '" placeholder="—" value="' +
        escapeAttr(unitVal) +
        '" aria-label="' +
        escapeAttr(r.label) +
        ' unit cost" /></td><td class="ext" data-ext="' +
        escapeAttr(costAttr) +
        '">$0.00</td>';
      tbody.appendChild(tr);
    });
  }

  function renderPriceTable(intake, devices, markup, unitCosts) {
    const rows = priceRowsFor(intake, devices);
    const dual = state.showSpecCode;
    const single = document.getElementById("price-single");
    const dualEl = document.getElementById("price-dual");
    const hint = document.getElementById("price-hint");

    if (intake.scope === "check-and-test") {
      hint.textContent =
        "Check-and-test: labor rows only (Program / Test / Certification). Device install by others. Unit $ empty.";
    } else {
      hint.textContent =
        "Unit costs stay empty — you fill them. No list prices invented.";
    }

    if (dual) {
      single.hidden = true;
      dualEl.hidden = false;
      if (!state.unitCostsSpec || !Object.keys(state.unitCostsSpec).length) {
        state.unitCostsSpec = Object.assign({}, unitCosts);
      }
      if (!state.unitCostsCode || !Object.keys(state.unitCostsCode).length) {
        state.unitCostsCode = Object.assign({}, unitCosts);
      }
      fillPriceBody(
        document.getElementById("price-body-spec"),
        rows,
        state.unitCostsSpec,
        "spec"
      );
      fillPriceBody(
        document.getElementById("price-body-code"),
        rows,
        state.unitCostsCode,
        "code"
      );
      document.getElementById("markup-live-spec").value = markup;
      document.getElementById("markup-live-code").value = markup;
      recalcPrices();
    } else {
      dualEl.hidden = true;
      single.hidden = false;
      fillPriceBody(document.getElementById("price-body"), rows, unitCosts, "");
      document.getElementById("markup-live").value = markup;
      recalcPrices();
    }
  }

  function recalcPrices() {
    if (state.showSpecCode) {
      recalcOne(
        "#price-body-spec",
        "markup-live-spec",
        "price-total-spec",
        "spec"
      );
      recalcOne(
        "#price-body-code",
        "markup-live-code",
        "price-total-code",
        "code"
      );
    } else {
      recalcOne("#price-body", "markup-live", "price-total", "");
    }
    try {
      sessionStorage.setItem(
        PRICES_KEY,
        JSON.stringify({
          unitCosts: state.unitCosts,
          unitCostsSpec: state.unitCostsSpec,
          unitCostsCode: state.unitCostsCode,
          markup: state.markup,
        })
      );
    } catch (_) {}
  }

  function recalcOne(bodySel, markupId, totalId, prefix) {
    const markupEl = document.getElementById(markupId);
    const markup = Number(markupEl.value);
    const m = Number.isFinite(markup) ? markup : 0;
    if (!prefix) state.markup = m;
    let total = 0;
    const inputs = document.querySelectorAll(bodySel + " input[data-cost]");
    inputs.forEach((inp) => {
      const rawKey = inp.getAttribute("data-cost");
      const key = prefix ? rawKey.replace(prefix + ":", "") : rawKey;
      const qtyCell = inp.closest("tr").querySelector(".qty-cell");
      const qty = Number(qtyCell.textContent) || 0;
      const unit = inp.value === "" ? NaN : Number(inp.value);
      if (prefix === "spec") {
        state.unitCostsSpec[key] = inp.value === "" ? "" : inp.value;
      } else if (prefix === "code") {
        state.unitCostsCode[key] = inp.value === "" ? "" : inp.value;
      } else {
        state.unitCosts[key] = inp.value === "" ? "" : inp.value;
      }
      let ext = 0;
      if (Number.isFinite(unit) && unit >= 0) {
        ext = qty * unit * (1 + m / 100);
      }
      total += ext;
      const extCell = document.querySelector(
        '[data-ext="' + CSS.escape(rawKey) + '"]'
      );
      if (extCell) extCell.textContent = formatMoney(ext);
    });
    document.getElementById(totalId).textContent = formatMoney(total);
  }

  /* ---------- summary ---------- */
  function labelMap(key, val) {
    const maps = {
      jobScale: { residential: "Residential", commercial: "Commercial" },
      scope: {
        turnkey: "Turnkey (wire + devices + program)",
        "check-and-test": "Check-and-test only",
      },
      prints: {
        have: "I have drawings",
        none: "I do not have drawings",
      },
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
      system: {
        fire: "Fire",
        burg: "Burg",
        both: "Both",
        none: "None (detectors only)",
      },
      monitoring: { yes: "Yes", no: "No", unknown: "Unknown" },
      voice: {
        already: "Already there",
        required: "Required",
        unknown: "Unknown",
        none: "None",
      },
      elevators: { none: "None", "1": "1 bank", "2+": "2+ banks" },
      basement: { yes: "Yes", no: "No" },
      existingDetectors: { yes: "Yes", no: "No" },
      interconnected: { yes: "Yes", no: "No" },
      detectorPower: {
        hardwired: "Hardwired 120V with battery backup",
        battery: "Battery-only",
      },
      coRequired: { unknown: "Unknown", yes: "Yes", no: "No" },
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
      ["Job scale", labelMap("jobScale", intake.jobScale)],
      ["Scope", labelMap("scope", intake.scope)],
      ["Prints", labelMap("prints", intake.prints)],
      ["Job", labelMap("job", intake.job)],
      ["Existing panel", intake.existingPanel || "—"],
      ["AHJ", labelMap("ahj", intake.ahj)],
    ];

    if (intake.jobScale === "residential") {
      intakeRows.push(
        ["Stories", String(intake.stories)],
        ["Bedrooms", String(intake.bedrooms)],
        ["Basement", labelMap("basement", intake.basement)],
        [
          "Existing detectors",
          labelMap("existingDetectors", intake.existingDetectors),
        ],
        ["Interconnected", labelMap("interconnected", intake.interconnected)],
        ["Power / backup", labelMap("detectorPower", intake.detectorPower)],
        ["CO required", labelMap("coRequired", intake.coRequired)],
        [
          "Control panel system",
          labelMap("system", intake.resSystem || intake.system),
        ]
      );
    } else {
      intakeRows.push(
        ["Occupancy", intake.occupancy || "—"],
        ["Stories", String(intake.stories)],
        ["75 ft+ occupied floor", intake.highRise75 ? "Yes" : "No"],
        ["Approx sq ft", intake.sqFt != null ? String(intake.sqFt) : "—"],
        ["Sprinklered", labelMap("sprinklered", intake.sprinklered)],
        [
          "Occupant load",
          intake.occupantLoad != null ? String(intake.occupantLoad) : "—",
        ],
        ["System", labelMap("system", intake.system)],
        ["Monitoring", labelMap("monitoring", intake.monitoring)],
        ["Voice evac", labelMap("voice", intake.voice)],
        ["Elevators", labelMap("elevators", intake.elevators)],
        ["Manufacturer lock", intake.mfrLock || "none"]
      );
    }

    intakeRows.push(
      ["Rep markup %", String(state.markup)],
      ["Notes", intake.notes || "—"]
    );

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

    if (intake.prints === "none") {
      html +=
        "<h4>Hard-stop note</h4><p>Need floor plan / prints before markup or device counts you can bid. " +
        escapeHtml(HARD_STOP_MSG) +
        "</p>";
    }

    if (state.showHardStopOnly) {
      body.innerHTML = html;
      return;
    }

    if (state.detectorStrategy) {
      html +=
        "<h4>Detector strategy <span class=\"est-label\">ESTIMATE / confirm with AHJ and Michigan residential rules</span></h4>";
      ["A", "B", "C"].forEach((letter) => {
        const o = state.detectorStrategy[letter];
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
    }

    if (rec && rec.options) {
      html += "<h4>Panel recommendations</h4>";
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
    }

    if (state.showSpecCode) {
      html +=
        "<h4>Spec vs code</h4><div class=\"two-col summary-cols\"><div><strong>Spec path</strong><ul><li>Follow drawings / horns as drawn</li><li>Bid notification as drawn</li></ul></div><div><strong>Code-corrected path</strong><ul><li>Voice / evac per MI / IBC</li><li>Align with rule 3 when voice / high-rise / large assembly</li></ul></div></div>";
    }

    html += "<h4>Flags</h4><ul>";
    html += "<li>confirm AHJ</li>";
    if (intake.prints === "none") html += "<li>no prints — need drawings before bid markup</li>";
    if (rec && rec.voiceLikely) html += "<li>voice likely</li>";
    if (rec && rec.highRise) html += "<li>high-rise</li>";
    if (rec && rec.rule === 3) html += "<li>don't sell 20P</li>";
    if (rec && rec.needsSpecCode) html += "<li>Spec vs code</li>";
    if (
      intake.jobScale === "commercial" &&
      (intake.occupancy === "healthcare" || intake.occupancy === "education")
    ) {
      html += "<li>verify voice and detection with AHJ</li>";
    }
    html += "</ul>";

    if (devices) {
      if (devices.checklistOnly) {
        html +=
          "<h4>Device approach</h4><p>Checklist only — no sq-ft ESTIMATE bid quantities without prints.</p>";
      } else {
        html +=
          "<h4>Device counts <span class=\"est-label\">ESTIMATE</span></h4><ul>" +
          "<li>Panel: " +
          devices.panel +
          "</li>" +
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
        if (intake.scope === "check-and-test") {
          html +=
            "<p><em>Devices by others (electrician) — check-and-test scope.</em></p>";
        }
      }
    }

    html +=
      "<h4>Labor framing</h4><p>" +
      (intake.scope === "check-and-test"
        ? "Program + Test + Certification only (no device install hours)."
        : "Turnkey: device + panel rows (or labor if residential checklist).") +
      "</p>";

    const rows = priceRowsFor(intake, devices || { panel: 0, checklistOnly: true });
    const m = state.markup;
    let total = 0;
    html +=
      "<h4>Price table</h4><p>Markup " +
      escapeHtml(String(m)) +
      "%</p><table><thead><tr><th>Item</th><th>Qty</th><th>Unit $</th><th>Extended</th></tr></thead><tbody>";
    rows.forEach((r) => {
      const unitRaw = state.unitCosts[r.key];
      const unit = unitRaw === "" || unitRaw == null ? NaN : Number(unitRaw);
      let ext = 0;
      const unitDisp = Number.isFinite(unit) ? formatMoney(unit) : "—";
      if (Number.isFinite(unit) && unit >= 0) {
        ext = r.qty * unit * (1 + m / 100);
        total += ext;
      }
      html +=
        "<tr><td>" +
        escapeHtml(r.label) +
        "</td><td>" +
        r.qty +
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

  function shouldShowPanelOptions(intake) {
    if (intake.jobScale === "residential") {
      const sys = intake.resSystem || intake.system || "none";
      return sys === "fire" || sys === "burg" || sys === "both";
    }
    return true; // commercial always has panel A/B/C when not hard-stopped
  }

  function goResults() {
    const intake = state.intake;
    state.showHardStopOnly = false;
    state.showSpecCode = false;
    state.detectorStrategy = null;
    state.rec = null;
    state.devices = null;

    // Commercial + no prints → hard stop only
    if (intake.jobScale === "commercial" && intake.prints === "none") {
      state.showHardStopOnly = true;
      renderHardStop(true);
      showScreen(2);
      return;
    }

    const showPanel = shouldShowPanelOptions(intake);
    let rec = null;
    if (showPanel) {
      rec = recommend(intake);
      state.rec = rec;
    } else if (intake.jobScale === "commercial") {
      rec = recommend(intake);
      state.rec = rec;
    } else {
      // residential detectors-only: still build light heuristics for devices
      rec = buildHeuristics(intake);
      state.rec = Object.assign({ options: null }, rec);
    }

    if (intake.jobScale === "residential") {
      state.detectorStrategy = detectorStrategy(intake);
    }

    state.showSpecCode = !!(rec && rec.needsSpecCode);
    const devices = estimateDevices(
      intake,
      rec || buildHeuristics(intake)
    );
    state.devices = devices;
    state.markup = intake.markup ?? 40;

    if (intake.prints === "none" && intake.jobScale === "residential") {
      renderHardStop(false); // banner + continue with strategy
    } else {
      hideHardStop();
    }

    renderFlags(state.rec || buildHeuristics(intake), intake);

    const detBlock = document.getElementById("detector-strategy-block");
    const panelBlock = document.getElementById("panel-options-block");
    const specBlock = document.getElementById("spec-code-block");

    if (state.detectorStrategy) {
      detBlock.hidden = false;
      renderOptionCards(
        document.getElementById("detector-options"),
        state.detectorStrategy
      );
    } else {
      detBlock.hidden = true;
    }

    if (showPanel && state.rec && state.rec.options) {
      panelBlock.hidden = false;
      document.getElementById("panel-options-title").textContent =
        intake.jobScale === "residential"
          ? "Panel options (burg/fire system selected)"
          : "Panel options";
      renderOptionCards(document.getElementById("options"), state.rec.options);
    } else {
      panelBlock.hidden = true;
      document.getElementById("options").innerHTML = "";
    }

    if (state.showSpecCode) {
      specBlock.hidden = false;
    } else {
      specBlock.hidden = true;
    }

    renderDevices(intake, devices);
    renderPriceTable(intake, devices, state.markup, state.unitCosts);
    showScreen(2);
  }

  /* ---------- wire events ---------- */
  const form = document.getElementById("intake-form");
  form.addEventListener("change", (e) => {
    if (
      e.target.name === "jobScale" ||
      e.target.name === "scope" ||
      e.target.name === "prints"
    ) {
      updateIntakeVisibility();
    }
  });

  form.addEventListener("submit", (e) => {
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
  document.getElementById("btn-hardstop-back").addEventListener("click", () => {
    showScreen(1);
  });

  document.getElementById("btn-copy-hardstop").addEventListener("click", () => {
    const ta = document.getElementById("hard-stop-msg");
    const toast = document.getElementById("copy-toast");
    const text = ta.value;
    const done = () => {
      toast.hidden = false;
      toast.textContent = "Copied.";
      setTimeout(() => {
        toast.hidden = true;
      }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {
        ta.select();
        try {
          document.execCommand("copy");
          done();
        } catch (_) {}
      });
    } else {
      ta.select();
      try {
        document.execCommand("copy");
        done();
      } catch (_) {}
    }
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

  ["price-body-spec", "price-body-code"].forEach((id) => {
    document.getElementById(id).addEventListener("input", (e) => {
      if (e.target.matches("input[data-cost]")) recalcPrices();
    });
  });
  document
    .getElementById("markup-live-spec")
    .addEventListener("input", recalcPrices);
  document
    .getElementById("markup-live-code")
    .addEventListener("input", recalcPrices);

  /* ---------- restore ---------- */
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.intake = parsed;
      fillForm(parsed);
    } else {
      updateIntakeVisibility();
    }
  } catch (_) {
    updateIntakeVisibility();
  }
  try {
    const prow = sessionStorage.getItem(PRICES_KEY);
    if (prow) {
      const p = JSON.parse(prow);
      if (p.unitCosts) state.unitCosts = Object.assign(state.unitCosts, p.unitCosts);
      if (p.unitCostsSpec) state.unitCostsSpec = p.unitCostsSpec;
      if (p.unitCostsCode) state.unitCostsCode = p.unitCostsCode;
      if (p.markup != null) state.markup = p.markup;
    }
  } catch (_) {}

  showScreen(1);

  window.PanelPath = {
    DISCLAIMER,
    HARD_STOP_MSG,
    recommend,
    estimateDevices,
    buildHeuristics,
    detectorStrategy,
  };
})();
