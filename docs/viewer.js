/* global pdfjsLib */
(() => {
  // Worker from CDN (must match version above)
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.js";

  const $ = (id) => document.getElementById(id);

  const canvas = $("canvas");
  const ctx = canvas.getContext("2d", { alpha: true });

  const prevBtn = $("prev");
  const nextBtn = $("next");
  const zoomInBtn = $("zoomIn");
  const zoomOutBtn = $("zoomOut");
  const fitBtn = $("fit");
  const fsBtn = $("fs");

  const pageNumEl = $("pageNum");
  const pageCountEl = $("pageCount");
  const loadingEl = $("loading");
  const stageEl = $("stage");
  const driveEl = $("driveLink");

  let docs = [];
  let docPageStarts = [];
  let totalPages = 0;

  let pageNum = 1;   // global page number
  let scale = 1.0;
  let fitMode = true;
  let renderTask = null;
  let isRendering = false;

  function showLoading(show) {
    loadingEl.style.display = show ? "flex" : "none";
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function getParams() {
    const url = new URL(window.location.href);
    const filesParam = url.searchParams.get("files"); // pipe-separated
    const fileParam = url.searchParams.get("file");
    const driveParam = url.searchParams.get("drive") || "";

    const files = filesParam
      ? filesParam.split("|").map(s => s.trim()).filter(Boolean)
      : [fileParam || ""];

    return { files, driveParam };
  }

  function stageFitScale(viewport) {
    const pad = 18;
    const availW = Math.max(1, stageEl.clientWidth - pad * 2);
    const availH = Math.max(1, stageEl.clientHeight - pad * 2);
    return Math.min(availW / viewport.width, availH / viewport.height);
  }

  function mapGlobalToLocal(globalPage) {
    const g = clamp(globalPage, 1, totalPages);
    let docIndex = 0;

    for (let i = 0; i < docPageStarts.length; i++) {
      const start = docPageStarts[i];
      const nextStart = (i + 1 < docPageStarts.length) ? docPageStarts[i + 1] : totalPages;
      if ((g - 1) >= start && (g - 1) < nextStart) {
        docIndex = i;
        break;
      }
    }

    const localZeroBased = (g - 1) - docPageStarts[docIndex];
    return { docIndex, localPage: localZeroBased + 1 };
  }

  async function renderPage(globalNum) {
    if (!docs.length || isRendering) return;

    isRendering = true;
    showLoading(true);

    if (renderTask) {
      try { renderTask.cancel(); } catch (_) {}
      renderTask = null;
    }

    const { docIndex, localPage } = mapGlobalToLocal(globalNum);
    const doc = docs[docIndex];
    const page = await doc.getPage(localPage);

    const baseViewport = page.getViewport({ scale: 1 });
    const useScale = fitMode ? stageFitScale(baseViewport) : scale;
    const viewport = page.getViewport({ scale: useScale });

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    renderTask = page.render({ canvasContext: ctx, viewport });

    try {
      await renderTask.promise;
    } catch (e) {
      // ignore cancel
    } finally {
      renderTask = null;
      showLoading(false);
      isRendering = false;
    }

    pageNumEl.textContent = String(pageNum);
    pageCountEl.textContent = String(totalPages);
    prevBtn.disabled = pageNum <= 1;
    nextBtn.disabled = pageNum >= totalPages;
  }

  function queueRender(num) {
    pageNum = clamp(num, 1, totalPages || 1);
    renderPage(pageNum);
  }

  function next() { queueRender(pageNum + 1); }
  function prev() { queueRender(pageNum - 1); }

  function zoomIn() {
    fitMode = false;
    scale = clamp(scale + 0.15, 0.4, 4);
    renderPage(pageNum);
  }

  function zoomOut() {
    fitMode = false;
    scale = clamp(scale - 0.15, 0.4, 4);
    renderPage(pageNum);
  }

  function fit() {
    fitMode = true;
    renderPage(pageNum);
  }

  function toggleFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement) el.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  // Swipe
  let touchStartX = null;
  stageEl.addEventListener("touchstart", (e) => {
    if (!e.touches?.length) return;
    touchStartX = e.touches[0].clientX;
  }, { passive: true });

  stageEl.addEventListener("touchend", (e) => {
    if (touchStartX === null) return;
    const endX = e.changedTouches?.[0]?.clientX ?? touchStartX;
    const dx = endX - touchStartX;
    touchStartX = null;

    if (Math.abs(dx) < 40) return;
    if (dx < 0) next();
    else prev();
  }, { passive: true });

  // Controls
  nextBtn.addEventListener("click", next);
  prevBtn.addEventListener("click", prev);
  zoomInBtn.addEventListener("click", zoomIn);
  zoomOutBtn.addEventListener("click", zoomOut);
  fitBtn.addEventListener("click", fit);
  fsBtn.addEventListener("click", toggleFullscreen);

  // Keyboard
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") next();
    if (e.key === "ArrowLeft") prev();
    if (e.key === "+" || e.key === "=") zoomIn();
    if (e.key === "-" || e.key === "_") zoomOut();
    if (e.key.toLowerCase() === "f") toggleFullscreen();
  });

  window.addEventListener("resize", () => { if (fitMode) renderPage(pageNum); });
  document.addEventListener("fullscreenchange", () => { if (fitMode) renderPage(pageNum); });

  // Boot
  (async function init() {
    const { files, driveParam } = getParams();

    // Drive link (optional)
    if (!driveParam) {
      driveEl.style.display = "none";
    } else {
      driveEl.href = driveParam;
      driveEl.style.display = "inline-flex";
    }

    showLoading(true);

    const errorEl = document.getElementById("error");
const showError = (msg) => {
  if (!errorEl) return;
  errorEl.style.display = "block";
  errorEl.textContent = msg;
};

try {
  docs = await Promise.all(files.map((f) =>
    pdfjsLib.getDocument({
      url: f,
      // These two options fix a lot of “loads forever” issues on static hosts:
      disableRange: true,
      disableStream: true
    }).promise
  ));
} catch (err) {
  console.error(err);
  showError("PDF failed to load.\\n\\n" + (err?.message || String(err)));
  showLoading(false);
  return;
}


    docPageStarts = [];
    totalPages = 0;
    for (const d of docs) {
      docPageStarts.push(totalPages);
      totalPages += d.numPages;
    }

    pageCountEl.textContent = String(totalPages);
    queueRender(1);
  })();
})();
