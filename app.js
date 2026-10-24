/**
 * PanelPath — Michigan v1
 * Static decision-support for fire/security sales reps.
 * No invented list prices. No backend. No fake floor plans.
 *
 * Incomplete jobs stay open. Results lists each hole and one
 * plain-language question back to the rep. Panel path and Takeoff
 * stay available, marked incomplete until those Intake fields are filled.
 *
 * Holes:
 *   - no prints
 *   - unreadable or missing upload
 *   - occupant load unknown
 *   - add-on/takeover/replacement without devices marked on the print
 *   - year built blank
 *   - hazards blank
 *   - ceiling height blank
 *   - lift not answered (commercial, or residential stories >= 2)
 *
 * Ceiling + lift: asked on commercial; residential when stories >= 2.
 *
 * Takeoff print markup: import a PDF or image, place starter-catalog
 * symbols, and export a marked-up PDF. Counts follow the symbols.
 * Auto-read stays off. The manual checklist is unchanged.
 */

(function () {
  "use strict";

  const STORAGE_KEY = "panelpath_intake_v3";
  const PRICES_KEY = "panelpath_prices_v3";
  const DISCLAIMER =
    "Decision support only. Confirm with AHJ and current Michigan Building Code / NFPA 72. Manufacturer calculators win on battery, voltage drop, and storage.";

  const PRINT_NOT_READABLE_MSG =
    "This isn't a usable drawing (napkin / blur / dark photo). Need a straight-on, well-lit scan or PDF export from CAD. I can't bid off this.";

  const PRE1980_FLAG =
    "Pre-1980 — confirm asbestos/lead before demo or device swap. Not a survey.";

  const DEVICE_CHECKLIST_KEYS = [
    { key: "smoke", label: "Smoke" },
    { key: "heat", label: "Heat" },
    { key: "duct", label: "Duct" },
    { key: "pull", label: "Pull" },
    { key: "horn", label: "Horn" },
    { key: "speaker", label: "Speaker" },
    { key: "strobe", label: "Strobe" },
    { key: "facp", label: "FACP" },
    { key: "annunciator", label: "Annunciator" },
    { key: "communicator", label: "Communicator" },
  ];

  const screens = {
    1: document.getElementById("screen-1"),
    2: document.getElementById("screen-2"),
    3: document.getElementById("screen-3"),
  };

  let printState = {
    fileName: "",
    fileType: "",
    objectUrl: null,
    longEdge: 0,
    qualityWarn: "",
    qualityFail: false,
    pdfAcceptedNote: false,
    notReadable: false,
    looksReadable: false,
    file: null,
  };

  let state = {
    intake: null,
    rec: null,
    devices: null,
    detectorStrategy: null,
    showHardStopOnly: false,
    hardStopKind: null,
    missingItems: [],
    showSpecCode: false,
    yellowFlag: null,
    unitCosts: {
      panel: "",
      smokes: "",
      pulls: "",
      horns: "",
      communicator: "",
      program: "",
      test: "",
      certification: "",
      lift: "",
    },
    unitCostsSpec: {},
    unitCostsCode: {},
    markup: 40,
    takeoff: { devices: [], wire: [], initialized: false },
  };

  function showScreen(n) {
    const takeoffEl = document.getElementById("screen-takeoff");
    Object.keys(screens).forEach((k) => {
      const el = screens[k];
      if (!el) return;
      const on = n !== "takeoff" && Number(k) === Number(n);
      if (on) {
        el.hidden = false;
        el.removeAttribute("hidden");
      } else {
        el.hidden = true;
        el.setAttribute("hidden", "");
      }
    });
    if (takeoffEl) {
      if (n === "takeoff") {
        takeoffEl.hidden = false;
        takeoffEl.removeAttribute("hidden");
      } else {
        takeoffEl.hidden = true;
        takeoffEl.setAttribute("hidden", "");
      }
    }
    window.scrollTo(0, 0);
  }

  function getGateValues(form) {
    const fd = new FormData(form);
    return {
      jobScale: (fd.get("jobScale") || "").toString(),
      scope: (fd.get("scope") || "").toString(),
      prints: (fd.get("prints") || "").toString(),
    };
  }

  function needsCeilingLift(jobScale, stories) {
    if (jobScale === "commercial") return true;
    if (jobScale === "residential" && (stories == null || stories >= 2)) return true;
    return false;
  }

  function updateIntakeVisibility() {
    const form = document.getElementById("intake-form");
    const gate = getGateValues(form);
    const body = document.getElementById("intake-body");
    const res = document.getElementById("residential-fields");
    const com = document.getElementById("commercial-fields");
    const ceil = document.getElementById("ceiling-lift-block");
    const printsBlock = document.getElementById("prints-upload-block");
    const devicesWrap = document.getElementById("devices-on-print-wrap");

    const gatesReady = !!(gate.jobScale && gate.scope && gate.prints);

    if (!gatesReady) {
      body.hidden = true;
      res.hidden = true;
      com.hidden = true;
      ceil.hidden = true;
      return;
    }

    body.hidden = false;
    if (gate.jobScale === "residential") {
      res.hidden = false;
      com.hidden = true;
      if (printsBlock) printsBlock.hidden = true;
    } else {
      res.hidden = true;
      com.hidden = false;
      if (printsBlock) printsBlock.hidden = gate.prints !== "have";
    }

    const jobClass = (new FormData(form).get("jobClass") || "").toString();
    if (devicesWrap) {
      const need =
        jobClass === "add-on" ||
        jobClass === "takeover" ||
        jobClass === "replacement";
      devicesWrap.hidden = !need;
    }

    let stories = 1;
    if (gate.jobScale === "residential") {
      stories = Number(form.elements.resStories && form.elements.resStories.value) || 1;
    } else {
      stories = Number(form.elements.stories && form.elements.stories.value) || 1;
    }
    ceil.hidden = !needsCeilingLift(gate.jobScale, stories);
  }

  function buildDeviceChecklistUI() {
    const box = document.getElementById("device-checklist");
    if (!box || box.dataset.built === "1") return;
    box.innerHTML = DEVICE_CHECKLIST_KEYS.map((d) => {
      return (
        '<div class="device-check-row">' +
        '<label><input type="checkbox" name="devPresent_' +
        d.key +
        '" data-dev="' +
        d.key +
        '" /> ' +
        escapeHtml(d.label) +
        "</label>" +
        '<input type="number" name="devCount_' +
        d.key +
        '" min="0" step="1" value="0" data-dev-count="' +
        d.key +
        '" aria-label="' +
        escapeAttr(d.label) +
        ' count" />' +
        "</div>"
      );
    }).join("");
    box.dataset.built = "1";
  }

  function readDeviceChecklist(form) {
    const out = {};
    let any = false;
    DEVICE_CHECKLIST_KEYS.forEach((d) => {
      const presentEl = form.elements["devPresent_" + d.key];
      const countEl = form.elements["devCount_" + d.key];
      const present = !!(presentEl && presentEl.checked);
      let count = countEl ? Number(countEl.value) : 0;
      if (!Number.isFinite(count) || count < 0) count = 0;
      if (present && count === 0) count = 1;
      if (!present) count = countEl && Number(countEl.value) > 0 ? Number(countEl.value) : 0;
      if (count > 0) any = true;
      out[d.key] = { present: present || count > 0, count: count };
    });
    return { items: out, used: any };
  }

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
    const jobClass = get("jobClass");
    const devicesOnPrint = !!(
      form.elements.devicesOnPrint && form.elements.devicesOnPrint.checked
    );

    const hazards = fd.getAll("hazard").map(String);
    const occupantLoadUnknown = !!(
      form.elements.occupantLoadUnknown &&
      form.elements.occupantLoadUnknown.checked
    );
    const yearBuiltUnknown = !!(
      form.elements.yearBuiltUnknown && form.elements.yearBuiltUnknown.checked
    );

    const checklist = readDeviceChecklist(form);

    const jobCompat =
      jobClass === "new"
        ? "new"
        : jobClass === "add-on"
          ? "add-on"
          : jobClass === "replacement"
            ? "replace"
            : jobClass || "";

    const base = {
      jobScale,
      scope,
      prints,
      jobClass,
      job: jobCompat,
      devicesOnPrint,
      existingPanel: get("existingPanel"),
      ahj: get("ahj") || "unknown",
      markup: num("markup") ?? 40,
      notes: get("notes"),
      ceilingTypical: num("ceilingTypical"),
      ceilingHighest: num("ceilingHighest"),
      ceilingType: get("ceilingType") || "unknown",
      liftRequired: get("liftRequired") || "unknown",
      deviceChecklist: checklist.items,
      deviceChecklistUsed: checklist.used,
      printFileName: printState.fileName || "",
      printFileType: printState.fileType || "",
      printLongEdge: printState.longEdge || 0,
      printQualityWarn: printState.qualityWarn || "",
      printNotReadable: !!printState.notReadable,
      printLooksReadable:
        !!(form.elements.pdfLooksReadable && form.elements.pdfLooksReadable.checked) ||
        !!printState.looksReadable,
      printHasFile: !!(printState.fileName && !printState.notReadable),
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
        occupancy: "",
        highRise75: false,
        sqFt: null,
        sprinklered: "unknown",
        occupantLoad: null,
        occupantLoadUnknown: false,
        yearBuilt: null,
        yearBuiltUnknown: true,
        hazards: [],
        hazardOtherText: "",
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
      occupantLoad: occupantLoadUnknown ? null : num("occupantLoad"),
      occupantLoadUnknown,
      yearBuilt: yearBuiltUnknown ? null : num("yearBuilt"),
      yearBuiltUnknown,
      hazards,
      hazardOtherText: get("hazardOtherText"),
      system: get("system"),
      monitoring: get("monitoring") || "unknown",
      voice: get("voice") || "unknown",
      elevators: get("elevators") || "none",
      mfrLock: get("mfrLock") || "none",
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
    if (!intake.jobClass) missing.push("Job class");

    if (intake.jobScale === "residential") {
      if (intake.bedrooms == null) missing.push("Bedrooms");
    } else if (intake.jobScale === "commercial") {
      if (!intake.occupancy) missing.push("Occupancy");
      if (!intake.system) missing.push("System");
      if (intake.prints === "have" && (intake.sqFt == null || intake.sqFt < 1)) {
        missing.push("Approx sq ft");
      }
      if (intake.hazards && intake.hazards.includes("other") && !intake.hazardOtherText) {
        missing.push("Other hazard detail");
      }
    }

    return missing;
  }

  function formLooksReadable() {
    const form = document.getElementById("intake-form");
    return !!(form.elements.pdfLooksReadable && form.elements.pdfLooksReadable.checked);
  }

  function listMissingItems(intake) {
    const items = [];

    if (intake.prints === "none") {
      items.push({
        id: "no-prints",
        label: "No prints",
        question:
          "Do you have drawings, or a simple floor sketch with the rooms labeled? I need that before the takeoff can be finished.",
      });
    }

    if (intake.jobScale === "commercial" && intake.prints === "have") {
      const fileName = printState.fileName || intake.printFileName || "";
      const hasFile = !!fileName;
      const isPdf =
        hasFile &&
        (printState.fileType === "application/pdf" || /\.pdf$/i.test(fileName));
      const pdfUnconfirmed =
        isPdf && !intake.printLooksReadable && !formLooksReadable();
      const markedUnreadable = !!(printState.notReadable || intake.printNotReadable);
      if (!hasFile || markedUnreadable || printState.qualityFail || pdfUnconfirmed) {
        let question;
        if (!hasFile) {
          question =
            "I don't have a drawing file. Can you upload a PDF or a straight-on, well-lit photo of the plan?";
        } else if (pdfUnconfirmed && !markedUnreadable && !printState.qualityFail) {
          question =
            "Can you confirm the PDF pages are readable, or send a clearer file?";
        } else {
          question =
            "I can't read the drawing you uploaded. Can you send a straight-on, well-lit scan or a PDF export from CAD?";
        }
        items.push({
          id: "unreadable-upload",
          label: "Unreadable upload",
          question: question,
        });
      }
    }

    if (
      intake.jobScale === "commercial" &&
      (intake.occupantLoadUnknown || intake.occupantLoad == null)
    ) {
      items.push({
        id: "occupant-load",
        label: "Occupant load unknown",
        question:
          "What's the occupant load? I need the number from the owner, the architect, or the posted load.",
      });
    }

    const jc = intake.jobClass;
    if (
      (jc === "add-on" || jc === "takeover" || jc === "replacement") &&
      !intake.devicesOnPrint
    ) {
      items.push({
        id: "devices-on-print",
        label: "Devices not marked on the print",
        question:
          "Can you mark the existing devices on the print — smokes, pulls, horns or speakers, the panel, and the annunciator?",
      });
    }

    if (
      intake.jobScale === "commercial" &&
      !intake.yearBuiltUnknown &&
      intake.yearBuilt == null
    ) {
      items.push({
        id: "year-built",
        label: "Year built blank",
        question: "What year was the building built?",
      });
    }

    if (
      intake.jobScale === "commercial" &&
      (!intake.hazards || !intake.hazards.length)
    ) {
      items.push({
        id: "hazards",
        label: "Hazards blank",
        question:
          "What hazards should I plan for — asbestos, lead, something else, or none known?",
      });
    }

    if (needsCeilingLift(intake.jobScale, intake.stories)) {
      if (intake.ceilingTypical == null || intake.ceilingTypical <= 0) {
        items.push({
          id: "ceiling-height",
          label: "Ceiling height blank",
          question: "What's the typical finished ceiling height, in feet?",
        });
      }
      if (!intake.liftRequired || intake.liftRequired === "unknown") {
        items.push({
          id: "lift",
          label: "Lift not answered",
          question:
            "Will the crew need a lift to reach the devices, or will a ladder do?",
        });
      }
    }

    return items;
  }

  function fillForm(intake) {
    if (!intake) return;
    const form = document.getElementById("intake-form");
    const setRadio = (name, val) => {
      if (val == null || val === "") return;
      const el = form.querySelector(
        'input[name="' + name + '"][value="' + CSS.escape(String(val)) + '"]'
      );
      if (el) el.checked = true;
    };
    setRadio("jobScale", intake.jobScale);
    setRadio("scope", intake.scope);
    setRadio("prints", intake.prints);
    setRadio("jobClass", intake.jobClass || intake.job);
    if (form.elements.devicesOnPrint) {
      form.elements.devicesOnPrint.checked = !!intake.devicesOnPrint;
    }
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
      if (form.elements.occupantLoadUnknown) {
        form.elements.occupantLoadUnknown.checked = !!intake.occupantLoadUnknown;
      }
      form.elements.occupantLoad.value =
        intake.occupantLoad != null ? intake.occupantLoad : "";
      if (intake.occupantLoadUnknown) form.elements.occupantLoad.disabled = true;
      if (form.elements.yearBuiltUnknown) {
        form.elements.yearBuiltUnknown.checked = !!intake.yearBuiltUnknown;
      }
      if (form.elements.yearBuilt) {
        form.elements.yearBuilt.value =
          intake.yearBuilt != null ? intake.yearBuilt : "";
        if (intake.yearBuiltUnknown) form.elements.yearBuilt.disabled = true;
      }
      form.querySelectorAll('input[name="hazard"]').forEach((cb) => {
        cb.checked = !!(intake.hazards && intake.hazards.includes(cb.value));
      });
      if (form.elements.hazardOtherText) {
        form.elements.hazardOtherText.value = intake.hazardOtherText || "";
      }
      toggleHazardOther();
      setRadio("system", intake.system);
      setRadio("monitoring", intake.monitoring || "unknown");
      setRadio("voice", intake.voice || "unknown");
      setRadio("elevators", intake.elevators || "none");
      setRadio("mfrLock", intake.mfrLock || "none");

      if (intake.deviceChecklist) {
        buildDeviceChecklistUI();
        DEVICE_CHECKLIST_KEYS.forEach((d) => {
          const item = intake.deviceChecklist[d.key];
          if (!item) return;
          const p = form.elements["devPresent_" + d.key];
          const c = form.elements["devCount_" + d.key];
          if (p) p.checked = !!item.present;
          if (c) c.value = item.count != null ? item.count : 0;
        });
      }
    }

    if (form.elements.ceilingTypical) {
      form.elements.ceilingTypical.value =
        intake.ceilingTypical != null ? intake.ceilingTypical : "";
    }
    if (form.elements.ceilingHighest) {
      form.elements.ceilingHighest.value =
        intake.ceilingHighest != null ? intake.ceilingHighest : "";
    }
    setRadio("ceilingType", intake.ceilingType || "unknown");
    setRadio("liftRequired", intake.liftRequired || "unknown");

    form.elements.markup.value = intake.markup ?? 40;
    form.elements.notes.value = intake.notes || "";
    updateIntakeVisibility();
  }

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
    return " lock: " + intake.mfrLock + " — prefer matching class";
  }

  function recommend(intake) {
    const h = buildHeuristics(intake);
    const lock = lockNote(intake);
    let A, B, C;

    if (h.rule === 3) {
      A = { label: "NFS-640 / voice class", tag: "likely", why: "Voice or high-rise / large assembly path." + lock };
      B = { label: "NFS-3030 / voice class", tag: "check AHJ", why: "Larger networked / campus voice when AHJ or scale demands it." + lock };
      C = { label: "Do not bid horn-only / do not bid Vista-20P", tag: "check AHJ", why: "Horn-only or 20P-class is the wrong bid on this path." };
    } else if (h.rule === 2) {
      A = { label: "FireWarden / NFS-320 class", tag: "likely", why: "Fire, small commercial, not high-rise / big assembly." + lock };
      B = { label: "NFS-640 class", tag: "check AHJ", why: "Step-up capacity or denser device count." + lock };
      if (h.includesFire) {
        C = { label: "NFS-320 + expanders / check manufacturer lock", tag: "check AHJ", why: "Stay in addressable fire; expand rather than down-bid." + lock };
      } else {
        C = { label: "Vista class (fire not required)", tag: "check AHJ", why: "Burg-only fallback — confirm fire is truly not required." + lock };
      }
    } else {
      A = { label: "Vista-20P class", tag: "likely", why: "Burg or small combo; not voice; not high-rise." + lock };
      B = { label: "Vista-128 class", tag: "check AHJ", why: "More zones / points or commercial burg scale." + lock };
      if (h.includesFire) {
        C = { label: "Small addressable fire class", tag: "check AHJ", why: "Fire also selected — consider a small addressable FACP." + lock };
      } else {
        C = { label: "Add fire panel later / confirm AHJ", tag: "check AHJ", why: "Burg-only today — confirm whether fire is deferred or not required." };
      }
    }

    return Object.assign({}, h, { options: { A: A, B: B, C: C } });
  }

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

  function devicesFromChecklist(intake, heuristics) {
    const c = intake.deviceChecklist || {};
    const n = (k) => (c[k] && c[k].count) || 0;
    const smokes = n("smoke") + n("heat") + n("duct");
    const pulls = n("pull");
    const horns = n("horn") + n("speaker") + n("strobe");
    const facp = n("facp");
    const communicator = n("communicator");
    const annunciator = n("annunciator");
    return {
      panel: facp > 0 ? facp : 1,
      smokes: smokes,
      pulls: pulls,
      horns: horns,
      communicator: communicator,
      annunciator: annunciator,
      heat: n("heat"),
      duct: n("duct"),
      speaker: n("speaker"),
      strobe: n("strobe"),
      checklistOnly: false,
      fromChecklist: true,
    };
  }

  function estimateDevices(intake, heuristics) {
    if (intake.jobScale === "commercial" && intake.deviceChecklistUsed) {
      return devicesFromChecklist(intake, heuristics);
    }

    if (intake.jobScale === "residential") {
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
      smokes: smokes,
      pulls: pulls,
      horns: horns,
      communicator: communicator,
      checklistOnly: false,
      fromChecklist: false,
    };
  }

  function effectiveHighestCeiling(intake) {
    if (intake.ceilingHighest != null && intake.ceilingHighest > 0) {
      return intake.ceilingHighest;
    }
    return intake.ceilingTypical;
  }

  function liftBudgetFlag(intake) {
    if (intake.liftRequired !== "unknown") return false;
    const h = effectiveHighestCeiling(intake);
    return h != null && h >= 12;
  }

  function renderMissingItems(items) {
    const card = document.getElementById("hard-stop");
    const main = document.getElementById("results-main");
    const list = document.getElementById("missing-items");
    const copyWrap = document.getElementById("hard-stop-copy-wrap");
    const ta = document.getElementById("hard-stop-msg");
    if (main) main.hidden = false;
    if (!items || !items.length) {
      if (card) card.hidden = true;
      if (list) list.innerHTML = "";
      if (ta) ta.value = "";
      return;
    }
    card.hidden = false;
    document.getElementById("hard-stop-title").textContent =
      "Incomplete — questions back to the rep";
    document.getElementById("hard-stop-body").textContent =
      "This job stays open. Panel path and takeoff stay available, marked incomplete until these answers are filled in on Intake.";
    if (list) {
      list.innerHTML = items
        .map(function (item) {
          return (
            "<li><strong>" +
            escapeHtml(item.label) +
            '</strong><span class="missing-q">' +
            escapeHtml(item.question) +
            "</span></li>"
          );
        })
        .join("");
    }
    if (copyWrap) copyWrap.hidden = false;
    if (ta) {
      ta.value = items
        .map(function (item) {
          return item.question;
        })
        .join("\n\n");
    }
  }

  function markIncomplete(on) {
    const panelNote = document.getElementById("panel-incomplete");
    const takeoffNote = document.getElementById("takeoff-incomplete");
    if (panelNote) panelNote.hidden = !on;
    if (takeoffNote) takeoffNote.hidden = !on;
  }

  function renderYellowFlag(text) {
    const el = document.getElementById("yellow-flag");
    if (!text) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    document.getElementById("yellow-flag-body").textContent = text;
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
    if (intake.printQualityWarn) add("print quality warn", "warn");
    if (intake.printNotReadable) add("print not readable", "alert");

    const typical = intake.ceilingTypical;
    const highest = effectiveHighestCeiling(intake);
    if (typical != null && typical >= 10) {
      add("verify smoke spacing and candela — table spacing changes with height", "warn");
    }
    if (
      (typical != null && typical >= 25) ||
      (highest != null && highest >= 25) ||
      intake.ceilingType === "warehouse-deck"
    ) {
      add("this is not a 6-ft ladder job", "alert");
    }
    if (liftBudgetFlag(intake)) {
      add("budget a lift until they prove a ladder works", "warn");
    }
    if (intake.liftRequired === "yes") add("lift required", "warn");

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

    byOthers.hidden = intake.scope !== "check-and-test";

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
        '<p class="hint">No sq-ft ESTIMATE counts as bid quantities without a floor plan.</p><ul>' +
        items.map((t) => "<li>" + escapeHtml(t) + "</li>").join("") +
        "</ul>";
      return;
    }

    checklist.hidden = true;
    checklist.innerHTML = "";
    ul.hidden = false;
    estLabel.textContent = devices.fromChecklist
      ? "FROM PRINT CHECKLIST"
      : "ESTIMATE";
    const rows = [
      ["Smokes", devices.smokes],
      ["Pulls", devices.pulls],
      ["Horns / Speakers / Strobes", devices.horns],
      ["Communicator", devices.communicator],
    ];
    if (devices.annunciator) rows.push(["Annunciator", devices.annunciator]);
    const suffix = devices.fromChecklist
      ? " (from print checklist)"
      : intake.scope === "check-and-test"
        ? " (ESTIMATE — devices by others)"
        : " (ESTIMATE)";
    ul.innerHTML = rows
      .map(
        ([lbl, qty]) =>
          '<li><span class="qty">' +
          qty +
          '</span><span class="lbl">' +
          escapeHtml(lbl) +
          escapeHtml(suffix) +
          "</span></li>"
      )
      .join("");
  }

  function priceRowsFor(intake, devices) {
    const liftRow = {
      key: "lift",
      label: "Lift / scissor / boom — enter daily rate",
      qty: 1,
    };
    if (intake.scope === "check-and-test") {
      const rows = [
        { key: "program", label: "Program", qty: 1 },
        { key: "test", label: "Test", qty: 1 },
        { key: "certification", label: "Certification", qty: 1 },
      ];
      if (intake.liftRequired === "yes") rows.push(liftRow);
      return rows;
    }
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
      if (intake.liftRequired === "yes") rows.push(liftRow);
      return rows;
    }
    const rows = [
      { key: "panel", label: "Panel", qty: devices.panel },
      { key: "smokes", label: "Smokes", qty: devices.smokes },
      { key: "pulls", label: "Pulls", qty: devices.pulls },
      { key: "horns", label: "Horns/Speakers", qty: devices.horns },
      { key: "communicator", label: "Communicator", qty: devices.communicator },
    ];
    if (intake.liftRequired === "yes") rows.push(liftRow);
    return rows;
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
        "Check-and-test: labor rows only (Program / Test / Certification). Device install by others. Unit $ empty." +
        (intake.liftRequired === "yes"
          ? " Lift line added — enter daily rate (no invented rental price)."
          : "");
    } else {
      hint.textContent =
        "Unit costs stay empty — you fill them. No list prices invented." +
        (intake.liftRequired === "yes"
          ? " Lift line added — enter daily rate."
          : "");
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
      fillPriceBody(document.getElementById("price-body-spec"), rows, state.unitCostsSpec, "spec");
      fillPriceBody(document.getElementById("price-body-code"), rows, state.unitCostsCode, "code");
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
      recalcOne("#price-body-spec", "markup-live-spec", "price-total-spec", "spec");
      recalcOne("#price-body-code", "markup-live-code", "price-total-code", "code");
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
      const extCell = document.querySelector('[data-ext="' + CSS.escape(rawKey) + '"]');
      if (extCell) extCell.textContent = formatMoney(ext);
    });
    document.getElementById(totalId).textContent = formatMoney(total);
  }

  function labelMap(key, val) {
    const maps = {
      jobScale: { residential: "Residential", commercial: "Commercial" },
      scope: {
        turnkey: "Turnkey (wire + devices + program)",
        "check-and-test": "Check-and-test only",
      },
      prints: { have: "I have drawings", none: "I do not have drawings" },
      jobClass: {
        new: "New system",
        "add-on": "Add-on to existing",
        takeover: "Takeover of existing",
        replacement: "Replacement",
      },
      job: { new: "New", replace: "Replace", "add-on": "Add-on" },
      ahj: {
        city: "City",
        township: "Township",
        "state-fire": "State fire",
        unknown: "Unknown",
      },
      sprinklered: { yes: "Yes", no: "No", partial: "Partial", unknown: "Unknown" },
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
      ceilingType: {
        drywall: "Drywall",
        "drop-tile": "Drop-tile",
        "open-joist": "Open joist",
        "warehouse-deck": "Warehouse deck",
        unknown: "Unknown",
      },
      liftRequired: { yes: "Yes", no: "No", unknown: "Unknown" },
    };
    if (maps[key] && maps[key][val] != null) return maps[key][val];
    if (val === "" || val == null) return "—";
    return String(val);
  }

  function hazardSummary(intake) {
    if (!intake.hazards || !intake.hazards.length) return "—";
    const labels = {
      asbestos: "Asbestos suspected",
      lead: "Lead paint or lead components",
      other: "Other" + (intake.hazardOtherText ? ": " + intake.hazardOtherText : ""),
      none: "None known",
    };
    return intake.hazards.map((h) => labels[h] || h).join("; ");
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
      ["Job class", labelMap("jobClass", intake.jobClass)],
      [
        "Devices marked on print",
        intake.devicesOnPrint ? "Yes" : intake.jobClass === "new" ? "n/a" : "No",
      ],
      ["Existing panel", intake.existingPanel || "—"],
      ["AHJ", labelMap("ahj", intake.ahj)],
    ];

    if (intake.jobScale === "residential") {
      intakeRows.push(
        ["Stories", String(intake.stories)],
        ["Bedrooms", String(intake.bedrooms)],
        ["Basement", labelMap("basement", intake.basement)],
        ["Existing detectors", labelMap("existingDetectors", intake.existingDetectors)],
        ["Interconnected", labelMap("interconnected", intake.interconnected)],
        ["Power / backup", labelMap("detectorPower", intake.detectorPower)],
        ["CO required", labelMap("coRequired", intake.coRequired)],
        ["Control panel system", labelMap("system", intake.resSystem || intake.system)]
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
          intake.occupantLoadUnknown
            ? "Unknown"
            : intake.occupantLoad != null
              ? String(intake.occupantLoad)
              : "—",
        ],
        [
          "Year built",
          intake.yearBuiltUnknown
            ? "Unknown"
            : intake.yearBuilt != null
              ? String(intake.yearBuilt)
              : "—",
        ],
        ["Hazards", hazardSummary(intake)],
        ["System", labelMap("system", intake.system)],
        ["Monitoring", labelMap("monitoring", intake.monitoring)],
        ["Voice evac", labelMap("voice", intake.voice)],
        ["Elevators", labelMap("elevators", intake.elevators)],
        ["Manufacturer lock", intake.mfrLock || "none"]
      );
    }

    if (needsCeilingLift(intake.jobScale, intake.stories)) {
      intakeRows.push(
        ["Typical ceiling (ft)", intake.ceilingTypical != null ? String(intake.ceilingTypical) : "—"],
        ["Highest ceiling (ft)", intake.ceilingHighest != null ? String(intake.ceilingHighest) : "—"],
        ["Ceiling type", labelMap("ceilingType", intake.ceilingType)],
        ["Lift required", labelMap("liftRequired", intake.liftRequired)]
      );
    }

    if (intake.prints === "have" && intake.jobScale === "commercial") {
      intakeRows.push(
        ["Print file", intake.printFileName || "(none)"],
        [
          "Print readable",
          intake.printNotReadable
            ? "NOT readable"
            : intake.printLooksReadable || printState.fileType !== "application/pdf"
              ? "Accepted / readable"
              : "Pending confirm",
        ]
      );
      if (intake.deviceChecklistUsed) {
        const parts = DEVICE_CHECKLIST_KEYS.map((d) => {
          const it = intake.deviceChecklist[d.key];
          if (!it || !it.count) return null;
          return d.label + ": " + it.count;
        }).filter(Boolean);
        intakeRows.push(["Print checklist counts", parts.join(", ") || "—"]);
      }
    }

    intakeRows.push(["Rep markup %", String(state.markup)], ["Notes", intake.notes || "—"]);

    let html = "<h4>Intake</h4><dl>";
    intakeRows.forEach(([k, v]) => {
      html += "<dt>" + escapeHtml(k) + "</dt><dd>" + escapeHtml(v) + "</dd>";
    });
    html += "</dl>";

    if (state.yellowFlag) {
      html += "<h4>Hazard flag</h4><p>" + escapeHtml(state.yellowFlag) + "</p>";
    }

    if (state.missingItems && state.missingItems.length) {
      html += "<h4>Incomplete — questions back to the rep</h4><ul>";
      state.missingItems.forEach(function (item) {
        html +=
          "<li><strong>" +
          escapeHtml(item.label) +
          "</strong> — " +
          escapeHtml(item.question) +
          "</li>";
      });
      html +=
        "</ul><p>Panel path and takeoff are incomplete until these answers are filled in on Intake.</p>";
    }

    if (state.detectorStrategy) {
      html +=
        '<h4>Detector strategy <span class="est-label">ESTIMATE / confirm with AHJ and Michigan residential rules</span></h4>';
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
        '<h4>Spec vs code</h4><div class="two-col summary-cols"><div><strong>Spec path</strong><ul><li>Follow drawings / horns as drawn</li><li>Bid notification as drawn</li></ul></div><div><strong>Code-corrected path</strong><ul><li>Voice / evac per MI / IBC</li><li>Align with rule 3 when voice / high-rise / large assembly</li></ul></div></div>';
    }

    html += "<h4>Flags</h4><ul>";
    html += "<li>confirm AHJ</li>";
    if (intake.prints === "none") html += "<li>no prints</li>";
    if (rec && rec.voiceLikely) html += "<li>voice likely</li>";
    if (rec && rec.highRise) html += "<li>high-rise</li>";
    if (rec && rec.rule === 3) html += "<li>don't sell 20P</li>";
    if (rec && rec.needsSpecCode) html += "<li>Spec vs code</li>";
    if (intake.ceilingTypical != null && intake.ceilingTypical >= 10) {
      html += "<li>verify smoke spacing and candela — table spacing changes with height</li>";
    }
    const hi = effectiveHighestCeiling(intake);
    if (
      (intake.ceilingTypical != null && intake.ceilingTypical >= 25) ||
      (hi != null && hi >= 25) ||
      intake.ceilingType === "warehouse-deck"
    ) {
      html += "<li>this is not a 6-ft ladder job</li>";
    }
    if (liftBudgetFlag(intake)) {
      html += "<li>budget a lift until they prove a ladder works</li>";
    }
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
          '<h4>Device counts <span class="est-label">' +
          (devices.fromChecklist ? "FROM PRINT CHECKLIST" : "ESTIMATE") +
          "</span></h4><ul>" +
          "<li>Panel: " +
          devices.panel +
          "</li><li>Smokes: " +
          devices.smokes +
          "</li><li>Pulls: " +
          devices.pulls +
          "</li><li>Horns/Speakers: " +
          devices.horns +
          "</li><li>Communicator: " +
          devices.communicator +
          "</li></ul>";
        if (intake.scope === "check-and-test") {
          html += "<p><em>Devices by others (electrician) — check-and-test scope.</em></p>";
        }
      }
    }

    html +=
      "<h4>Labor framing</h4><p>" +
      (intake.scope === "check-and-test"
        ? "Program + Test + Certification only (no device install hours)."
        : "Turnkey: device + panel rows (or labor if residential checklist).") +
      (intake.liftRequired === "yes"
        ? " Lift / scissor / boom line included — enter daily rate."
        : "") +
      "</p>";

    const rows = priceRowsFor(intake, devices || { panel: 0, checklistOnly: true });
    const m = state.markup;
    let total = 0;
    html +=
      "<h4>Price table</h4><p>Markup " +
      escapeHtml(String(m)) +
      '%</p><table><thead><tr><th>Item</th><th>Qty</th><th>Unit $</th><th>Extended</th></tr></thead><tbody>';
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

    html += takeoffSummaryHtml();

    body.innerHTML = html;
  }

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
    return true;
  }

  function pre1980YellowFlag(intake) {
    if (intake.jobScale !== "commercial") return null;
    if (intake.yearBuiltUnknown || intake.yearBuilt == null) return null;
    if (intake.yearBuilt >= 1980) return null;
    if (intake.hazards && intake.hazards.includes("none")) {
      return PRE1980_FLAG;
    }
    return null;
  }

  function goResults() {
    const intake = state.intake;
    state.showHardStopOnly = false;
    state.hardStopKind = null;
    state.showSpecCode = false;
    state.detectorStrategy = null;
    state.rec = null;
    state.devices = null;
    state.yellowFlag = null;

    intake.printNotReadable = !!printState.notReadable;
    intake.printQualityWarn = printState.qualityWarn || "";
    intake.printFileName = printState.fileName || intake.printFileName || "";
    intake.printLooksReadable = formLooksReadable() || !!printState.looksReadable;

    const missing = listMissingItems(intake);
    state.missingItems = missing;

    const showPanel = shouldShowPanelOptions(intake);
    let rec = null;
    if (showPanel) {
      rec = recommend(intake);
      state.rec = rec;
    } else if (intake.jobScale === "commercial") {
      rec = recommend(intake);
      state.rec = rec;
    } else {
      rec = buildHeuristics(intake);
      state.rec = Object.assign({ options: null }, rec);
    }

    if (intake.jobScale === "residential") {
      state.detectorStrategy = detectorStrategy(intake);
    }

    state.showSpecCode = !!(rec && rec.needsSpecCode);
    const devices = estimateDevices(intake, rec || buildHeuristics(intake));
    state.devices = devices;
    state.markup = intake.markup ?? 40;

    state.yellowFlag = pre1980YellowFlag(intake);
    renderYellowFlag(state.yellowFlag);
    renderMissingItems(missing);
    markIncomplete(missing.length > 0);

    renderFlags(state.rec || buildHeuristics(intake), intake);

    const detBlock = document.getElementById("detector-strategy-block");
    const panelBlock = document.getElementById("panel-options-block");
    const specBlock = document.getElementById("spec-code-block");

    if (state.detectorStrategy) {
      detBlock.hidden = false;
      renderOptionCards(document.getElementById("detector-options"), state.detectorStrategy);
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

    specBlock.hidden = !state.showSpecCode;

    renderDevices(intake, devices);
    renderPriceTable(intake, devices, state.markup, state.unitCosts);
    showScreen(2);
  }

  /* ---------- TAKEOFF ---------- */
  const TAKEOFF_KEY = "panelpath_takeoff_v1";
  const SUPPLIERS = ["ADI", "Grainger", "Windy City Wire", "other"];
  const WIRE_TYPES = [
    "18/4 CL2/FPL (keypad / burg zones)",
    "18/2 FPLR or FPLP (smokes, 2-wire)",
    "16/2 FPLR / FPLP (notification)",
    "14/2 FPLP (long NAC / speaker)",
    "22/4",
    "22/2",
    "Other",
  ];

  const STARTER_CATALOG = [
    { id: "vista-20p", desc: "Vista-20P panel", mfr: "Honeywell", part: "VISTA-20P", supplier: "ADI" },
    { id: "6160", desc: "Vista-20P keypad alpha 6160", mfr: "Honeywell", part: "6160", supplier: "ADI" },
    { id: "6160rf", desc: "Vista keypad wireless 6160RF", mfr: "Honeywell", part: "6160RF", supplier: "ADI" },
    { id: "6160v", desc: "Vista keypad 6160V (voice)", mfr: "Honeywell", part: "6160V", supplier: "ADI", note: "Prefer when voice likely" },
    { id: "smoke", desc: "Smoke detector (generic)", mfr: "", part: "", supplier: "ADI" },
    { id: "heat", desc: "Heat detector (generic)", mfr: "", part: "", supplier: "ADI" },
    { id: "pull", desc: "Pull station (generic)", mfr: "", part: "", supplier: "ADI" },
    { id: "horn", desc: "Horn (generic)", mfr: "", part: "", supplier: "ADI" },
    { id: "speaker-strobe", desc: "Speaker-strobe (generic)", mfr: "", part: "", supplier: "ADI" },
    { id: "facp", desc: "FACP (generic)", mfr: "", part: "", supplier: "ADI" },
    { id: "communicator", desc: "Communicator (generic)", mfr: "", part: "", supplier: "ADI" },
  ];

  const MARKUP_STYLE = {
    "vista-20p": { abbr: "VP", color: "#f5c518" },
    "6160": { abbr: "KP", color: "#6bcf7f" },
    "6160rf": { abbr: "RF", color: "#3dba8b" },
    "6160v": { abbr: "KV", color: "#8fd9a0" },
    smoke: { abbr: "S", color: "#5dade2" },
    heat: { abbr: "H", color: "#e67e22" },
    pull: { abbr: "PL", color: "#e74c3c" },
    horn: { abbr: "HN", color: "#9b59b6" },
    "speaker-strobe": { abbr: "SS", color: "#1abc9c" },
    facp: { abbr: "FC", color: "#f1c40f" },
    communicator: { abbr: "CM", color: "#f39c12" },
  };

  const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const printMarkup = {
    loadedKey: "",
    fileName: "",
    kind: "",
    bytes: null,
    imageType: "",
    pdfDoc: null,
    pageImage: null,
    pageCount: 0,
    pageIndex: 0,
    markups: [],
    selectedId: null,
    activeCatalogId: "smoke",
    renderToken: 0,
  };

  function persistTakeoff() {
    try { sessionStorage.setItem(TAKEOFF_KEY, JSON.stringify(state.takeoff)); } catch (_) {}
  }

  function suggestKeypadPart(intake, rec) {
    if (rec && rec.voiceLikely) return "6160v";
    return "6160";
  }

  function initTakeoffFromEstimates() {
    if (!state.intake) return;
    if (state.takeoff && state.takeoff.initialized && (state.takeoff.devices.length || state.takeoff.wire.length)) {
      return;
    }
    const intake = state.intake;
    const devices = state.devices || {};
    const rec = state.rec;
    const rows = [];

    function push(catId, qty) {
      if (!qty || qty <= 0) return;
      const cat = STARTER_CATALOG.find(function (c) { return c.id === catId; }) || {
        id: catId, desc: catId, mfr: "", part: "", supplier: "ADI"
      };
      rows.push({
        qty: qty,
        description: cat.desc,
        manufacturer: cat.mfr,
        partNumber: cat.part,
        supplier: cat.supplier,
        unitCost: "",
        catalogId: cat.id,
      });
    }

    if (devices.panel) {
      if (intake.jobScale === "residential" || (rec && rec.rule === 1)) {
        push("vista-20p", devices.panel);
        push(suggestKeypadPart(intake, rec), 1);
      } else {
        push("facp", devices.panel);
      }
    }
    if (devices.fromChecklist && intake.deviceChecklist) {
      const c = intake.deviceChecklist;
      function n(k) { return (c[k] && c[k].count) || 0; }
      push("smoke", n("smoke"));
      push("heat", n("heat"));
      push("pull", n("pull"));
      push("horn", n("horn"));
      if (n("speaker") || n("strobe")) push("speaker-strobe", n("speaker") + n("strobe"));
      push("communicator", n("communicator"));
    } else if (!devices.checklistOnly) {
      push("smoke", devices.smokes);
      push("pull", devices.pulls);
      push("horn", devices.horns);
      push("communicator", devices.communicator);
    }

    state.takeoff = {
      devices: rows,
      wire: [{
        runs: 0,
        wireType: WIRE_TYPES[0],
        productCode: "",
        supplier: "Windy City Wire",
        lengthFt: 0,
        wastePct: 10,
        unitCost: "",
        otherType: "",
      }],
      initialized: true,
    };
    persistTakeoff();
  }

  function billFeet(row) {
    const len = Number(row.lengthFt) || 0;
    const waste = Number(row.wastePct);
    const w = Number.isFinite(waste) ? waste : 10;
    return len * (1 + w / 100);
  }

  function extWithMarkup(qty, unit, markup) {
    const q = Number(qty) || 0;
    const u = unit === "" || unit == null ? NaN : Number(unit);
    const m = Number(markup) || 0;
    if (!Number.isFinite(u) || u < 0) return 0;
    return q * u * (1 + m / 100);
  }

  function syncTakeoffFromDom() {
    const tbody = document.getElementById("takeoff-device-body");
    const wbody = document.getElementById("takeoff-wire-body");
    if (!tbody || !wbody) return;
    const devices = [];
    tbody.querySelectorAll("tr[data-idx]").forEach(function (tr) {
      devices.push({
        qty: Number(tr.querySelector('[data-f="qty"]').value) || 0,
        description: tr.querySelector('[data-f="description"]').value || "",
        manufacturer: tr.querySelector('[data-f="manufacturer"]').value || "",
        partNumber: tr.querySelector('[data-f="partNumber"]').value || "",
        supplier: tr.querySelector('[data-f="supplier"]').value || "ADI",
        unitCost: tr.querySelector('[data-f="unitCost"]').value,
        catalogId: tr.getAttribute("data-cat") || "",
        fromMarkup: tr.getAttribute("data-from-markup") === "1",
      });
    });
    const wire = [];
    wbody.querySelectorAll("tr[data-idx]").forEach(function (tr) {
      const otherEl = tr.querySelector('[data-f="otherType"]');
      wire.push({
        runs: Number(tr.querySelector('[data-f="runs"]').value) || 0,
        wireType: tr.querySelector('[data-f="wireType"]').value || "",
        otherType: otherEl ? otherEl.value || "" : "",
        productCode: tr.querySelector('[data-f="productCode"]').value || "",
        supplier: tr.querySelector('[data-f="supplier"]').value || "Windy City Wire",
        lengthFt: Number(tr.querySelector('[data-f="lengthFt"]').value) || 0,
        wastePct: Number(tr.querySelector('[data-f="wastePct"]').value),
        unitCost: tr.querySelector('[data-f="unitCost"]').value,
      });
    });
    state.takeoff.devices = devices;
    state.takeoff.wire = wire;
    state.takeoff.initialized = true;
    persistTakeoff();
    updateTakeoffFlags();
    updateTakeoffTotals();
  }

  function optionList(values, selected) {
    return values.map(function (s) {
      return "<option value=\"" + escapeAttr(s) + "\"" + (s === selected ? " selected" : "") + ">" + escapeHtml(s) + "</option>";
    }).join("");
  }

  function renderTakeoff() {
    const intake = state.intake;
    const markup = state.markup || 40;
    const mEl = document.getElementById("takeoff-markup");
    if (mEl) mEl.value = markup;

    const c2t = intake && intake.scope === "check-and-test";
    const wireNote = document.getElementById("takeoff-wire-note");
    if (wireNote) {
      wireNote.textContent = c2t
        ? "Check-and-test: wire lines optional — electrician furnish. Our labor stays program/test on Results."
        : "Wire feet are typed here. Measure on the print (Bluebeam or a scale). Symbols on the print do not calculate feet.";
    }
    const wireLabel = document.getElementById("takeoff-wire-heading");
    if (wireLabel) {
      wireLabel.textContent = c2t ? "Wire lines (electrician furnish)" : "Wire lines";
    }

    const guidance = document.getElementById("takeoff-keypad-guidance");
    if (guidance) {
      if (state.rec && state.rec.voiceLikely) {
        guidance.hidden = false;
        guidance.textContent = "Voice likely — prefer 6160V (voice) keypad over 6160 when using Vista class.";
      } else {
        guidance.hidden = true;
      }
    }

    const tbody = document.getElementById("takeoff-device-body");
    tbody.innerHTML = "";
    (state.takeoff.devices || []).forEach(function (row, idx) {
      const tr = document.createElement("tr");
      tr.setAttribute("data-idx", String(idx));
      if (row.catalogId) tr.setAttribute("data-cat", row.catalogId);
      if (row.fromMarkup) tr.setAttribute("data-from-markup", "1");
      const ext = extWithMarkup(row.qty, row.unitCost, markup);
      const unitVal = row.unitCost === "" || row.unitCost == null ? "" : row.unitCost;
      const qtyAttrs = row.fromMarkup
        ? " readonly class=\"qty-locked\" title=\"Qty follows symbols placed on the print\""
        : "";
      const delTitle = row.fromMarkup ? " title=\"Remove this line and its symbols\"" : "";
      tr.innerHTML =
        "<td><input type=\"number\" min=\"0\" step=\"1\" data-f=\"qty\" value=\"" + escapeAttr(row.qty) + "\"" + qtyAttrs + " />" +
        (row.fromMarkup ? "<span class=\"from-print\">from print</span>" : "") + "</td>" +
        "<td><input type=\"text\" data-f=\"description\" value=\"" + escapeAttr(row.description) + "\" /></td>" +
        "<td><input type=\"text\" data-f=\"manufacturer\" value=\"" + escapeAttr(row.manufacturer) + "\" /></td>" +
        "<td><input type=\"text\" data-f=\"partNumber\" value=\"" + escapeAttr(row.partNumber) + "\" placeholder=\"rep edits\" /></td>" +
        "<td><select data-f=\"supplier\">" + optionList(SUPPLIERS, row.supplier || "ADI") + "</select></td>" +
        "<td><input type=\"number\" min=\"0\" step=\"0.01\" data-f=\"unitCost\" placeholder=\"—\" value=\"" + escapeAttr(unitVal) + "\" /></td>" +
        "<td class=\"ext\" data-ext-dev=\"" + idx + "\">" + formatMoney(ext) + "</td>" +
        "<td><button type=\"button\" class=\"btn btn-ghost btn-tiny\" data-del-dev=\"" + idx + "\"" + delTitle + ">X</button></td>";
      tbody.appendChild(tr);
    });

    const wbody = document.getElementById("takeoff-wire-body");
    wbody.innerHTML = "";
    (state.takeoff.wire || []).forEach(function (row, idx) {
      const tr = document.createElement("tr");
      tr.setAttribute("data-idx", String(idx));
      const bf = billFeet(row);
      const ext = extWithMarkup(bf, row.unitCost, markup);
      const unitVal = row.unitCost === "" || row.unitCost == null ? "" : row.unitCost;
      const otherHidden = row.wireType === "Other" ? "" : " hidden";
      tr.innerHTML =
        "<td><input type=\"number\" min=\"0\" step=\"1\" data-f=\"runs\" value=\"" + escapeAttr(row.runs) + "\" /></td>" +
        "<td><select data-f=\"wireType\">" + optionList(WIRE_TYPES, row.wireType || WIRE_TYPES[0]) + "</select>" +
        "<input type=\"text\" data-f=\"otherType\" placeholder=\"Other type…\" value=\"" + escapeAttr(row.otherType || "") + "\"" + otherHidden + " class=\"other-type\" /></td>" +
        "<td><input type=\"text\" data-f=\"productCode\" value=\"" + escapeAttr(row.productCode || "") + "\" /></td>" +
        "<td><select data-f=\"supplier\">" + optionList(SUPPLIERS, row.supplier || "Windy City Wire") + "</select></td>" +
        "<td><input type=\"number\" min=\"0\" step=\"1\" data-f=\"lengthFt\" value=\"" + escapeAttr(row.lengthFt) + "\" /></td>" +
        "<td><input type=\"number\" min=\"0\" step=\"1\" data-f=\"wastePct\" value=\"" + escapeAttr(Number.isFinite(row.wastePct) ? row.wastePct : 10) + "\" /></td>" +
        "<td class=\"bill-ft\" data-bill=\"" + idx + "\">" + (Math.round(bf * 10) / 10) + "</td>" +
        "<td><input type=\"number\" min=\"0\" step=\"0.01\" data-f=\"unitCost\" placeholder=\"—\" value=\"" + escapeAttr(unitVal) + "\" /></td>" +
        "<td class=\"ext\" data-ext-wire=\"" + idx + "\">" + formatMoney(ext) + "</td>" +
        "<td><button type=\"button\" class=\"btn btn-ghost btn-tiny\" data-del-wire=\"" + idx + "\">X</button></td>";
      wbody.appendChild(tr);
    });

    updateTakeoffFlags();
    updateTakeoffTotals();
    renderCatalogList("");
    markIncomplete(!!(state.missingItems && state.missingItems.length));
  }

  function updateTakeoffTotals() {
    const markupEl = document.getElementById("takeoff-markup");
    const markup = markupEl ? Number(markupEl.value) : state.markup;
    const m = Number.isFinite(markup) ? markup : state.markup || 0;
    state.markup = m;
    let dTotal = 0;
    let wTotal = 0;
    (state.takeoff.devices || []).forEach(function (row, idx) {
      const ext = extWithMarkup(row.qty, row.unitCost, m);
      dTotal += ext;
      const cell = document.querySelector('[data-ext-dev="' + idx + '"]');
      if (cell) cell.textContent = formatMoney(ext);
    });
    (state.takeoff.wire || []).forEach(function (row, idx) {
      const bf = billFeet(row);
      const ext = extWithMarkup(bf, row.unitCost, m);
      wTotal += ext;
      const bcell = document.querySelector('[data-bill="' + idx + '"]');
      if (bcell) bcell.textContent = String(Math.round(bf * 10) / 10);
      const cell = document.querySelector('[data-ext-wire="' + idx + '"]');
      if (cell) cell.textContent = formatMoney(ext);
    });
    const dt = document.getElementById("takeoff-device-total");
    const wt = document.getElementById("takeoff-wire-total");
    const gt = document.getElementById("takeoff-grand-total");
    if (dt) dt.textContent = formatMoney(dTotal);
    if (wt) wt.textContent = formatMoney(wTotal);
    if (gt) gt.textContent = formatMoney(dTotal + wTotal);
  }

  function updateTakeoffFlags() {
    const flag = document.getElementById("takeoff-wire-flag");
    if (!flag || !state.intake) return;
    const hasDevices = (state.takeoff.devices || []).some(function (d) { return (Number(d.qty) || 0) > 0; });
    const anyWire = (state.takeoff.wire || []).some(function (w) { return (Number(w.lengthFt) || 0) > 0; });
    const turnkey = state.intake.scope === "turnkey";
    if (hasDevices && !anyWire) {
      flag.hidden = false;
      flag.textContent = turnkey
        ? "no wire takeoff — not bidable for turnkey."
        : "no wire takeoff — not bidable for turnkey. (check-and-test: electrician furnish OK)";
    } else {
      flag.hidden = true;
    }
  }

  function renderCatalogList(filter) {
    const box = document.getElementById("catalog-results");
    if (!box) return;
    const q = (filter || "").toLowerCase().trim();
    const items = STARTER_CATALOG.filter(function (c) {
      if (!q) return true;
      return c.desc.toLowerCase().indexOf(q) >= 0 ||
        c.part.toLowerCase().indexOf(q) >= 0 ||
        c.mfr.toLowerCase().indexOf(q) >= 0 ||
        c.id.indexOf(q) >= 0;
    });
    box.innerHTML = items.map(function (c) {
      return "<button type=\"button\" class=\"catalog-item\" data-add-cat=\"" + escapeAttr(c.id) + "\">" +
        escapeHtml(c.desc) +
        (c.part ? " <span class=\"muted\">" + escapeHtml(c.part) + "</span>" : "") +
        (c.note ? " <span class=\"hint\">" + escapeHtml(c.note) + "</span>" : "") +
        "</button>";
    }).join("");
  }

  function addCatalogRow(catId) {
    syncTakeoffFromDom();
    const cat = STARTER_CATALOG.find(function (c) { return c.id === catId; });
    if (!cat) return;
    state.takeoff.devices.push({
      qty: 1, description: cat.desc, manufacturer: cat.mfr, partNumber: cat.part,
      supplier: cat.supplier, unitCost: "", catalogId: cat.id,
    });
    persistTakeoff();
    renderTakeoff();
  }

  function addBlankDeviceRow() {
    syncTakeoffFromDom();
    state.takeoff.devices.push({
      qty: 1, description: "", manufacturer: "", partNumber: "", supplier: "ADI", unitCost: "", catalogId: "",
    });
    persistTakeoff();
    renderTakeoff();
  }

  function addBlankWireRow() {
    syncTakeoffFromDom();
    state.takeoff.wire.push({
      runs: 0, wireType: WIRE_TYPES[0], productCode: "", supplier: "Windy City Wire",
      lengthFt: 0, wastePct: 10, unitCost: "", otherType: "",
    });
    persistTakeoff();
    renderTakeoff();
  }

  document.addEventListener("click", function (e) {
    const addCat = e.target.closest("[data-add-cat]");
    if (addCat) { addCatalogRow(addCat.getAttribute("data-add-cat")); return; }
    const delDev = e.target.closest("[data-del-dev]");
    if (delDev) {
      syncTakeoffFromDom();
      const devIdx = Number(delDev.getAttribute("data-del-dev"));
      const devRow = state.takeoff.devices[devIdx];
      if (devRow && devRow.fromMarkup && devRow.catalogId) {
        printMarkup.markups = printMarkup.markups.filter(function (m) {
          return m.catalogId !== devRow.catalogId;
        });
        if (printMarkup.selectedId && !printMarkup.markups.some(function (m) { return m.id === printMarkup.selectedId; })) {
          printMarkup.selectedId = null;
        }
        state.takeoff.devices.splice(devIdx, 1);
        persistTakeoff();
        renderTakeoff();
        refreshMarkupChrome();
        return;
      }
      state.takeoff.devices.splice(devIdx, 1);
      persistTakeoff();
      renderTakeoff();
      return;
    }
    const delWire = e.target.closest("[data-del-wire]");
    if (delWire) {
      syncTakeoffFromDom();
      state.takeoff.wire.splice(Number(delWire.getAttribute("data-del-wire")), 1);
      persistTakeoff();
      renderTakeoff();
      return;
    }
  });

  const takeoffScreen = document.getElementById("screen-takeoff");
  if (takeoffScreen) {
    takeoffScreen.addEventListener("input", function (e) {
      if (e.target.id === "catalog-search") { renderCatalogList(e.target.value); return; }
      if (e.target.id === "takeoff-markup") { syncTakeoffFromDom(); return; }
      if (e.target.closest("#takeoff-device-body") || e.target.closest("#takeoff-wire-body")) {
        if (e.target.getAttribute("data-f") === "wireType") {
          const tr = e.target.closest("tr");
          const other = tr && tr.querySelector('[data-f="otherType"]');
          if (other) other.hidden = e.target.value !== "Other";
        }
        syncTakeoffFromDom();
      }
    });
  }

  const btnAddDev = document.getElementById("btn-add-device-row");
  if (btnAddDev) btnAddDev.addEventListener("click", addBlankDeviceRow);
  const btnAddWire = document.getElementById("btn-add-wire-row");
  if (btnAddWire) btnAddWire.addEventListener("click", addBlankWireRow);

  function takeoffSummaryHtml() {
    if (!state.takeoff || !state.takeoff.initialized) return "";
    const m = state.markup || 0;
    let html = "<h4>Takeoff — devices</h4><table><thead><tr><th>Qty</th><th>Description</th><th>Mfr</th><th>Part</th><th>Supplier</th><th>Unit</th><th>Ext</th></tr></thead><tbody>";
    let dTotal = 0;
    (state.takeoff.devices || []).forEach(function (row) {
      const ext = extWithMarkup(row.qty, row.unitCost, m);
      dTotal += ext;
      html += "<tr><td>" + row.qty + "</td><td>" + escapeHtml(row.description) + "</td><td>" + escapeHtml(row.manufacturer) +
        "</td><td>" + escapeHtml(row.partNumber) + "</td><td>" + escapeHtml(row.supplier) + "</td><td>" +
        (row.unitCost === "" || row.unitCost == null ? "—" : formatMoney(Number(row.unitCost))) +
        "</td><td>" + formatMoney(ext) + "</td></tr>";
    });
    html += "</tbody></table><p>Devices subtotal: " + formatMoney(dTotal) + "</p>";

    const c2t = state.intake && state.intake.scope === "check-and-test";
    html += "<h4>Takeoff — wire" + (c2t ? " (electrician furnish)" : "") + "</h4>";
    html += "<table><thead><tr><th>Runs</th><th>Type</th><th>Code</th><th>Supplier</th><th>Length</th><th>Waste%</th><th>Bill ft</th><th>Unit</th><th>Ext</th></tr></thead><tbody>";
    let wTotal = 0;
    (state.takeoff.wire || []).forEach(function (row) {
      const bf = billFeet(row);
      const ext = extWithMarkup(bf, row.unitCost, m);
      wTotal += ext;
      const typeLabel = row.wireType === "Other" ? (row.otherType || "Other") : row.wireType;
      html += "<tr><td>" + row.runs + "</td><td>" + escapeHtml(typeLabel) + "</td><td>" + escapeHtml(row.productCode || "") +
        "</td><td>" + escapeHtml(row.supplier) + "</td><td>" + row.lengthFt + "</td><td>" + row.wastePct +
        "</td><td>" + (Math.round(bf * 10) / 10) + "</td><td>" +
        (row.unitCost === "" || row.unitCost == null ? "—" : formatMoney(Number(row.unitCost))) +
        "</td><td>" + formatMoney(ext) + "</td></tr>";
    });
    html += "</tbody></table><p>Wire subtotal: " + formatMoney(wTotal) + "</p>";
    html += "<p><strong>Takeoff grand: " + formatMoney(dTotal + wTotal) + "</strong></p>";
    return html;
  }

  /* ---------- PRINT MARKUP (on Takeoff) ---------- */

  function markupStyle(id) {
    return MARKUP_STYLE[id] || { abbr: "?", color: "#f5c518" };
  }

  function catalogById(id) {
    for (let i = 0; i < STARTER_CATALOG.length; i++) {
      if (STARTER_CATALOG[i].id === id) return STARTER_CATALOG[i];
    }
    return null;
  }

  function textOn(hex) {
    const n = parseInt(String(hex).replace("#", ""), 16);
    if (!Number.isFinite(n)) return "#1a1a1e";
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    return y > 160 ? "#1a1a1e" : "#ffffff";
  }

  function fileKey(file) {
    if (!file) return "";
    return [file.name, file.size, file.lastModified, file.type].join(":");
  }

  function isPdfFile(file) {
    if (!file) return false;
    return file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
  }

  function configurePdfJs() {
    if (!window.pdfjsLib) return false;
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return true;
  }

  function setMarkupStatus(text, isError) {
    const el = document.getElementById("markup-status");
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("alert-hint");
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.classList.toggle("alert-hint", !!isError);
  }

  function setMarkupSource(text) {
    const el = document.getElementById("markup-source");
    if (el) el.textContent = text;
  }

  function markupSourceLine() {
    const n = printMarkup.pageCount || 1;
    return "Showing " + (printMarkup.fileName || "print") + " — " + n +
      (n === 1 ? " page." : " pages.") +
      " Pick a device and click the page. Qty on the matching Takeoff line follows the symbols.";
  }

  function mirrorMarkupQuality() {
    const el = document.getElementById("markup-quality");
    const src = document.getElementById("print-quality-msg");
    if (!el) return;
    if (!src || src.hidden || !src.textContent) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    if (printState.looksReadable && !printState.qualityFail && !printState.notReadable) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = src.textContent;
    el.classList.toggle("warn-only", src.classList.contains("warn-only"));
  }

  function clamp01(n) {
    return Math.min(1, Math.max(0, n));
  }

  function symbolRadius(canvas) {
    return Math.max(16, Math.min(34, canvas.width * 0.02));
  }

  function markupCountByCatalog() {
    const counts = {};
    printMarkup.markups.forEach(function (m) {
      counts[m.catalogId] = (counts[m.catalogId] || 0) + 1;
    });
    return counts;
  }

  function markupCountsOnPage(pageIndex) {
    const counts = {};
    printMarkup.markups.forEach(function (m) {
      if (m.page !== pageIndex) return;
      counts[m.catalogId] = (counts[m.catalogId] || 0) + 1;
    });
    return counts;
  }

  function legendLines(counts) {
    const lines = [];
    const seen = {};
    STARTER_CATALOG.forEach(function (c) {
      if (!counts[c.id]) return;
      seen[c.id] = true;
      const style = markupStyle(c.id);
      lines.push({
        id: c.id,
        abbr: style.abbr,
        color: style.color,
        label: c.desc,
        count: counts[c.id],
      });
    });
    Object.keys(counts).forEach(function (id) {
      if (seen[id] || !counts[id]) return;
      const style = markupStyle(id);
      lines.push({
        id: id,
        abbr: style.abbr,
        color: style.color,
        label: id,
        count: counts[id],
      });
    });
    return lines;
  }

  function newMarkupId() {
    return "mk-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function drawSymbol(ctx, m, selected, r) {
    const style = markupStyle(m.catalogId);
    const x = m.x * ctx.canvas.width;
    const y = m.y * ctx.canvas.height;
    ctx.beginPath();
    ctx.arc(x, y, r + (selected ? 5 : 2), 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = style.color;
    ctx.fill();
    ctx.lineWidth = selected ? 4 : 2;
    ctx.strokeStyle = selected ? "#111111" : "rgba(0,0,0,0.7)";
    ctx.stroke();
    const abbr = style.abbr;
    ctx.fillStyle = textOn(style.color);
    ctx.font = "700 " + Math.round(r * (abbr.length > 1 ? 0.56 : 0.72)) + "px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(abbr, x, y + 0.5);
  }

  function redrawPrintMarkup() {
    const view = document.getElementById("markup-canvas");
    const src = printMarkup.pageImage;
    if (!view || !src) return;
    view.width = src.width;
    view.height = src.height;
    const ctx = view.getContext("2d");
    ctx.drawImage(src, 0, 0);
    const r = symbolRadius(view);
    printMarkup.markups.forEach(function (m) {
      if (m.page !== printMarkup.pageIndex) return;
      drawSymbol(ctx, m, m.id === printMarkup.selectedId, r);
    });
  }

  function updateMarkupNav() {
    const label = document.getElementById("markup-page-label");
    const prev = document.getElementById("markup-prev");
    const next = document.getElementById("markup-next");
    const n = printMarkup.pageCount || 1;
    const i = printMarkup.pageIndex || 0;
    if (label) label.textContent = "Page " + (i + 1) + " of " + n;
    if (prev) prev.disabled = i <= 0;
    if (next) next.disabled = i >= n - 1;
  }

  function renderMarkupPicker() {
    const box = document.getElementById("markup-device-picker");
    if (!box) return;
    const counts = markupCountByCatalog();
    box.innerHTML = STARTER_CATALOG.map(function (c) {
      const style = markupStyle(c.id);
      const n = counts[c.id] || 0;
      const active = c.id === printMarkup.activeCatalogId;
      return "<button type=\"button\" class=\"markup-pick" + (active ? " is-active" : "") +
        "\" data-markup-cat=\"" + escapeAttr(c.id) + "\" aria-pressed=\"" + (active ? "true" : "false") + "\">" +
        "<span class=\"markup-swatch\" style=\"background:" + style.color + ";color:" + textOn(style.color) + "\">" +
        escapeHtml(style.abbr) + "</span><span>" + escapeHtml(c.desc) +
        (n ? " (" + n + ")" : "") + "</span></button>";
    }).join("");
  }

  function renderMarkupLegend() {
    const box = document.getElementById("markup-legend");
    if (!box) return;
    const pageCounts = markupCountsOnPage(printMarkup.pageIndex);
    const all = markupCountByCatalog();
    const lines = legendLines(all);
    if (!lines.length) {
      box.innerHTML = "<p class=\"hint\">No symbols yet. The legend fills in as you place devices.</p>";
      return;
    }
    let html = "<table class=\"markup-legend\"><thead><tr><th>Symbol</th><th>Device</th><th>This page</th><th>All pages</th></tr></thead><tbody>";
    lines.forEach(function (line) {
      html += "<tr><td><span class=\"markup-swatch\" style=\"background:" + line.color + ";color:" + textOn(line.color) + "\">" +
        escapeHtml(line.abbr) + "</span></td><td>" + escapeHtml(line.label) + "</td><td>" +
        (pageCounts[line.id] || 0) + "</td><td>" + line.count + "</td></tr>";
    });
    html += "</tbody></table>";
    box.innerHTML = html;
  }

  function renderMarkupPlacedList() {
    const box = document.getElementById("markup-page-list");
    if (!box) return;
    const list = printMarkup.markups.filter(function (m) { return m.page === printMarkup.pageIndex; });
    if (!list.length) {
      box.innerHTML = "<p class=\"hint\">Nothing placed on this page.</p>";
      return;
    }
    box.innerHTML = list.map(function (m) {
      const cat = catalogById(m.catalogId);
      const style = markupStyle(m.catalogId);
      const sel = m.id === printMarkup.selectedId ? " is-selected" : "";
      return "<div class=\"markup-placed" + sel + "\">" +
        "<button type=\"button\" class=\"btn btn-ghost btn-tiny\" data-markup-select=\"" + escapeAttr(m.id) + "\">" +
        escapeHtml(style.abbr + "  " + (cat ? cat.desc : m.catalogId)) + "</button>" +
        "<button type=\"button\" class=\"btn btn-ghost btn-tiny\" data-markup-remove=\"" + escapeAttr(m.id) + "\">Remove</button></div>";
    }).join("");
  }

  function refreshMarkupChrome() {
    if (!printMarkup.pageImage) return;
    redrawPrintMarkup();
    updateMarkupNav();
    renderMarkupPicker();
    renderMarkupLegend();
    renderMarkupPlacedList();
  }

  function dropFromMarkupRows() {
    syncTakeoffFromDom();
    const devices = state.takeoff.devices || [];
    const next = devices.filter(function (row) { return !row.fromMarkup; });
    if (next.length === devices.length) return;
    state.takeoff.devices = next;
    persistTakeoff();
    renderTakeoff();
  }

  function applyMarkupCounts() {
    if (!state.takeoff) state.takeoff = { devices: [], wire: [], initialized: true };
    if (!state.takeoff.devices) state.takeoff.devices = [];
    syncTakeoffFromDom();
    const counts = markupCountByCatalog();
    const used = {};
    const next = [];
    (state.takeoff.devices || []).forEach(function (row) {
      if (row.fromMarkup) {
        const n = row.catalogId ? (counts[row.catalogId] || 0) : 0;
        if (!n || used[row.catalogId]) return;
        row.qty = n;
        used[row.catalogId] = true;
        next.push(row);
        return;
      }
      if (row.catalogId && counts[row.catalogId] && !used[row.catalogId]) {
        row.qty = counts[row.catalogId];
        row.fromMarkup = true;
        used[row.catalogId] = true;
      }
      next.push(row);
    });
    Object.keys(counts).forEach(function (id) {
      if (used[id]) return;
      const cat = catalogById(id);
      if (!cat) return;
      next.push({
        qty: counts[id],
        description: cat.desc,
        manufacturer: cat.mfr,
        partNumber: cat.part,
        supplier: cat.supplier,
        unitCost: "",
        catalogId: cat.id,
        fromMarkup: true,
      });
    });
    state.takeoff.devices = next;
    state.takeoff.initialized = true;
    persistTakeoff();
    renderTakeoff();
    refreshMarkupChrome();
  }

  function removeMarkupById(id) {
    const before = printMarkup.markups.length;
    printMarkup.markups = printMarkup.markups.filter(function (m) { return m.id !== id; });
    if (printMarkup.selectedId === id) printMarkup.selectedId = null;
    if (printMarkup.markups.length === before) return;
    applyMarkupCounts();
    setMarkupStatus("");
  }

  function placeMarkup(norm) {
    const id = newMarkupId();
    printMarkup.markups.push({
      id: id,
      page: printMarkup.pageIndex,
      x: clamp01(norm.x),
      y: clamp01(norm.y),
      catalogId: printMarkup.activeCatalogId || "smoke",
    });
    printMarkup.selectedId = id;
    applyMarkupCounts();
    setMarkupStatus("");
  }

  function hitMarkup(norm, pageIndex) {
    const canvas = document.getElementById("markup-canvas");
    if (!canvas || !canvas.width) return null;
    const r = symbolRadius(canvas) * 1.35;
    const list = printMarkup.markups.filter(function (m) { return m.page === pageIndex; });
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      const dx = (m.x - norm.x) * canvas.width;
      const dy = (m.y - norm.y) * canvas.height;
      if (dx * dx + dy * dy <= r * r) return m;
    }
    return null;
  }

  function canvasNorm(e) {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  async function renderPdfPageCanvas(pdfDoc, index) {
    const page = await pdfDoc.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    const long = Math.max(base.width, base.height) || 1;
    const scale = Math.min(2.5, 2000 / long);
    const viewport = page.getViewport({ scale: scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    return { canvas: canvas, width: base.width, height: base.height };
  }

  function loadImageElement(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read that image."));
      };
      img.src = url;
    });
  }

  function canvasFromImage(img) {
    const w = img.naturalWidth || img.width || 1;
    const h = img.naturalHeight || img.height || 1;
    const long = Math.max(w, h);
    const scale = long > 1800 ? 1800 / long : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function loadPrintForMarkup(file) {
    const key = fileKey(file);
    const pdf = isPdfFile(file);
    if (pdf && !configurePdfJs()) {
      throw new Error("PDF markup needs pdf.js from the CDN. Check the network and reload.");
    }
    setMarkupStatus("Opening " + file.name + "…");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let pdfDoc = null;
    let pageImage = null;
    let kind = "image";
    let pageCount = 1;
    let imageType = file.type || "";

    if (pdf) {
      let task;
      try {
        task = window.pdfjsLib.getDocument({ data: bytes.slice(0) });
        pdfDoc = await task.promise;
      } catch (err) {
        throw new Error("Could not open that PDF. " + (err && err.message ? err.message : "Check the file and the network."));
      }
      pageCount = pdfDoc.numPages || 0;
      if (!pageCount) {
        try { await pdfDoc.destroy(); } catch (_) {}
        throw new Error("That PDF has no pages.");
      }
      const rendered = await renderPdfPageCanvas(pdfDoc, 0);
      pageImage = rendered.canvas;
      kind = "pdf";
      imageType = "application/pdf";
    } else {
      const img = await loadImageElement(file);
      sampleImageQuality(img);
      pageImage = canvasFromImage(img);
      kind = "image";
      pageCount = 1;
    }

    const switching = printMarkup.loadedKey && printMarkup.loadedKey !== key;
    if (switching) {
      printMarkup.markups = [];
      printMarkup.selectedId = null;
      dropFromMarkupRows();
    }
    if (printMarkup.pdfDoc && printMarkup.pdfDoc !== pdfDoc) {
      try { await printMarkup.pdfDoc.destroy(); } catch (_) {}
    }
    printMarkup.loadedKey = key;
    printMarkup.fileName = file.name;
    printMarkup.bytes = bytes;
    printMarkup.imageType = imageType;
    printMarkup.kind = kind;
    printMarkup.pdfDoc = pdfDoc;
    printMarkup.pageCount = pageCount;
    printMarkup.pageIndex = 0;
    printMarkup.pageImage = pageImage;
    const tools = document.getElementById("markup-tools");
    if (tools) tools.hidden = false;
    setMarkupSource(markupSourceLine());
    mirrorMarkupQuality();
    refreshMarkupChrome();
    setMarkupStatus("");
  }

  function maybeLoadIntakePrint() {
    const file = printState.file;
    if (!file) {
      if (!printMarkup.pageImage) {
        const tools = document.getElementById("markup-tools");
        if (tools) tools.hidden = true;
        setMarkupSource("No print yet. Import a PDF or image here, or upload one on Intake.");
      } else {
        refreshMarkupChrome();
      }
      return;
    }
    if (printMarkup.loadedKey === fileKey(file) && printMarkup.pageImage) {
      const tools = document.getElementById("markup-tools");
      if (tools) tools.hidden = false;
      setMarkupSource(markupSourceLine());
      mirrorMarkupQuality();
      refreshMarkupChrome();
      return;
    }
    loadPrintForMarkup(file).catch(function (err) {
      setMarkupStatus(err && err.message ? err.message : "Could not open that print.", true);
    });
  }

  function openTakeoffScreen() {
    initTakeoffFromEstimates();
    renderTakeoff();
    showScreen("takeoff");
    renderMarkupPicker();
    maybeLoadIntakePrint();
  }

  async function goMarkupPage(index) {
    if (printMarkup.exporting) return;
    if (printMarkup.kind !== "pdf" || !printMarkup.pdfDoc) return;
    if (index < 0 || index >= printMarkup.pageCount || index === printMarkup.pageIndex) return;
    const token = ++printMarkup.renderToken;
    setMarkupStatus("Opening page " + (index + 1) + "…");
    try {
      const rendered = await renderPdfPageCanvas(printMarkup.pdfDoc, index);
      if (token !== printMarkup.renderToken) return;
      printMarkup.pageImage = rendered.canvas;
      printMarkup.pageIndex = index;
      setMarkupStatus("");
      refreshMarkupChrome();
    } catch (err) {
      if (token !== printMarkup.renderToken) return;
      setMarkupStatus(err && err.message ? err.message : "Could not open that page.", true);
    }
  }

  function canvasToPngBytes(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) {
          reject(new Error("Could not encode the page image."));
          return;
        }
        blob.arrayBuffer().then(function (buf) {
          resolve(new Uint8Array(buf));
        }).catch(reject);
      }, "image/png");
    });
  }

  async function embedRasterImage(out) {
    // Export the canvas the rep clicked on so symbols land on the same picture,
    // including phone photos the browser rotated for display.
    const png = await canvasToPngBytes(printMarkup.pageImage);
    return out.embedPng(png);
  }

  function pdfSafe(s) {
    return String(s == null ? "" : s).replace(/[^\x20-\x7E]/g, "?");
  }

  function wrapPdfText(text, maxChars) {
    const words = pdfSafe(text).split(/\s+/);
    const lines = [];
    let cur = "";
    words.forEach(function (w) {
      if (!w) return;
      const next = cur ? cur + " " + w : w;
      if (next.length > maxChars && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = next;
      }
    });
    if (cur) lines.push(cur);
    return lines;
  }

  function hexToPdfRgb(hex, rgb) {
    const n = parseInt(String(hex).replace("#", ""), 16);
    if (!Number.isFinite(n)) return rgb(0.96, 0.77, 0.09);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  function drawLegendBand(page, pageIndex, pageCount, lines, font, fontBold, rgb, band) {
    const width = page.getWidth();
    page.drawRectangle({
      x: 0,
      y: 0,
      width: width,
      height: band,
      color: rgb(0.96, 0.95, 0.91),
    });
    page.drawRectangle({
      x: 0,
      y: band - 2,
      width: width,
      height: 2,
      color: rgb(0.77, 0.62, 0.04),
    });
    let y = band - 14;
    page.drawText(pdfSafe("Page " + (pageIndex + 1) + " of " + pageCount + " - symbol legend"), {
      x: 10,
      y: y,
      size: 10,
      font: fontBold,
      color: rgb(0.12, 0.12, 0.14),
    });
    y -= 14;
    if (!lines.length) {
      page.drawText("No devices marked on this page.", {
        x: 10,
        y: y,
        size: 9,
        font: font,
        color: rgb(0.2, 0.2, 0.22),
      });
      return;
    }
    lines.forEach(function (line) {
      page.drawCircle({
        x: 18,
        y: y + 3,
        size: 5,
        color: hexToPdfRgb(line.color, rgb),
      });
      page.drawText(pdfSafe(line.abbr + "  " + line.label + "  " + line.count), {
        x: 28,
        y: y,
        size: 9,
        font: font,
        color: rgb(0.1, 0.1, 0.12),
      });
      y -= 14;
    });
  }

  function drawPdfSymbols(page, pageIndex, drawW, drawH, band, fontBold, rgb) {
    const markups = printMarkup.markups.filter(function (m) { return m.page === pageIndex; });
    markups.forEach(function (m) {
      const style = markupStyle(m.catalogId);
      const r = Math.max(7, Math.min(13, Math.min(drawW, drawH) * 0.018));
      const x = m.x * drawW;
      const y = band + (1 - m.y) * drawH;
      page.drawCircle({ x: x, y: y, size: r + 1.4, color: rgb(1, 1, 1) });
      page.drawCircle({
        x: x,
        y: y,
        size: r,
        color: hexToPdfRgb(style.color, rgb),
        borderWidth: 0.7,
        borderColor: rgb(0, 0, 0),
      });
      let fontSize = r * (style.abbr.length > 1 ? 0.62 : 0.78);
      let tw = fontBold.widthOfTextAtSize(style.abbr, fontSize);
      while (fontSize > 5 && tw > r * 1.7) {
        fontSize -= 0.4;
        tw = fontBold.widthOfTextAtSize(style.abbr, fontSize);
      }
      const ink = textOn(style.color) === "#ffffff" ? rgb(1, 1, 1) : rgb(0.1, 0.1, 0.12);
      page.drawText(style.abbr, {
        x: x - tw / 2,
        y: y - fontSize * 0.35,
        size: fontSize,
        font: fontBold,
        color: ink,
      });
    });
  }

  function addLegendSummaryPages(out, font, fontBold, rgb) {
    let page = out.addPage([612, 792]);
    let y = 748;
    function ensure(h) {
      if (y - h < 48) {
        page = out.addPage([612, 792]);
        y = 748;
      }
    }
    function line(text, size, bold, color) {
      ensure(size + 6);
      page.drawText(pdfSafe(text), {
        x: 36,
        y: y,
        size: size,
        font: bold ? fontBold : font,
        color: color,
      });
      y -= size + 6;
    }
    line("PanelPath - marked prints", 16, true, rgb(0.1, 0.1, 0.12));
    line("File: " + (printMarkup.fileName || "print"), 11, false, rgb(0.15, 0.15, 0.16));
    line("Legend of symbols and counts per page. No prices, wire, or labor.", 10, false, rgb(0.2, 0.2, 0.22));
    y -= 6;
    const pageCount = printMarkup.pageCount || 1;
    for (let i = 0; i < pageCount; i++) {
      line("Page " + (i + 1), 12, true, rgb(0.1, 0.1, 0.12));
      const lines = legendLines(markupCountsOnPage(i));
      if (!lines.length) {
        line("No devices marked on this page.", 10, false, rgb(0.25, 0.25, 0.27));
      } else {
        lines.forEach(function (ln) {
          line(ln.abbr + "  " + ln.label + "  " + ln.count, 10, false, rgb(0.1, 0.1, 0.12));
        });
      }
      y -= 4;
    }
    line("All pages", 12, true, rgb(0.1, 0.1, 0.12));
    const allLines = legendLines(markupCountByCatalog());
    if (!allLines.length) {
      line("No devices marked.", 10, false, rgb(0.25, 0.25, 0.27));
    } else {
      allLines.forEach(function (ln) {
        line(ln.abbr + "  " + ln.label + "  " + ln.count, 10, false, rgb(0.1, 0.1, 0.12));
      });
    }
    y -= 8;
    wrapPdfText(DISCLAIMER, 86).forEach(function (part) {
      line(part, 9, false, rgb(0.25, 0.25, 0.27));
    });
  }

  function downloadBytes(bytes, filename, mime) {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  async function exportMarkedPrints() {
    if (!printMarkup.pageImage) {
      setMarkupStatus("Import a print before exporting.", true);
      return;
    }
    if (!window.PDFLib) {
      setMarkupStatus("Export needs pdf-lib from the CDN. Check the network and reload.", true);
      return;
    }
    const btn = document.getElementById("markup-export");
    printMarkup.exporting = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Preparing PDF…";
    }
    try {
      const PDFDocument = window.PDFLib.PDFDocument;
      const StandardFonts = window.PDFLib.StandardFonts;
      const rgb = window.PDFLib.rgb;
      const out = await PDFDocument.create();
      const font = await out.embedFont(StandardFonts.Helvetica);
      const fontBold = await out.embedFont(StandardFonts.HelveticaBold);
      const pageCount = printMarkup.pageCount || 1;
      for (let i = 0; i < pageCount; i++) {
        setMarkupStatus("Rendering page " + (i + 1) + " of " + pageCount + "…");
        let embedded;
        let viewW;
        let viewH;
        if (printMarkup.kind === "pdf") {
          if (!printMarkup.pdfDoc) throw new Error("The PDF is no longer open. Import it again.");
          const rendered = await renderPdfPageCanvas(printMarkup.pdfDoc, i);
          const png = await canvasToPngBytes(rendered.canvas);
          embedded = await out.embedPng(png);
          viewW = rendered.width;
          viewH = rendered.height;
        } else {
          embedded = await embedRasterImage(out);
          viewW = embedded.width;
          viewH = embedded.height;
        }
        const long = Math.max(viewW, viewH) || 1;
        const fit = long > 1000 ? 1000 / long : 1;
        const drawW = viewW * fit;
        const drawH = viewH * fit;
        const lines = legendLines(markupCountsOnPage(i));
        const band = 30 + Math.max(1, lines.length) * 14;
        const page = out.addPage([Math.max(drawW, 360), drawH + band]);
        page.drawImage(embedded, { x: 0, y: band, width: drawW, height: drawH });
        drawLegendBand(page, i, pageCount, lines, font, fontBold, rgb, band);
        drawPdfSymbols(page, i, drawW, drawH, band, fontBold, rgb);
      }
      addLegendSummaryPages(out, font, fontBold, rgb);
      const saved = await out.save();
      downloadBytes(saved, "panelpath-marked-prints.pdf", "application/pdf");
      setMarkupStatus("Downloaded panelpath-marked-prints.pdf.");
    } catch (err) {
      setMarkupStatus("Export failed: " + (err && err.message ? err.message : "unknown error"), true);
    } finally {
      printMarkup.exporting = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Download marked-up PDF";
      }
      updateMarkupNav();
    }
  }

  function bindMarkupUi() {
    const fileInput = document.getElementById("markup-file");
    if (fileInput) {
      fileInput.addEventListener("change", function (e) {
        const f = e.target.files && e.target.files[0];
        e.target.value = "";
        if (!f) return;
        handlePrintFile(f);
        loadPrintForMarkup(f).catch(function (err) {
          setMarkupStatus(err && err.message ? err.message : "Could not open that print.", true);
        });
      });
    }
    const picker = document.getElementById("markup-device-picker");
    if (picker) {
      picker.addEventListener("click", function (e) {
        const btn = e.target.closest("[data-markup-cat]");
        if (!btn) return;
        printMarkup.activeCatalogId = btn.getAttribute("data-markup-cat");
        renderMarkupPicker();
      });
    }
    const list = document.getElementById("markup-page-list");
    if (list) {
      list.addEventListener("click", function (e) {
        const sel = e.target.closest("[data-markup-select]");
        if (sel) {
          printMarkup.selectedId = sel.getAttribute("data-markup-select");
          redrawPrintMarkup();
          renderMarkupPlacedList();
          setMarkupStatus("");
          return;
        }
        const rm = e.target.closest("[data-markup-remove]");
        if (rm) removeMarkupById(rm.getAttribute("data-markup-remove"));
      });
    }
    const prev = document.getElementById("markup-prev");
    const next = document.getElementById("markup-next");
    if (prev) prev.addEventListener("click", function () { goMarkupPage(printMarkup.pageIndex - 1); });
    if (next) next.addEventListener("click", function () { goMarkupPage(printMarkup.pageIndex + 1); });
    const removeBtn = document.getElementById("markup-remove");
    if (removeBtn) {
      removeBtn.addEventListener("click", function () {
        if (!printMarkup.selectedId) {
          setMarkupStatus("Select a symbol on the page first.", true);
          return;
        }
        removeMarkupById(printMarkup.selectedId);
      });
    }
    const exportBtn = document.getElementById("markup-export");
    if (exportBtn) exportBtn.addEventListener("click", function () { exportMarkedPrints(); });
    const canvas = document.getElementById("markup-canvas");
    let lastPlaceAt = 0;
    let lastPlaceX = -1;
    let lastPlaceY = -1;
    if (canvas) {
      canvas.addEventListener("click", function (e) {
        if (printMarkup.exporting || !printMarkup.pageImage) return;
        const norm = canvasNorm(e);
        if (!norm) return;
        const hit = hitMarkup(norm, printMarkup.pageIndex);
        if (hit) {
          printMarkup.selectedId = hit.id;
          redrawPrintMarkup();
          renderMarkupPlacedList();
          setMarkupStatus("");
          return;
        }
        const now = Date.now();
        if (now - lastPlaceAt < 280 && Math.abs(norm.x - lastPlaceX) < 0.01 && Math.abs(norm.y - lastPlaceY) < 0.01) {
          return;
        }
        lastPlaceAt = now;
        lastPlaceX = norm.x;
        lastPlaceY = norm.y;
        placeMarkup(norm);
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (!printMarkup.selectedId) return;
      const t = e.target;
      if (t && t.closest && t.closest("input, textarea, select")) return;
      const screen = document.getElementById("screen-takeoff");
      if (!screen || screen.hidden) return;
      e.preventDefault();
      removeMarkupById(printMarkup.selectedId);
    });
  }

  bindMarkupUi();


  function revokePrintUrl() {
    if (printState.objectUrl) {
      try { URL.revokeObjectURL(printState.objectUrl); } catch (_) {}
      printState.objectUrl = null;
    }
  }

  function setPrintQualityMsg(text, isWarnOnly) {
    const el = document.getElementById("print-quality-msg");
    if (!text) { el.hidden = true; el.textContent = ""; return; }
    el.hidden = false;
    el.textContent = text;
    el.classList.toggle("warn-only", !!isWarnOnly);
  }

  function sampleImageQuality(img) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const longEdge = Math.max(w, h);
    printState.longEdge = longEdge;
    let warn = "";
    let fail = false;
    if (longEdge < 800) {
      warn = "Image long edge under ~800px — likely too small to read devices.";
      fail = true;
    }
    try {
      const canvas = document.getElementById("print-preview-canvas");
      const max = 120;
      const scale = Math.min(1, max / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, cw, ch);
      const data = ctx.getImageData(0, 0, cw, ch).data;
      let dark = 0, light = 0, mid = 0;
      const step = 16;
      for (let i = 0; i < data.length; i += step) {
        const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (y < 25) dark++;
        else if (y > 230) light++;
        else mid++;
      }
      const total = dark + light + mid || 1;
      if (mid / total < 0.05) {
        const msg = "Heuristic: mostly white/black with little linework — may be blank or unusable.";
        warn = warn ? warn + " " + msg : msg;
        fail = true;
      }
      canvas.hidden = true;
    } catch (_) {}
    printState.qualityWarn = warn;
    printState.qualityFail = fail;
    setPrintQualityMsg(warn, !fail);
  }

  function handlePrintFile(file) {
    revokePrintUrl();
    printState.file = file || null;
    printState.fileName = file ? file.name : "";
    printState.fileType = file ? file.type || "" : "";
    printState.longEdge = 0;
    printState.qualityWarn = "";
    printState.qualityFail = false;
    printState.pdfAcceptedNote = false;
    printState.notReadable = false;
    printState.looksReadable = false;

    const previewWrap = document.getElementById("print-preview-wrap");
    const img = document.getElementById("print-preview-img");
    const canvas = document.getElementById("print-preview-canvas");
    const label = document.getElementById("print-preview-label");
    const pdfConfirm = document.getElementById("pdf-readable-confirm");
    const notNote = document.getElementById("print-not-readable-note");
    notNote.hidden = true;
    if (document.getElementById("pdfLooksReadable")) {
      document.getElementById("pdfLooksReadable").checked = false;
    }

    if (!file) {
      previewWrap.hidden = true;
      img.hidden = true;
      canvas.hidden = true;
      pdfConfirm.hidden = true;
      setPrintQualityMsg("");
      return;
    }

    const url = URL.createObjectURL(file);
    printState.objectUrl = url;
    previewWrap.hidden = false;

    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      printState.fileType = "application/pdf";
      img.hidden = true;
      canvas.hidden = true;
      label.textContent = "PDF accepted — confirm pages are readable. Open Takeoff to view every page and mark devices.";
      pdfConfirm.hidden = false;
      printState.pdfAcceptedNote = true;
      setPrintQualityMsg("PDF accepted — confirm pages are readable.", true);
      return;
    }

    pdfConfirm.hidden = true;
    img.hidden = false;
    img.onload = function () {
      label.textContent = file.name + " — " + (img.naturalWidth || 0) + "x" + (img.naturalHeight || 0);
      sampleImageQuality(img);
    };
    img.onerror = function () {
      setPrintQualityMsg("Could not preview image.", false);
      printState.qualityFail = true;
    };
    img.src = url;
  }

  function toggleHazardOther() {
    const other = document.getElementById("hazardOther");
    const wrap = document.getElementById("hazard-other-text-wrap");
    if (!wrap) return;
    wrap.hidden = !(other && other.checked);
  }

  function toggleNoneHazard(e) {
    const none = document.getElementById("hazardNone");
    if (!none) return;
    if (e && e.target && e.target.name === "hazard" && e.target.value === "none" && e.target.checked) {
      document.querySelectorAll('input[name="hazard"]').forEach((cb) => {
        if (cb.value !== "none") cb.checked = false;
      });
      toggleHazardOther();
    } else if (e && e.target && e.target.name === "hazard" && e.target.value !== "none" && e.target.checked) {
      none.checked = false;
    }
  }

  const form = document.getElementById("intake-form");
  buildDeviceChecklistUI();

  form.addEventListener("change", (e) => {
    const n = e.target.name;
    if (n === "jobScale" || n === "scope" || n === "prints" || n === "jobClass" || n === "resStories" || n === "stories") {
      updateIntakeVisibility();
    }
    if (n === "hazard") {
      toggleNoneHazard(e);
      toggleHazardOther();
    }
    if (n === "occupantLoadUnknown") {
      const unk = form.elements.occupantLoadUnknown.checked;
      form.elements.occupantLoad.disabled = unk;
      if (unk) form.elements.occupantLoad.value = "";
    }
    if (n === "yearBuiltUnknown") {
      const unk = form.elements.yearBuiltUnknown.checked;
      form.elements.yearBuilt.disabled = unk;
      if (unk) form.elements.yearBuilt.value = "";
    }
    if (n === "pdfLooksReadable") {
      printState.looksReadable = !!e.target.checked;
      if (e.target.checked) printState.notReadable = false;
      document.getElementById("print-not-readable-note").hidden = true;
      mirrorMarkupQuality();
    }
  });

  const printFile = document.getElementById("printFile");
  if (printFile) {
    printFile.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      handlePrintFile(f || null);
    });
  }

  document.getElementById("btn-print-not-readable").addEventListener("click", () => {
    printState.notReadable = true;
    printState.looksReadable = false;
    if (form.elements.pdfLooksReadable) form.elements.pdfLooksReadable.checked = false;
    document.getElementById("print-not-readable-note").hidden = false;
    setPrintQualityMsg(PRINT_NOT_READABLE_MSG, false);
    mirrorMarkupQuality();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const err = document.getElementById("intake-error");
    const intake = readForm(e.target);
    intake.printHasFile = !!printState.fileName;
    intake.printNotReadable = !!printState.notReadable;
    intake.printQualityWarn = printState.qualityWarn || "";
    intake.printLooksReadable = formLooksReadable() || !!printState.looksReadable;
    const missing = softValidate(intake);
    if (missing.length) {
      err.hidden = false;
      err.textContent = "Required: " + missing.join(", ");
      return;
    }
    err.hidden = true;
    state.intake = intake;
    state.takeoff = { devices: [], wire: [], initialized: false };
    try { sessionStorage.removeItem(TAKEOFF_KEY); } catch (_) {}
    printMarkup.markups = [];
    printMarkup.selectedId = null;
    refreshMarkupChrome();
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(intake)); } catch (_) {}
    goResults();
  });

  document.getElementById("btn-back-intake").addEventListener("click", () => showScreen(1));
  document.getElementById("btn-hardstop-back").addEventListener("click", () => showScreen(1));

  document.getElementById("btn-copy-hardstop").addEventListener("click", () => {
    const ta = document.getElementById("hard-stop-msg");
    const toast = document.getElementById("copy-toast");
    const text = ta.value;
    const done = () => {
      toast.hidden = false;
      toast.textContent = "Copied.";
      setTimeout(() => { toast.hidden = true; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {
        ta.select();
        try { document.execCommand("copy"); done(); } catch (_) {}
      });
    } else {
      ta.select();
      try { document.execCommand("copy"); done(); } catch (_) {}
    }
  });

  document.getElementById("btn-summary").addEventListener("click", () => {
    syncTakeoffFromDom();
    renderSummary();
    showScreen(3);
  });

  document.getElementById("btn-back-results").addEventListener("click", () => showScreen(2));
  document.getElementById("btn-print").addEventListener("click", () => window.print());

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
  document.getElementById("markup-live-spec").addEventListener("input", recalcPrices);
  document.getElementById("markup-live-code").addEventListener("input", recalcPrices);

  // Takeoff nav
  const btnTakeoff = document.getElementById("btn-takeoff");
  if (btnTakeoff) {
    btnTakeoff.addEventListener("click", () => {
      openTakeoffScreen();
    });
  }
  const btnTakeoffBack = document.getElementById("btn-takeoff-back");
  if (btnTakeoffBack) {
    btnTakeoffBack.addEventListener("click", () => {
      syncTakeoffFromDom();
      showScreen(2);
    });
  }
  const btnTakeoffSummary = document.getElementById("btn-takeoff-summary");
  if (btnTakeoffSummary) {
    btnTakeoffSummary.addEventListener("click", () => {
      syncTakeoffFromDom();
      renderSummary();
      showScreen(3);
    });
  }
  const btnSummaryBackTakeoff = document.getElementById("btn-summary-back-takeoff");
  if (btnSummaryBackTakeoff) {
    btnSummaryBackTakeoff.addEventListener("click", () => {
      openTakeoffScreen();
    });
  }

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
  try {
    const traw = sessionStorage.getItem(TAKEOFF_KEY);
    if (traw) {
      state.takeoff = JSON.parse(traw);
      // Symbols live only in this page session. After a refresh the lock is gone;
      // the qty number stays as a manual line until a print is marked again.
      if (state.takeoff && state.takeoff.devices) {
        state.takeoff.devices.forEach(function (row) { row.fromMarkup = false; });
      }
    }
  } catch (_) {}

  showScreen(1);

  window.PanelPath = {
    DISCLAIMER: DISCLAIMER,
    PRINT_NOT_READABLE_MSG: PRINT_NOT_READABLE_MSG,
    recommend: recommend,
    estimateDevices: estimateDevices,
    buildHeuristics: buildHeuristics,
    detectorStrategy: detectorStrategy,
    listMissingItems: listMissingItems,
  };
})();
