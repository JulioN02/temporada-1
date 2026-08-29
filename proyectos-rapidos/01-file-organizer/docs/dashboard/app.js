/* ================= 01 · File Organizer — app.js =================
   Interactive logic for the didactic dashboard:
     classifier  (03) live extension→category resolution (ported classify())
     terminal    (04) animated dry-run vs real execution comparison
     collision   (05) step-by-step destination resolution with reservation set
     precedence  (06) live config layer resolution (miscFolder + per-extension merge)
   Convention: visible UI text in neutral Spanish; comments/identifiers in English.
   No external requests, no build step — works from file://.
============================================================================ */

/* ================= helpers ================= */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= default mapping (mirrors src/config.ts) ================= */
const DEFAULT_MAPPING = {
  pdf: "PDF",
  jpg: "Images", jpeg: "Images", png: "Images", gif: "Images", webp: "Images",
  svg: "Images", bmp: "Images", ico: "Images", avif: "Images",
  mp4: "Videos", mkv: "Videos", avi: "Videos", mov: "Videos", webm: "Videos", m4v: "Videos",
  mp3: "Audio", wav: "Audio", flac: "Audio", ogg: "Audio", m4a: "Audio", aac: "Audio", opus: "Audio",
  ts: "Code", js: "Code", tsx: "Code", jsx: "Code", py: "Code", rs: "Code", go: "Code",
  java: "Code", c: "Code", cpp: "Code", h: "Code", hpp: "Code", sh: "Code", json: "Code",
  yml: "Code", yaml: "Code", toml: "Code", html: "Code", css: "Code", scss: "Code",
  doc: "Documents", docx: "Documents", xls: "Documents", xlsx: "Documents",
  ppt: "Documents", pptx: "Documents", odt: "Documents", ods: "Documents",
  txt: "Documents", md: "Documents", rtf: "Documents", csv: "Documents",
  zip: "Archives", tar: "Archives", gz: "Archives", bz2: "Archives", xz: "Archives",
  "7z": "Archives", rar: "Archives", tgz: "Archives", deb: "Archives", rpm: "Archives", iso: "Archives",
};

/* —— ported classify() from src/classify.ts (same semantics) —— */
function extractExtension(filename) {
  const base = String(filename).split(/[\\/]/).pop() || "";
  const idx = base.lastIndexOf(".");
  if (idx <= 0) return null; // no dot, or leading dot (dotfile) → no extension
  return base.slice(idx + 1).toLowerCase(); // only the last extension matters
}
function classify(filename) {
  const ext = extractExtension(filename);
  if (ext === null || !Object.prototype.hasOwnProperty.call(DEFAULT_MAPPING, ext)) {
    return { kind: "misc" };
  }
  return { kind: "category", category: DEFAULT_MAPPING[ext] };
}

/* ================= 03 · CLASSIFIER ================= */
function renderClassifier(filename) {
  const name = filename.trim();
  const extEl = $(".class-ext");
  const catEl = $(".class-cat");
  const destEl = $(".class-dest");
  const note = $(".classifier-note");
  const base = name.split(/[\\/]/).pop() || "";

  if (name === "") {
    extEl.textContent = "—";
    extEl.className = "v info class-ext";
    catEl.textContent = "—";
    catEl.className = "v good class-cat";
    destEl.textContent = "—";
    destEl.className = "v warn class-dest";
    note.hidden = true;
    return;
  }

  const ext = extractExtension(name);
  const result = classify(name);
  const isDot = base.startsWith(".");

  extEl.textContent = ext === null ? "ninguna" : `.${ext}`;
  extEl.className = "v info class-ext";

  const notes = [];
  if (isDot) {
    catEl.textContent = "—";
    catEl.className = "v info class-cat";
    destEl.textContent = "no se escanea";
    destEl.className = "v warn class-dest";
    notes.push(
      `<b>Archivo oculto:</b> por defecto no se escanea. Con <code>--include-hidden</code> entraría al ` +
      `flujo y, sin extensión, caería en la carpeta miscelánea (<code>${isDot ? "Others" : ""}</code>).`
    );
  } else if (result.kind === "category") {
    catEl.textContent = result.category;
    catEl.className = "v good class-cat";
    destEl.textContent = `${result.category}/${base}`;
    destEl.className = "v warn class-dest";
  } else {
    catEl.textContent = "Miscelánea";
    catEl.className = "v info class-cat";
    destEl.textContent = `Others/${base}`;
    destEl.className = "v warn class-dest";
    notes.push(
      ext === null
        ? `<b>Sin extensión:</b> no hay punto, o el punto está al inicio. Termina en la carpeta miscelánea (o se omite con <code>omitMisc: true</code>).`
        : `<b>Extensión <code>.${ext}</code> no mapeada:</b> no figura en el mapeo configurado. Termina en la carpeta miscelánea (o se omite).`
    );
  }

  note.innerHTML = notes.join(" ");
  note.hidden = notes.length === 0;
}

function bindClassifier() {
  const input = $("#classify-input");
  const examples = $$(".chip-btn");
  input.addEventListener("input", () => renderClassifier(input.value));
  examples.forEach((btn) =>
    btn.addEventListener("click", () => {
      input.value = btn.dataset.file;
      renderClassifier(input.value);
      input.focus();
    })
  );
  renderClassifier(input.value); // initial state
}

/* ================= 04 · TERMINAL (dry-run vs real) ================= */
const TERM_MODE = { mode: "dry" };
const TERM_FILES = [
  { name: "README.md", dest: "Documents/README.md" },
  { name: "photo.png", dest: "Images/photo.png" },
  { name: "report.pdf", dest: "PDF/report.pdf" },
  { name: "setup.exe", dest: "Others/setup.exe" },
];

function appendTermLine(term, cls, text) {
  const line = document.createElement("div");
  line.className = "term-line " + (cls || "");
  line.innerHTML = text;
  term.appendChild(line);
}

async function runTerminal() {
  const term = $("#terminal");
  const btn = $("#term-run");
  btn.disabled = true;
  term.innerHTML = "";

  const dry = TERM_MODE.mode === "dry";
  const prefix = dry ? '<span class="t-dry">[dry-run] </span>' : "";
  const cmd = dry
    ? "$ node --experimental-strip-types src/cli.ts --dry-run"
    : "$ node --experimental-strip-types src/cli.ts";

  appendTermLine(term, "t-cmd", cmd + '<span class="term-cursor"></span>');
  await sleep(450);

  // summary line
  appendTermLine(term, "t-ok", prefix + "Moved: 4 | Skipped: 1 | Errors: 0");
  await sleep(350);

  // per-file plan (sorted lexicographically, matches report order)
  for (const f of TERM_FILES) {
    const destRel = f.dest;
    appendTermLine(term, "t-move", prefix + `${destRel} ← ${f.name}`);
    await sleep(260);
  }
  appendTermLine(term, "t-skip", prefix + "skipped: .env (hidden)");
  await sleep(350);

  if (dry) {
    appendTermLine(term, "t-dim", prefix + "0 escrituras — ni un mkdir, ni un rename, ni un unlink.");
    await sleep(350);
    appendTermLine(term, "t-ok", "✔ El plan se imprimió tal cual se ejecutaría; nada cambió en disco.");
  } else {
    appendTermLine(term, "t-dim", "[create] PDF/ · Images/ · Documents/ · Others/");
    await sleep(320);
    for (const f of TERM_FILES) {
      const from = f.name;
      appendTermLine(term, "t-move", `[rename] ${from} → ${f.dest}`);
      await sleep(200);
    }
    await sleep(300);
    appendTermLine(term, "t-ok", "✔ 4 movimientos reales. Una segunda corrida reportaría 0 movimientos (idempotencia).");
  }

  btn.disabled = false;
}

function bindTerminal() {
  const tabs = $$(".sim-run-tabs .tab-btn");
  tabs.forEach((tab) =>
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      TERM_MODE.mode = tab.dataset.mode;
      const term = $("#terminal");
      term.innerHTML = "";
      appendTermLine(term, "t-dim", "Preparado · seleccioná «▶ Ejecutar simulación».");
    })
  );
  $("#term-run").addEventListener("click", runTerminal);
  appendTermLine($("#terminal"), "t-dim", "Preparado · seleccioná «▶ Ejecutar simulación».");
}

/* ================= 05 · COLLISION SIM =================
   Scenario: PDF/ already contains report.pdf; root has foto.jpg, report (1).pdf, report.pdf.
   Plan (lexicographic): foto.jpg → Images; report (1).pdf → PDF; report.pdf → PDF (collides:
   PDF/report.pdf exists on disk AND PDF/report (1).pdf is already reserved by step 2). */
const COLLISION_STEPS = [
  {
    file: "foto.jpg",
    label: "<b>foto.jpg</b> → <span class='ok'>Images/foto.jpg</span>",
    note: "no existe en disco ni está reservado → se mueve tal cual.",
    reserved: "Images/foto.jpg",
  },
  {
    file: "report (1).pdf",
    label: "<b>report (1).pdf</b> → <span class='ok'>PDF/report (1).pdf</span>",
    note: "<code>PDF/</code> solo contiene <code>report.pdf</code> → el nombre está libre.",
    reserved: "PDF/report (1).pdf",
  },
  {
    file: "report.pdf",
    label:
      "<b>report.pdf</b> → <code>PDF/report.pdf</code> <span class='suf'>ya existe en disco</span> → " +
      "probar <code>PDF/report (1).pdf</code>… <span class='reserved'>reservado por el paso 2</span> → " +
      "probar <code>PDF/report (2).pdf</code> → <span class='ok'>libre → report (2).pdf</span>",
    note:
      "Sin el conjunto de reservas, este paso habría sobrescrito el destino del paso 2. " +
      "Axioma 3: nunca sobrescribir.",
    reserved: "PDF/report (2).pdf",
  },
];

function buildCollisionFS() {
  const host = $("#collision-fs");
  const root = document.createElement("div");
  root.className = "fs-box";
  root.innerHTML =
    `<div class="fs-title">Raíz (a organizar)</div>` +
    `<div class="fs-item new"><span class="dot"></span>foto.jpg</div>` +
    `<div class="fs-item new"><span class="dot"></span>report (1).pdf</div>` +
    `<div class="fs-item new"><span class="dot"></span>report.pdf</div>`;
  const pdf = document.createElement("div");
  pdf.className = "fs-box";
  pdf.innerHTML =
    `<div class="fs-title">PDF/ (ya existe)</div>` +
    `<div class="fs-item same"><span class="dot"></span>report.pdf <span style="color:var(--tx-faint)">← de una corrida anterior</span></div>`;
  const img = document.createElement("div");
  img.className = "fs-box";
  img.innerHTML = `<div class="fs-title">Images/ (vacía)</div><div class="fs-item free"><span class="dot"></span>—</div>`;
  host.append(root, pdf, img);
}

async function runCollision() {
  const wrap = $("#collision-steps");
  const btn = $("#collision-run");
  btn.disabled = true;
  wrap.innerHTML = "";

  const els = COLLISION_STEPS.map((step) => {
    const el = document.createElement("div");
    el.className = "coll-step pending";
    el.innerHTML = step.label + " <span class='t-dim'>— " + step.note + "</span>";
    wrap.appendChild(el);
    return el;
  });

  for (let i = 0; i < els.length; i++) {
    els[i].className = "coll-step active";
    await sleep(650);
    els[i].className = "coll-step done";
    if (COLLISION_STEPS[i].reserved) {
      const tag = document.createElement("div");
      tag.className = "t-dim";
      tag.style.fontSize = ".72rem";
      tag.textContent = "reserva añadida al conjunto: " + COLLISION_STEPS[i].reserved;
      els[i].appendChild(tag);
    }
    await sleep(250);
  }

  btn.disabled = false;
}

function bindCollision() {
  buildCollisionFS();
  $("#collision-run").addEventListener("click", runCollision);
}

/* ================= 06 · PRECEDENCE RESOLVER ================= */
const PREC_LAYERS = [
  { id: "prec-cwd", name: "<cwd>", misc: "Otros", map: { py: "Python" } },
  { id: "prec-target", name: "<target>", misc: "Varios", map: { pdf: "Documentos" } },
  { id: "prec-config", name: "--config", misc: "Mezclados", map: { png: "Pictures" } },
];
const PREC_DEFAULTS = { misc: "Others", map: { pdf: "PDF", png: "Images" } };

function renderPrecedence() {
  const present = PREC_LAYERS.filter((l) => $(l.id).checked);

  // miscFolder: upper (last) present layer wins, else default
  const misc = present.reduce((acc, l) => l.misc, PREC_DEFAULTS.misc);
  const miscEl = $(".prec-misc");
  miscEl.textContent = misc;
  miscEl.className = "v good prec-misc";

  // mapping: per-extension merge (defaults ← layers, upper wins per key)
  const map = { ...PREC_DEFAULTS.map };
  const origins = {};
  for (const l of present) {
    for (const [k, v] of Object.entries(l.map)) {
      const existed = Object.prototype.hasOwnProperty.call(map, k);
      map[k] = v;
      origins[k] = { from: l.name, added: !existed };
    }
  }

  const json = $(".prec-json");
  const keys = Object.keys(map);
  json.innerHTML =
    keys
      .map((k) => {
        const ov = origins[k];
        const comment = ov
          ? ov.added
            ? ` <span class="ov">// añadido por ${ov.from}</span>`
            : ` <span class="ov">// sobrescrito por ${ov.from}</span>`
          : "";
        return `<span class="k">"${k}"</span>: <span class="k">"${map[k]}"</span>${comment}`;
      })
      .join("\n") + "\n}";
}

function bindPrecedence() {
  PREC_LAYERS.forEach((l) => {
    $(l.id).addEventListener("change", renderPrecedence);
  });
  renderPrecedence();
}

/* ================= init ================= */
bindClassifier();
bindTerminal();
bindCollision();
bindPrecedence();