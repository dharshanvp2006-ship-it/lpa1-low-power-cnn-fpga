/* ========================================================================
   LPA-1 — low-power CNN accelerator on FPGA
   Report site behaviour. Vanilla JS, no dependencies.
   ======================================================================== */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var css = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };

  /* ------------------------------------------------------------------ 1
     Theme ------------------------------------------------------------ */
  var THEME_KEY = "lpa1-theme";
  var root = document.documentElement;
  var themeBtn = $("#themeToggle");

  function setTheme(mode) {
    root.setAttribute("data-theme", mode);
    var use = $("#i-sun");
    if (use) use.setAttribute("href", mode === "dark" ? "#i-sun" : "#i-moon");
    if (mode === "light") $('meta[name="theme-color"]').setAttribute("content", "#f5f8fb");
    else $('meta[name="theme-color"]').setAttribute("content", "#05080d");
    try { localStorage.setItem(THEME_KEY, mode); } catch (e) {}
    drawDonut();
  }

  var storedTheme = null;
  try { storedTheme = localStorage.getItem(THEME_KEY); } catch (e) {}
  setTheme(storedTheme || "dark");

  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      setTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
    });
  }

  /* ------------------------------------------------------------------ 2
     Nav: burger, sticky, scroll-spy, progress, to-top ----------------- */
  var nav = $("#nav");
  var navLinks = $("#navLinks");
  var burger = $("#burger");
  var progress = $("#progress");
  var toTop = $("#toTop");
  var spyTargets = $$("[data-spy]");

  if (burger && navLinks) {
    burger.addEventListener("click", function () {
      var open = navLinks.classList.toggle("open");
      burger.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    });
    navLinks.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        navLinks.classList.remove("open");
        burger.setAttribute("aria-label", "Open navigation");
      }
    });
  }

  var ticking = false;
  function onScroll() {
    var y = window.scrollY || document.documentElement.scrollTop;
    var h = document.documentElement.scrollHeight - window.innerHeight;
    if (progress) progress.style.width = (h > 0 ? (y / h) * 100 : 0) + "%";
    if (nav) nav.classList.toggle("stuck", y > 12);
    if (toTop) toTop.classList.toggle("show", y > 620);

    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(function () {
        var line = y + (window.innerHeight * 0.32);
        var current = null;
        spyTargets.forEach(function (a) {
          var sec = document.getElementById(a.getAttribute("data-spy"));
          if (sec && sec.offsetTop <= line) current = a;
        });
        spyTargets.forEach(function (a) { a.classList.toggle("active", a === current); });
        ticking = false;
      });
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();

  if (toTop) toTop.addEventListener("click", function () { window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" }); });

  /* ------------------------------------------------------------------ 3
     Reveal on scroll + count-up --------------------------------------- */
  var revealables = $$(".reveal");

  if ("IntersectionObserver" in window) {
    var ro = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add("in");
          $$("[data-count]", en.target).forEach(function (n) { countUp(n); });
          ro.unobserve(en.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    revealables.forEach(function (el) { ro.observe(el); });
  } else {
    revealables.forEach(function (el) {
      el.classList.add("in");
      $$("[data-count]", el).forEach(function (n) { countUp(n); });
    });
  }

  function countUp(node) {
    if (node.dataset.done) return;
    node.dataset.done = "1";
    var target = parseFloat(node.dataset.count);
    var dec = parseInt(node.dataset.dec || "0", 10);
    var suffix = node.dataset.suffix || "";
    if (reduceMotion) { node.textContent = target.toFixed(dec) + suffix; return; }
    var dur = 1100, t0 = performance.now();
    (function step(now) {
      var p = Math.min(1, (now - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      node.textContent = (target * eased).toFixed(dec) + suffix;
      if (p < 1) requestAnimationFrame(step);
      else node.textContent = target.toFixed(dec) + suffix;
    })(t0);
  }

  /* ------------------------------------------------------------------ 4
     Architecture block inspector -------------------------------------- */
  var BLOCKS = {
    host: {
      title: "Cortex-A53 PS",
      icon: "i-cpu",
      body: "Runs the command scheduler, the pre-processing kernel and post-processing (average pool, softmax, NMS). It never touches the datapath directly — it pushes a stream of layer descriptors into the command FIFO and then idles, which is what makes the low inter-frame power achievable.",
      specs: [["Clock", "667 MHz"], ["Role", "control only"], ["Idle state", "WFI + DDR low-power"], ["Inter-frame", "0.38 W total"]]
    },
    sched: {
      title: "Layer scheduler",
      icon: "i-flow",
      body: "Walks the descriptor chain and emits, per cycle, the write address for every memory port plus a per-PE valid bit. It is the only block that knows the tiling; the compute blocks are pure combinational datapaths with no state beyond their accumulators.",
      specs: [["Descriptors in flight", "4"], ["Valid propagation", "1 cycle / PE stage"], ["Formal-verified", "yes (FIFO + walker)"]]
    },
    wload: {
      title: "Weight loader",
      icon: "i-layers",
      body: "Streams the next weight tile into the ping half of URAM while the array consumes the pong half. Because the load is a bulk AXI read with burst length 64, the fabric is never stalled waiting for DDR — and the write ports are held still between tiles, which is where the memory-split saving comes from.",
      specs: [["Ping / pong", "64 kB + 64 kB"], ["Burst length", "64 beats"], ["Stall cycles", "0"]]
    },
    pe: {
      title: "PE array 8 × 16",
      icon: "i-chip",
      body: "The compute core. Weight-stationary systolic: weights are pushed into per-PE shift registers once, then held while reductions stream through. Each lane has its own integrated clock gate, an operand-isolation clamp on both inputs, and a zero-operand test that suppresses the multiply entirely.",
      specs: [["Lanes", "128 INT8 MAC"], ["Mapping", "2 MAC / DSP48E2"], ["DSPs", "68 (2.7 % of device)"], ["Frequency", "200 MHz"], ["PL dynamic", "1.06 W of 1.79 W"], ["Zero-skip rate", "24 % of issued MACs"]]
    },
    wsram: {
      title: "Weight SRAM",
      icon: "i-layers",
      body: "Banked across 8 independent URAM ports so a full 128-lane weight fetch completes in a single cycle. Banking also splits the read and write halves physically, which removes the read-during-write hazard and the extra sequential logic that normally drives memory-switching power.",
      specs: [["Capacity", "16 Mb (56 URAM)"], ["Ports", "8 independent"], ["Holds", "all of MobileNetV2-1.0"]]
    },
    actbuf: {
      title: "Activation line buffers",
      icon: "i-flow",
      body: "Classic sliding-window line buffers in ping-pong BRAM. Rows of the input feature map are held across 16 banks so 16 activation lanes can be presented in parallel. Depthwise layers reuse the same buffers with a single-lane read, so no extra storage is needed for the separable-convolution path.",
      specs: [["Capacity", "36 Mb (96 BRAM)"], ["Banks", "16"], ["Depthwise reuse", "single lane"]]
    },
    req: {
      title: "Requantise + ReLU6",
      icon: "i-gauge",
      body: "Converts the INT32 accumulator to INT8 output and applies ReLU6 in LUTs, not DSPs. Freeing 34 DSP slices from this stage is worth 0.26 W, and the LUT fabric switches less than a DSP multiplier at this word length. Gated on valid, because the clamp comparator is the highest-switching node here.",
      specs: [["Implementation", "LUT (2 LUT / MAC)"], ["Function", "y = clamp(x·M≫S + Z, 0, 6)"], ["DSPs saved", "34"], ["LUTs", "6 120"]]
    },
    outbuf: {
      title: "Output buffer",
      icon: "i-layers",
      body: "Holds a full output tile so the DMA can drain it to DDR in row-stripe order while the next tile computes. This is what keeps the DDR read stream of the next layer perfectly overlapped and the array at 82 % MAC utilisation instead of roughly 40 %.",
      specs: [["Capacity", "1.1 Mb (30.5 BRAM)"], ["Drain order", "row stripe"], ["Overhead", "0 stall cycles"]]
    },
    pmu: {
      title: "Power manager",
      icon: "i-bolt",
      body: "The only block permitted to ungate the fabric. It owns three independent clock-gate domains, the DSP power-down control, and the layer-wise DVFS governor. Layer descriptors carry a power_budget field, so latency-tolerant layers run at the floor clock and save energy rather than finishing early and idling hot.",
      specs: [["Clock-gate domains", "3"], ["DSP power-down", "DPSEC between frames"], ["Governor range", "125 – 200 MHz"], ["Quiesce latency", "3 cycles"]]
    },
    post: {
      title: "Post-processing",
      icon: "i-target",
      body: "Average pooling and softmax are folded into the requantise stage to avoid an extra pass over the feature maps. Detection NMS runs on the PS in HLS because it is data-dependent and would otherwise force a large, rarely-active FSM into the fabric.",
      specs: [["Pooling", "folded into requantise"], ["Softmax", "LUT exp approximation"], ["NMS", "PS, HLS"]]
    }
  };

  var archInfo = $("#archInfo");
  var archSvg = $("#archSvg");

  function selectBlock(key, el) {
    var d = BLOCKS[key];
    if (!d || !archInfo) return;
    $$(".blk", archSvg).forEach(function (b) { b.classList.toggle("sel", b === el); });
    $("#aiTitle").textContent = d.title;
    $(".ai-ic use", archInfo).setAttribute("href", "#" + d.icon);
    $("#aiBody").innerHTML = d.body;
    var dl = $("#aiSpecs");
    dl.innerHTML = d.specs.map(function (s) {
      return "<div><dt>" + s[0] + "</dt><dd>" + s[1] + "</dd></div>";
    }).join("");
  }

  if (archSvg) {
    $$(".blk", archSvg).forEach(function (b) {
      var key = b.getAttribute("data-block");
      b.addEventListener("click", function () { selectBlock(key, b); });
      b.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectBlock(key, b); }
      });
    });
    selectBlock("host", $('[data-block="host"]', archSvg));
  }

  /* ------------------------------------------------------------------ 5
     RTL tabs + lightweight syntax highlighting ------------------------ */
  var rtlTabs = $("#rtlTabs");
  if (rtlTabs) {
    rtlTabs.addEventListener("click", function (e) {
      var btn = e.target.closest(".tab");
      if (!btn) return;
      $$(".tab", rtlTabs).forEach(function (t) { t.classList.toggle("active", t === btn); });
      $$(".tab-panel").forEach(function (p) {
        p.classList.toggle("active", p.getAttribute("data-panel") === btn.getAttribute("data-tab"));
      });
    });
  }

  var KEYWORDS = {
    verilog: "module endmodule input output inout wire reg logic bit int integer parameter localparam assign always_ff always_comb always_latch always initial if else begin end for genvar function endfunction return property endproperty assert disable iff case endcase default signed static typedef struct packed",
    tcl: "set if else foreach proc return source puts open close",
    cpp: "if else for while return void const constexpr struct static inline unsigned int char bool true false long"
  };
  var TYPES = {
    verilog: "posedge negedge",
    tcl: "",
    cpp: "uint8_t uint16_t uint32_t int8_t int16_t int32_t size_t vector string"
  };

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function highlight(src, lang) {
    var kw = (KEYWORDS[lang] || KEYWORDS.verilog).split(/\s+/);
    var ty = (TYPES[lang] || "").split(/\s+/);
    var lineComment = lang === "tcl" ? "#[^\\n]*" : "//[^\\n]*";
    var parts = ['(?<c>' + lineComment + ')'];
    if (lang !== "tcl") parts.push("(?<pc>/\\*[\\s\\S]*?\\*/)");
    parts.push('(?<s>"[^"\\n]*")');
    parts.push("(?<k>\\$?[A-Za-z_][A-Za-z0-9_]*)");
    parts.push("(?<n>\\b\\d[\\d_]*(?:\\.[\\d_]+)?(?:'[bodhBODH][0-9a-fA-FxXzZ_]+)?)");

    var re = new RegExp(parts.join("|"), "g");
    var out = "", last = 0, m;

    function cls(tok) {
      if (kw.indexOf(tok) >= 0) return "tk-k";
      if (ty.indexOf(tok) >= 0) return "tk-t";
      if (tok.charAt(0) === "$") return "tk-f";
      if (/^[0-9]/.test(tok)) return "tk-n";
      if (/^[A-Z][A-Z0-9_]+$/.test(tok)) return "tk-t";
      return "tk-p";
    }

    while ((m = re.exec(src)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      out += esc(src.slice(last, m.index));
      var g = m.groups || {};
      var tok = m[0];
      var kind = g.c || g.pc ? "tk-c" : g.s ? "tk-s" : g.n ? "tk-n" : cls(tok);
      out += '<span class="' + kind + '">' + esc(tok) + "</span>";
      last = m.index + tok.length;
    }
    out += esc(src.slice(last));
    return out;
  }

  function langFor(block) {
    var l = $(".cb-lang", block);
    var t = l ? l.textContent.toLowerCase() : "";
    if (t.indexOf("tcl") >= 0) return "tcl";
    if (t.indexOf("c++") >= 0) return "cpp";
    return "verilog";
  }

  $$(".code-block pre").forEach(function (pre) {
    var block = pre.closest(".code-block");
    var src = pre.textContent;
    pre.innerHTML = "<code>" + highlight(src, langFor(block)) + "</code>";
  });

  /* ------------------------------------------------------------------ 6
     Power waterfall --------------------------------------------------- */
  var BASE_DYN = 3.12;          // W — PL dynamic of the unoptimised baseline
  var FLOOR_OPT = 2.52;         // W — PS 1.92 + PL static 0.60, optimised design
  var FLOOR_BASE = 3.30;        // W — PS 2.20 + PL static 1.10, unoptimised design
  var THROUGHPUT = 42.3;        // GOPS at 200 MHz

  var TECHS = [
    { id: "quant",    label: "T1 lane\npacking",  cut: 0.16 },
    { id: "depth",    label: "T2 depthwise\n+ pruning", cut: 0.11 },
    { id: "local",    label: "T3 stationary\nlocality",  cut: 0.26 },
    { id: "memsplit", label: "T4 memory\nsplit",      cut: 0.21 },
    { id: "ecg",      label: "T5 enhanced\nclock gating", cut: 0.31 },
    { id: "iso",      label: "T6 isolation\n+ LECE",    cut: 0.28 }
  ];
  var ALL_CUT = TECHS.reduce(function (a, t) { return a + t.cut; }, 0); // 1.33 W

  var wfChart = $("#wfChart");
  var wfCount = $("#wfCount");
  var wfMeter = $("#wfMeter");
  var wfFoot = $("#wfFoot");

  function fmt(v, d) { return v.toFixed(d === undefined ? 2 : d); }

  function setMetric(sel, value) {
    var n = $(sel);
    if (n) n.textContent = value;
  }

  function renderWaterfall() {
    if (!wfChart) return;
    var scaleMax = BASE_DYN * 1.02;
    var bars = '<div class="wf-col on"><div class="wf-bars">' +
      '<div class="wf-bar base" style="height:100%"></div></div>' +
      '<div class="wf-val">3.12 W</div><div class="wf-lab">Baseline<br>PL dynamic</div></div>';

    var running = BASE_DYN;
    var enabled = 0, saved = 0;

    TECHS.forEach(function (t) {
      var box = $('label[data-tech="' + t.id + '"] input');
      var on = !!(box && box.checked);
      var cut = on ? t.cut : 0;
      var after = running - cut;
      if (on) { enabled++; saved += cut; }
      bars += '<div class="wf-col' + (on ? " on" : "") + '"><div class="wf-bars">' +
        '<div class="wf-bar ' + (on ? "cut" : "keep") + '" style="height:' + (after / scaleMax * 100) + '%"></div>' +
        (cut > 0 ? '<div class="wf-bar cut" style="height:' + (cut / scaleMax * 100) + '%;opacity:.45"></div>' : "") +
        '</div><div class="wf-val">' + (on ? "−" + fmt(cut) : "off") + '</div>' +
        '<div class="wf-lab">' + t.label.replace("\n", "<br>") + "</div></div>";
      running = after;
    });

    var dyn = running;
    // The PS and static rails follow the design: a busier fabric holds the
    // A53 in a shallower idle state and leaves more configuration bits
    // switching. 0 / 6 techniques therefore reproduces the 6.42 W baseline
    // exactly, and 6 / 6 reproduces the 4.31 W shipped result.
    var floor = FLOOR_OPT + (FLOOR_BASE - FLOOR_OPT) * (1 - saved / ALL_CUT);
    var total = floor + dyn;
    var ee = THROUGHPUT / total;
    var pct = (saved / ALL_CUT) * 100;

    bars += '<div class="wf-col on"><div class="wf-bars">' +
      '<div class="wf-bar keep" style="height:' + (dyn / scaleMax * 100) + '%"></div></div>' +
      '<div class="wf-val">' + fmt(dyn) + ' W</div><div class="wf-lab">Residual<br>PL dynamic</div></div>';

    wfChart.innerHTML = bars;
    wfCount.textContent = enabled + " / " + TECHS.length;
    if (wfMeter) wfMeter.style.width = pct + "%";

    var dynEl = $(".wf-side .wf-metric:nth-child(2) b span");
    var totEl = $(".wf-side .wf-metric:nth-child(3) b span");
    var eeEl = $(".wf-side .wf-metric:nth-child(4) b span");
    if (dynEl) dynEl.textContent = fmt(dyn);
    if (totEl) totEl.textContent = fmt(total);
    if (eeEl) eeEl.textContent = fmt(ee, 1);

    if (wfFoot) {
      wfFoot.innerHTML = enabled === TECHS.length
        ? "All six techniques enabled — the LPA-1 configuration. " + fmt(ALL_CUT) + " W removed, " +
          ((1 - dyn / BASE_DYN) * 100).toFixed(1) + " % of PL dynamic power."
        : enabled + " of " + TECHS.length + " techniques enabled. " + fmt(saved) +
          " W of the available " + fmt(ALL_CUT) + " W recovered (" + pct.toFixed(0) +
          " % of the low-power budget spent).";
    }
  }

  $$('label[data-tech] input').forEach(function (cb) {
    cb.addEventListener("change", renderWaterfall);
  });
  var wfReset = $("#wfReset");
  if (wfReset) {
    wfReset.addEventListener("click", function () {
      $$('label[data-tech] input').forEach(function (cb) { cb.checked = false; });
      renderWaterfall();
    });
  }
  renderWaterfall();

  /* ------------------------------------------------------------------ 7
     Power donut ------------------------------------------------------ */
  var donut = $("#donut");
  function drawDonut() {
    if (!donut) return;
    var parts = [
      { c: css("--cyan"), v: 44.5 },
      { c: css("--violet"), v: 41.5 },
      { c: css("--amber"), v: 13.9 }
    ];
    var R = 52, CIRC = 2 * Math.PI * R;
    var off = 0, html = "";
    parts.forEach(function (p) {
      var len = CIRC * (p.v / 100);
      html += '<circle cx="60" cy="60" r="' + R + '" fill="none" stroke="' + p.c +
        '" stroke-width="18" stroke-dasharray="' + len + " " + (CIRC - len) +
        '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 60 60)" />';
      off += len;
    });
    html += '<text x="60" y="56" text-anchor="middle" fill="' + css("--txt") +
      '" font-size="21" font-weight="700" font-family="Sora,sans-serif">4.31</text>' +
      '<text x="60" y="72" text-anchor="middle" fill="' + css("--txt-3") +
      '" font-size="10" font-family="JetBrains Mono,monospace">W total</text>';
    donut.innerHTML = html;
  }
  drawDonut();

  /* ------------------------------------------------------------------ 8
     Precision sweep --------------------------------------------------- */
  var PREC = {
    "8":   { dsp: 68,  lut: 31420, bram: 186.5, pw: 1.79, tp: 42.3, acc: 71.2, util: 82, note: "the shipping point" },
    "48":  { dsp: 68,  lut: 28600, bram: 156.0, pw: 1.48, tp: 42.3, acc: 71.3, util: 82, note: "weight storage halves" },
    "44":  { dsp: 32,  lut: 27900, bram: 98.0,  pw: 1.24, tp: 84.6, acc: 69.4, util: 84, note: "4 lanes / DSP — throughput doubles" },
    "28":  { dsp: 68,  lut: 24100, bram: 124.0, pw: 1.31, tp: 42.3, acc: 69.4, util: 82, note: "activation bound, not weight bound" },
    "816": { dsp: 92,  lut: 41200, bram: 214.0, pw: 2.24, tp: 34.1, acc: 71.6, util: 80, note: "highest fidelity, worst efficiency" },
    "24":  { dsp: 32,  lut: 19300, bram: 72.0,  pw: 0.78, tp: 84.6, acc: 64.9, util: 84, note: "aggressive — needs per-domain calibration" }
  };
  var DEV = { dsp: 2520, lut: 274080, bram: 912 };
  var ACC_FLOAT = 71.8;

  var seg = $("#precSeg");
  function renderPrec(key) {
    var d = PREC[key];
    if (!d) return;
    setMetric("#p-dsp", d.dsp);
    setMetric("#p-dsp-n", (d.dsp / DEV.dsp * 100).toFixed(1) + " % of device");
    setMetric("#p-lut", d.lut.toLocaleString("en-US").replace(/,/g, " "));
    setMetric("#p-lut-n", (d.lut / DEV.lut * 100).toFixed(1) + " % of device");
    setMetric("#p-bram", fmt(d.bram, 1));
    setMetric("#p-bram-n", (d.bram / DEV.bram * 100).toFixed(1) + " % of device");
    setMetric("#p-pw", fmt(d.pw));
    setMetric("#p-pw-n", d.pw < 1.79
      ? ((1 - d.pw / BASE_DYN) * 100).toFixed(1) + " % below the 3.12 W baseline"
      : ((1 - d.pw / BASE_DYN) * 100).toFixed(1) + " % vs the 3.12 W baseline");
    setMetric("#p-tp", fmt(d.tp, 1));
    setMetric("#p-tp-n", d.util + " % MAC utilisation · " + d.note);

    var total = FLOOR_OPT + d.pw;
    setMetric("#p-ee", fmt(d.tp / total, 1));
    setMetric("#p-ee-n", "total " + fmt(total) + " W · baseline 6.6 TOPS/W");

    setMetric("#p-acc", fmt(d.acc, 1));
    var fill = $("#p-acc-fill"), mark = $("#p-acc-float");
    if (fill) fill.style.width = (d.acc / 100 * 100) + "%";
    if (mark) mark.style.left = ACC_FLOAT + "%";
    var delta = d.acc - ACC_FLOAT;
    setMetric("#p-acc-n", "float baseline 71.8 % · Δ " + (delta >= 0 ? "+" : "−") + fmt(Math.abs(delta), 1) + " pt" +
      (Math.abs(delta) > 1 ? " — outside the G4 budget" : " — inside the G4 budget"));

    if (seg) $$(".seg-b", seg).forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-prec") === key); });
  }

  if (seg) {
    seg.addEventListener("click", function (e) {
      var b = e.target.closest(".seg-b");
      if (b) renderPrec(b.getAttribute("data-prec"));
    });
    renderPrec("8");
  }

  /* ------------------------------------------------------------------ 9
     DVFS sweep ------------------------------------------------------- */
  var range = $("#freqRange");
  var dvfsChart = $("#dvfsChart");

  // Characterised voltage points; the governor is clamped to these.
  var VPTS = [[100, 0.85], [150, 0.90], [200, 0.95], [250, 0.95], [300, 1.00]];
  var P_DYN_200 = 1.79, P_STATIC_200 = 0.60, P_PS_200 = 1.92, T_200 = 42.3, F_200 = 200;

  function voltAt(f) {
    for (var i = 0; i < VPTS.length - 1; i++) {
      if (f <= VPTS[i + 1][0]) {
        var a = VPTS[i], b = VPTS[i + 1];
        var k = (f - a[0]) / (b[0] - a[0]);
        return a[1] + k * (b[1] - a[1]);
      }
    }
    return VPTS[VPTS.length - 1][1];
  }

  function opPoint(f) {
    var v = voltAt(f);
    var pDyn = P_DYN_200 * (f / F_200) * Math.pow(v / 0.95, 2);
    var pStatic = P_STATIC_200 + 0.0004 * (f - F_200);
    var pPs = P_PS_200 + 0.0003 * (f - F_200);
    var total = pDyn + pStatic + pPs;
    var tp = T_200 * (f / F_200);
    var frameMs = 600 / tp;                     // 300 MMAC = 0.6 GOPS of work, divided by tp GOPS
    var shownMs = Math.round(frameMs * 10) / 10; // displayed precision, kept self-consistent with FPS
    return {
      f: f, v: v, total: total, tp: tp,
      ee: tp / total,
      frameMs: frameMs,
      fps: 1000 / shownMs,
      mj: total * (frameMs / 1000) * 1000
    };
  }

  function renderDvfs() {
    if (!range) return;
    var f = parseInt(range.value, 10);
    var cur = opPoint(f);
    setMetric("#freqOut", f + " MHz");
    setMetric("#d-pw", fmt(cur.total) + " W");
    setMetric("#d-tp", fmt(cur.tp, 1) + " GOPS");
    setMetric("#d-ee", fmt(cur.ee, 1) + " TOPS/W");
    setMetric("#d-ft", fmt(cur.frameMs, 1) + " ms");
    setMetric("#d-fps", Math.round(cur.fps) + " FPS");
    setMetric("#d-ej", fmt(cur.mj, 1) + " mJ");

    var steps = [];
    for (var s = 100; s <= 300; s += 25) steps.push(s);
    var maxPw = 0, maxTp = 0, maxEe = 0;
    steps.forEach(function (s) { var o = opPoint(s); maxPw = Math.max(maxPw, o.total); maxTp = Math.max(maxTp, o.tp); maxEe = Math.max(maxEe, o.ee); });
    var best = steps.map(opPoint).reduce(function (a, b) { return b.ee > a.ee ? b : a; });

    dvfsChart.innerHTML = steps.map(function (s) {
      var o = opPoint(s);
      var cls = s === f ? " cur" : "";
      return '<div class="dvfs-col' + cls + '" title="' + s + ' MHz — ' + fmt(o.total) + ' W, ' + fmt(o.ee, 1) + ' TOPS/W">' +
        '<div class="dvfs-bars">' +
        '<div class="dvfs-bar pw" style="height:' + (o.total / maxPw * 100) + '%"></div>' +
        '<div class="dvfs-bar tp" style="height:' + (o.tp / maxTp * 100) + '%"></div>' +
        '<div class="dvfs-bar ee" style="height:' + (o.ee / maxEe * 100) + '%"></div>' +
        '</div><div class="dvfs-lab">' + s + '</div></div>';
    }).join("");

    var note = $("#dvfsNote");
    if (note) {
      var cmp;
      if (f === 200) {
        cmp = "the shipped reference point";
      } else {
        var delta = (cur.mj / opPoint(200).mj - 1) * 100;
        cmp = (Math.abs(delta) < 0.5 ? "within 0.5 % of" : (delta > 0 ? delta.toFixed(1) + " % above" : Math.abs(delta).toFixed(1) + " % below")) +
              " the 200 MHz point at " + fmt(opPoint(200).mj, 1) + " mJ";
      }
      note.innerHTML = "At <b>" + f + " MHz / " + cur.v.toFixed(2) + " V</b> the frame costs <b>" +
        fmt(cur.mj, 1) + " mJ</b> (" + fmt(cur.frameMs, 1) + " ms, " + Math.round(cur.fps) + " FPS) — " + cmp +
        ". Peak efficiency on this device is <b>" + best.f + " MHz at " +
        fmt(best.ee, 1) + " TOPS/W</b>, because static power is a fixed tax: raising the clock makes the work finish sooner, and sooner is cheaper than slower-but-hot. " +
        "The shipped configuration is 200 MHz — the highest point that still meets the 30 FPS deadline with margin, and the only two endpoints with a measured rather than modelled power number.";
    }
  }

  if (range) {
    range.addEventListener("input", renderDvfs);
    renderDvfs();
  }

  /* ------------------------------------------------------------------ 10
     Misc: smooth in-page anchors for the mobile nav close state ------ */
  document.addEventListener("click", function (e) {
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute("href");
    if (id === "#" || id.length < 2) return;
    var t = document.querySelector(id);
    if (!t) return;
    e.preventDefault();
    var y = t.getBoundingClientRect().top + window.scrollY - (parseInt(getComputedStyle(root).getPropertyValue("--nav-h"), 10) || 66) - 14;
    window.scrollTo({ top: y, behavior: reduceMotion ? "auto" : "smooth" });
    history.replaceState(null, "", id);
  });
})();
