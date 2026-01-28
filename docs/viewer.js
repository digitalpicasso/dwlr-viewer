/* global pdfjsLib */
(() => {
  console.log("DWLR viewer.js loaded v8");

  // IMPORTANT: local worker (matches index.html)
  pdfjsLib.GlobalWorkerOptions.workerSrc = "pdfjs/pdf.worker.min.js";

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
  const errorEl = $("error");

  let docs = [];
  let docPageStarts = [];
  let totalPages = 0;

  let pageNum = 1;
  let scale = 1.0;
  let fitMode = true;
  let renderTask = null;
  let isRendering = false;

  /* ---------- helpers ---------- */

  function showLoading(show) {
    if (!loadingEl) return;
    loadingEl.style.display = show ? "flex" : "none";
  }

  function showError(msg) {
    if (!errorEl) return;
    errorEl.style.display = "block";
    errorEl.textContent = msg;
  }

  function hideError() {
    if (!errorEl) return;
    errorEl.style.display = "none";
    errorEl.textContent = "";
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function getParams() {
    const url = new URL(window.location.href);

    const filesParam = url.searchParams.get("files");
    const fileParam = url.searchParams.get("file");
    const driveParam = url.searchParams.get("drive") || "";

    const files = filesParam
      ? filesParam.split("|").map(s => s.trim()).filter(Boolean)
      : [fileParam || ""];

    const cleaned = files.map(f => (f || "").trim()).filter(Boolean);
    return { files: cleaned, driveParam };
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
      const nextStart = (i + 1 < docPageStarts.length)
        ? docPageStarts[i + 1]
        : totalPages;

      if ((g - 1) >= start && (g - 1) < nextStart) {
        docIndex = i;
        break;
      }
    }

    const localZero = (g - 1) - docPageStarts[docIndex];
    return { docIndex, localPage: localZero + 1 };
  }

  /* ---------- rendering ---------- */

  async function renderPage(globalNum) {
    if (!docs.length || isRendering) return;

    isRendering = true;
    showLoading(true);
    hideError();

    if (renderTask) {
      try { renderTask.cancel(); } catch {}
      renderTask = null;
    }

    try {
      const { docIndex, localPage } = mapGlobalToLocal(globalNum);
      const page = await docs[docIndex].getPage(localPage);

      const baseViewport = page.getViewport({ scale: 1 });
      const useScale = fitMode ? stageFitScale(baseViewport) : scale;
      const viewport = page.getViewport({ scale: useScale });

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      renderTask = page.render({ canvasContext: ctx, viewport });
      await renderTask.promise;

      pageNumEl.textContent = String(pageNum);
      pageCountEl.textContent = String(totalPages);
      prevBtn.disabled = pageNum <= 1;
      nextBtn.disabled = pageNum >= totalPages;
    } catch (err) {
      console.error(err);
      showError("Render failed.\n\n" + (err?.message || String(err)));
    } finally {
      renderTask = null;
      showLoading(false);
      isRendering = false;
    }
  }

  function queueRender(num) {
    pageNum = clamp(num, 1, totalPages || 1);
    renderPage(pageNum);
  }

  /* ---------- controls ---------- */

  const next = () => queueRender(pageNum + 1);
  const prev = () => queueRender(pageNum - 1);

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
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  /* ---------- events ---------- */

  nextBtn.addEventListener("click", next);
  prevBtn.addEventListener("click", prev);
  zoomInBtn.addEventListener("click", zoomIn);
  zoomOutBtn.addEventListener("click", zoomOut);
  fitBtn.addEventListener("click", fit);
  fsBtn.addEventListener("click", toggleFullscreen);

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") next();
    if (e.key === "ArrowLeft") prev();
    if (e.key === "+" || e.key === "=") zoomIn();
    if (e.key === "-" || e.key === "_") zoomOut();
    if (e.key.toLowerCase() === "f") toggleFullscreen();
  });

  window.addEventListener("resize", () => {
    if (fitMode) renderPage(pageNum);
  });

  /* ---------- boot ---------- */

  (async function init() {
    const { files, driveParam } = getParams();

    if (driveEl) {
      if (!driveParam) driveEl.style.display = "none";
      else {
        driveEl.href = driveParam;
        driveEl.style.display = "inline-flex";
      }
    }

    if (!files.length) {
      showError("No PDF provided.\n\nAdd ?file=... or ?files=...");
      return;
    }

    showLoading(true);
    hideError();

    try {
      docs = await Promise.all(
        files.map((url) =>
          pdfjsLib.getDocument({
            url,
            disableRange: true,
            disableStream: true,
            disableAutoFetch: true,
          }).promise
        )
      );
    } catch (err) {
      console.error(err);
      showError("PDF failed to load.\n\n" + (err?.message || String(err)));
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
