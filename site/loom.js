/*
 * The weave draft.
 *
 * PIPELINE is a phase × domain matrix, which is exactly how weaving is
 * notated: six domain threads run down the page as the warp, eight phases
 * run across it as the weft, and a crossing is a phase drawing from a domain.
 * A phase's pick is drawn as a link spanning the domains it ties together, so
 * the horizontal reach of a row is the reach of that pass.
 * Nothing here is illustrative — the grid, the numbering and every count come
 * from site-data.js, which `npm run site` produces by running the generator.
 */

(() => {
  "use strict";

  const data = window.LOOM_DATA;
  if (!data) return;

  const svgNS = "http://www.w3.org/2000/svg";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Geometry. The draft is a fixed grid scaled by the viewBox, so it stays
     legible on a phone by scrolling rather than by reflowing into something
     that is no longer a draft. */
  const LEFT = 232;
  const COL = 148;
  const ROW = 52;
  const TOP = 58;
  const RIGHT = 26;
  const BOTTOM = 26;

  const phases = data.phases;
  const domains = data.domains;

  /* Warp order is first appearance in the pipeline, and a domain generated
     inside another's pass sits immediately beside its host. That keeps the
     tie between them short enough to read as one binding rather than a line
     travelling across the whole cloth. The controls stay in registry order,
     which is the order a reader meets these domains everywhere else. */
  const firstStep = (id) => {
    const i = data.pipeline.findIndex((s) => s.domain === id);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  const rank = (d) => (d.inlineIn.length ? firstStep(d.inlineIn[0]) + 0.5 : firstStep(d.id));
  const warp = [...domains].sort((a, b) => rank(a) - rank(b));

  const W = LEFT + COL * warp.length + RIGHT;
  const H = TOP + ROW * phases.length + BOTTOM;

  const colX = (i) => LEFT + COL * i + COL / 2;
  const rowY = (i) => TOP + ROW * i + ROW / 2;

  const domainIndex = new Map(warp.map((d, i) => [d.id, i]));
  const phaseIndex = new Map(phases.map((p, i) => [p.id, i]));

  /** Domains a reader can switch off; the rest are structural. */
  const optional = new Set(data.optional);
  const on = new Set(domains.map((d) => d.id));

  const el = (name, attrs, parent) => {
    const node = document.createElementNS(svgNS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (parent) parent.appendChild(node);
    return node;
  };

  const colorOf = (id) => `var(--d-${id})`;

  /* ------------------------------------------------------------- the draft */

  const svg = document.querySelector(".loom__svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  // Phase labels, with what each phase is actually doing.
  for (const [i, p] of phases.entries()) {
    const y = rowY(i);
    const label = el("text", { class: "axis-phase", x: LEFT - 26, y: y - 5 }, svg);
    label.textContent = p.id;
    if (p.blurb) {
      const blurb = el("text", { class: "axis-blurb", x: LEFT - 26, y: y + 10 }, svg);
      blurb.textContent = p.blurb;
    }
  }

  /* 1. Row guides. Faint on purpose: they tie a phase's label to its row and
        nothing more. The line that carries meaning is the link drawn in step
        3, which spans only the domains the phase actually draws from. */
  for (let i = 0; i < phases.length; i++) {
    el(
      "line",
      {
        class: "weft-guide",
        x1: colX(0) - 34,
        y1: rowY(i),
        x2: colX(warp.length - 1) + 34,
        y2: rowY(i),
      },
      svg,
    );
  }

  // 2. Warp: one thread per domain, over the weft.
  const warps = new Map();
  const labels = new Map();
  for (const [i, d] of warp.entries()) {
    const x = colX(i);
    const y1 = TOP - 34;
    const y2 = H - 10;
    const line = el(
      "line",
      {
        class: "warp",
        x1: x,
        y1,
        x2: x,
        y2,
        stroke: colorOf(d.id),
        "stroke-width": 5,
        "stroke-linecap": "round",
        style: `--len:${y2 - y1}px; --delay:${i * 55}ms`,
      },
      svg,
    );
    warps.set(d.id, line);

    const text = el("text", { class: "axis-domain", x, y: TOP - 44, fill: colorOf(d.id) }, svg);
    text.textContent = d.id;
    labels.set(d.id, text);
  }

  /* 3. The links — what the picture is for.

        A phase is one pass of the shuttle, and the systems it draws from are
        what that pass ties together: `parties` joins ERP to MES, `catalog`
        joins PLM to ERP. Drawing the pick at full width said nothing, because
        every row then looked identical and connected everything to everything.
        A link spans from the leftmost to the rightmost domain the phase
        touches, so its length is the reach of that pass — and five of the
        eight phases draw from a single domain, which is why they have no link
        at all. That is the fact, not an omission.

        Where a link passes a domain the phase does not use, the weft goes over
        and the warp is broken: casing first so the thread is cut cleanly, then
        the weft redrawn across the gap. This is the interlacing, and it now
        appears only where it means something.

        Redrawn on every toggle, because switching MES off genuinely shortens
        the `parties` pass. */
  const OVER = 13;
  const links = el("g", { class: "links" }, svg);

  const drawLinks = () => {
    while (links.firstChild) links.removeChild(links.firstChild);

    for (const [pi, p] of phases.entries()) {
      const cols = data.pipeline
        .filter((s) => s.phase === p.id && on.has(s.domain))
        .map((s) => domainIndex.get(s.domain));
      if (cols.length < 2) continue;

      const lo = Math.min(...cols);
      const hi = Math.max(...cols);
      const y = rowY(pi);
      const touched = new Set(cols);

      el("line", { class: "weft-link", x1: colX(lo), y1: y, x2: colX(hi), y2: y }, links);

      for (let di = lo + 1; di < hi; di++) {
        if (touched.has(di)) continue;
        const x = colX(di);
        const span = { x1: x - OVER, y1: y, x2: x + OVER, y2: y };
        el("line", { class: "weft-clear", ...span }, links);
        el("line", { class: "weft-over", ...span }, links);
      }
    }
  };

  /* 4. Ties: a domain with `inlineIn` never gets a pass of its own — its
        records are emitted inside the host's. Logistics is the whole reason
        this notation is honest rather than tidy. */
  const ties = [];
  for (const d of domains) {
    for (const hostId of d.inlineIn) {
      const hostSteps = data.pipeline.filter((s) => s.domain === hostId);
      const step = hostSteps[hostSteps.length - 1];
      if (!step) continue;
      const y = rowY(phaseIndex.get(step.phase));
      const x1 = colX(domainIndex.get(hostId));
      const x2 = colX(domainIndex.get(d.id));
      const tie = el(
        "path",
        {
          class: "tie",
          d: `M ${x1} ${y} C ${(x1 + x2) / 2} ${y - 22}, ${(x1 + x2) / 2} ${y - 22}, ${x2} ${y}`,
          fill: "none",
          stroke: colorOf(d.id),
          "stroke-width": 2,
          "stroke-dasharray": "1 5",
          "stroke-linecap": "round",
        },
        svg,
      );
      ties.push({ node: tie, domain: d.id, host: hostId });
    }
  }

  // 5. Crossings: the warp bound over the weft, numbered in generation order.
  const knots = [];
  for (const step of data.pipeline) {
    const x = colX(domainIndex.get(step.domain));
    const y = rowY(phaseIndex.get(step.phase));
    const g = el(
      "g",
      {
        class: "cross",
        style: `--delay:${(reduced ? 0 : 420) + step.step * 62}ms; transform-origin:${x}px ${y}px`,
      },
      svg,
    );
    el(
      "rect",
      {
        x: x - 20,
        y: y - 11,
        width: 40,
        height: 22,
        rx: 3,
        fill: colorOf(step.domain),
      },
      g,
    );
    const num = el("text", { class: "cross__num", x, y: y + 1, fill: "#ffffff" }, g);
    num.textContent = String(step.step);
    knots.push({ node: g, domain: step.domain });
  }

  /* ------------------------------------------------------------- controls */

  const controls = document.querySelector(".loom__controls");

  for (const d of domains) {
    const isOptional = optional.has(d.id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "thread-toggle";
    btn.style.setProperty("--thread", colorOf(d.id));
    btn.setAttribute("aria-pressed", "true");
    if (!isOptional) btn.disabled = true;

    const swatch = document.createElement("span");
    swatch.className = "thread-toggle__swatch";
    btn.appendChild(swatch);

    const name = document.createElement("span");
    name.textContent = d.label;
    btn.appendChild(name);

    if (!isOptional) {
      const note = document.createElement("span");
      note.className = "thread-toggle__note";
      note.textContent = "core";
      btn.appendChild(note);
    }

    if (isOptional) {
      btn.addEventListener("click", () => {
        const next = btn.getAttribute("aria-pressed") !== "true";
        btn.setAttribute("aria-pressed", String(next));
        if (next) on.add(d.id);
        else on.delete(d.id);
        applyDependencies();
        render();
      });
    }

    controls.appendChild(btn);
  }

  const buttonFor = (id) =>
    [...controls.querySelectorAll(".thread-toggle")][domains.findIndex((d) => d.id === id)];

  /* Dependencies are closed here for the same reason the generator closes
     them: selecting CAD without PLM is not a smaller enterprise, it is an
     incoherent one. The generator reports the addition rather than applying
     it silently, so the toggle visibly follows. */
  function applyDependencies() {
    let changed = true;
    while (changed) {
      changed = false;
      for (const d of domains) {
        if (!on.has(d.id)) continue;
        for (const dep of d.dependencies) {
          if (!on.has(dep)) {
            on.add(dep);
            changed = true;
          }
        }
      }
    }
    for (const d of domains) {
      if (!optional.has(d.id)) continue;
      buttonFor(d.id).setAttribute("aria-pressed", String(on.has(d.id)));
    }
  }

  /* --------------------------------------------------------------- readout */

  const readouts = new Map(
    [...document.querySelectorAll("[data-readout]")].map((n) => [n.dataset.readout, n]),
  );
  const fmt = new Intl.NumberFormat("en-GB");

  function stateKey() {
    return data.optional.map((d) => (on.has(d) ? "1" : "0")).join("");
  }

  function render() {
    for (const d of domains) {
      const live = on.has(d.id);
      warps.get(d.id).classList.toggle("warp--off", !live);
      labels.get(d.id).classList.toggle("axis-domain--off", !live);
    }
    for (const k of knots) k.node.classList.toggle("cross--off", !on.has(k.domain));
    for (const t of ties) {
      t.node.style.opacity = on.has(t.domain) && on.has(t.host) ? "1" : "0";
    }
    drawLinks();

    const state = data.states[stateKey()];
    if (!state) return;

    for (const [key, node] of readouts) {
      const next = fmt.format(state[key]);
      if (node.textContent === next) continue;
      node.textContent = next;
      node.dataset.changed = "false";
      // Restart the highlight even when two changes land in the same frame.
      void node.offsetWidth;
      node.dataset.changed = "true";
    }
  }

  /* ---------------------------------------------------------- domain table */

  const tbody = document.querySelector(".domains tbody");
  if (tbody) {
    for (const d of domains) {
      const tr = document.createElement("tr");

      const name = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = "domains__name";
      badge.style.setProperty("--thread", colorOf(d.id));
      badge.textContent = d.id;
      name.appendChild(badge);
      if (d.required) {
        const core = document.createElement("span");
        core.className = "domains__core";
        core.textContent = " core";
        name.appendChild(core);
      }
      tr.appendChild(name);

      const deps = document.createElement("td");
      deps.className = d.dependencies.length ? "domains__deps" : "domains__deps domains__deps--none";
      deps.textContent = d.dependencies.length ? d.dependencies.join(", ") : "—";
      tr.appendChild(deps);

      const gives = document.createElement("td");
      gives.className = "domains__gives";
      gives.textContent = `${d.contributes.length} entity type${d.contributes.length === 1 ? "" : "s"}`;
      tr.appendChild(gives);

      tbody.appendChild(tr);
    }
  }

  /* ------------------------------------------------------------------ misc */

  /* Whether the draft overflows depends on the viewport, so the affordance is
     set from the measured element rather than guessed at a breakpoint. */
  const scroller = document.querySelector(".loom__scroll");
  const swipe = document.querySelector(".loom__swipe");
  const measureOverflow = () => {
    const over = scroller.scrollWidth > scroller.clientWidth + 2;
    scroller.dataset.overflow = String(over);
    if (swipe) swipe.hidden = !over;
  };
  measureOverflow();
  window.addEventListener("resize", measureOverflow, { passive: true });

  // The interactive graph is only in the deploy when `npm run graph` has run.
  const graphLink = document.getElementById("graph-link");
  if (graphLink && !data.hasGraph) graphLink.hidden = true;

  for (const btn of document.querySelectorAll("[data-copy]")) {
    const label = btn.querySelector(".clone__label");
    btn.addEventListener("click", async () => {
      const text = document.querySelector(btn.dataset.copy).textContent.trim();
      try {
        await navigator.clipboard.writeText(text);
        label.textContent = "Copied";
      } catch {
        label.textContent = "Press ⌘C";
      }
      setTimeout(() => {
        label.textContent = "Copy";
      }, 1800);
    });
  }

  render();

  /* One orchestrated moment: the cloth weaves itself in generation order.
     Under reduced motion it is simply already woven. */
  if (!reduced) {
    svg.dataset.weaving = "true";
    setTimeout(() => delete svg.dataset.weaving, 2200);
  }
})();
