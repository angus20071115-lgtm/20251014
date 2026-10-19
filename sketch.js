/*
 * 高中數學選擇題測驗｜Google Sheets CSV 版
 *
 * 設定重點：
 * 1. 將 GOOGLE_SHEET_CSV_URL 改成 Google Sheets「發布到網路」的 CSV 網址。
 * 2. 支援：/pub?gid=...&single=true&output=csv，以及 /export?format=csv&gid=...。
 * 3. questions.csv 只是本地欄位格式範例；正式題庫仍從 Google Sheets 讀取。
 */
const sketch = (p) => {
  // ======== 請在這裡設定 Google Sheets CSV 網址 ========
  // 建議格式：
  // https://docs.google.com/spreadsheets/d/試算表ID/pub?gid=0&single=true&output=csv
  // 或：
  // https://docs.google.com/spreadsheets/d/試算表ID/export?format=csv&gid=0
  const GOOGLE_SHEET_CSV_URL ="https://docs.google.com/spreadsheets/d/e/2PACX-1vSzGUJkC-q1MGxpUWKw37T7EDnJ6HNiAj8QT8_oXKR-BzMoCMcz_kSM-SQh2rYcd_0Yq8xNVIIcZOMV/pub?gid=851229866&single=true&output=csv";

  const QUIZ_SIZE = 5;
  const REQUIRED_HEADERS = ["id", "question", "optiona", "optionb", "optionc", "optiond", "answer"];
  const CORRECT_COLOR = "#80ed99";
  const WRONG_COLOR = "#ffadad";
  const OPTION_COLOR = "#ffffff";
  const TEXT_COLOR = "#1e293b";
  const MUTED_COLOR = "#64748b";
  const CHINESE_FONT = "Chocolate Classical Sans";
  const LATIN_FONT = "Roboto Mono";

  let canvas;
  let actionButton;
  let diagnosticPanel;
  let questionBank = [];
  let quizQuestions = [];
  let currentQuestionIndex = 0;
  let correctCount = 0;
  let selectedOptionIndex = -1;
  let hasAnswered = false;
  let quizFinished = false;
  let isLoading = false;
  let loadFailed = false;
  let diagnostic = makeEmptyDiagnostic();
  let optionAreas = [];

  p.setup = () => {
    canvas = p.createCanvas(window.innerWidth, window.innerHeight);
    canvas.parent("canvas-root");
    canvas.elt.style.touchAction = "none";
    canvas.elt.addEventListener("pointerdown", handleCanvasPointer, { passive: false });

    actionButton = document.getElementById("action-button");
    diagnosticPanel = document.getElementById("diagnostic-panel");
    actionButton.addEventListener("click", handleActionButton);
    actionButton.hidden = true;
    p.noLoop();
    loadGoogleSheetQuestions();
  };

  p.draw = () => {
    p.background("#f1f5f9");
    if (isLoading) {
      hideDiagnosticPanel();
      drawLoadingScreen();
    } else if (loadFailed) {
      drawErrorBackground();
      showDiagnosticPanel();
    } else if (quizFinished) {
      hideDiagnosticPanel();
      drawResultScreen();
    } else if (quizQuestions.length > 0) {
      hideDiagnosticPanel();
      drawQuizScreen();
    }
    syncActionButton();
  };

  function makeEmptyDiagnostic() {
    return { url: "（尚未產生請求）", status: "尚未開始", detail: "", causes: [], steps: [] };
  }

  function setDiagnostic(data) {
    diagnostic = {
      url: data.url || "（沒有可用網址）",
      status: data.status || "未取得 HTTP 回應（可能在 fetch 前就失敗）",
      detail: data.detail || "",
      causes: data.causes || [],
      steps: data.steps || []
    };
  }

  function hideDiagnosticPanel() {
    if (diagnosticPanel) diagnosticPanel.hidden = true;
  }

  function showDiagnosticPanel() {
    if (!diagnosticPanel) return;
    diagnosticPanel.hidden = false;
    document.getElementById("diagnostic-url").textContent = diagnostic.url;
    document.getElementById("diagnostic-status").textContent = diagnostic.detail
      ? `${diagnostic.status}｜${diagnostic.detail}`
      : diagnostic.status;
    document.getElementById("diagnostic-causes").innerHTML = diagnostic.causes.map((item) => `<li>${escapeHTML(item)}</li>`).join("");
    document.getElementById("diagnostic-steps").innerHTML = diagnostic.steps.map((item) => `<li>${escapeHTML(item)}</li>`).join("");
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
  }

  // 將編輯網址或兩種發布 CSV 網址統一成可 fetch 的 CSV URL。
  function buildCSVURL(sourceURL) {
    const trimmedURL = String(sourceURL || "").trim();
    if (!trimmedURL || trimmedURL.includes("請貼上你的 Google Sheets CSV 網址")) return "";

    let parsed;
    try { parsed = new URL(trimmedURL); } catch (error) { return trimmedURL; }
    if (!/^https?:$/.test(parsed.protocol)) return trimmedURL;

    const idMatch = parsed.pathname.match(/\/spreadsheets\/d\/([^/]+)/i);
    if (!idMatch) return parsed.toString();
    const sheetId = idMatch[1];
    const gid = parsed.searchParams.get("gid") || (parsed.hash.match(/gid=([0-9]+)/i) || [])[1] || "0";
    const isPublished = /\/pub(?:\/|$)/i.test(parsed.pathname);
    const isCSVExport = /\/export(?:\/|$)/i.test(parsed.pathname) && parsed.searchParams.get("format") === "csv";
    if (isPublished || isCSVExport) return parsed.toString();
    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${encodeURIComponent(gid)}`;
  }

  function validateCSVURL(sourceURL, csvURL) {
    if (!sourceURL || !String(sourceURL).trim() || String(sourceURL).includes("請貼上你的 Google Sheets CSV 網址")) {
      return { ok: false, reason: "尚未設定網址" };
    }
    let parsed;
    try { parsed = new URL(csvURL); } catch (error) { return { ok: false, reason: "網址格式無效" }; }
    if (parsed.protocol !== "https:") return { ok: false, reason: "為避免安全與跨來源問題，網址必須使用 https://" };
    if (!/docs\.google\.com$/i.test(parsed.hostname) || !/\/spreadsheets\/d\//i.test(parsed.pathname)) {
      return { ok: false, reason: "網址不是 Google Sheets 試算表網址" };
    }
    const isPub = /\/pub(?:\/|$)/i.test(parsed.pathname);
    const isExport = /\/export(?:\/|$)/i.test(parsed.pathname) && parsed.searchParams.get("format") === "csv";
    if (!isPub && !isExport) return { ok: false, reason: "缺少 /pub 或 /export?format=csv 的 CSV 路徑" };
    if (!parsed.searchParams.get("gid")) return { ok: false, reason: "網址缺少 gid；請確認工作表分頁的 gid" };
    return { ok: true };
  }

  async function loadGoogleSheetQuestions() {
    isLoading = true;
    loadFailed = false;
    diagnostic = makeEmptyDiagnostic();
    if (actionButton) actionButton.hidden = true;
    p.redraw();

    const csvURL = buildCSVURL(GOOGLE_SHEET_CSV_URL);
    const validation = validateCSVURL(GOOGLE_SHEET_CSV_URL, csvURL);
    if (!validation.ok) {
      failLoading({
        url: csvURL || String(GOOGLE_SHEET_CSV_URL || "（空白）"),
        status: "未發出請求",
        detail: validation.reason,
        causes: ["GOOGLE_SHEET_CSV_URL 仍是範例文字、空白，或不是有效的 Google Sheets CSV 網址。", "若貼的是 /edit 網址，程式會自動轉成 /export?format=csv&gid=...；其他網址則不會被當成題庫。"],
        steps: ["在 sketch.js 找到 GOOGLE_SHEET_CSV_URL。", "先在 Google Sheets 選「檔案 → 共用 → 發布到網路」，選擇正確工作表與 CSV。", "貼上 /pub?gid=...&single=true&output=csv，或 /export?format=csv&gid=... 的完整 https://網址。", "用 http://localhost 或 Live Server 開啟，不要直接雙擊使用 file://。"]
      });
      return;
    }

    const requestURL = appendCacheBuster(csvURL);
    try {
      const response = await fetch(requestURL, {
        method: "GET",
        mode: "cors",
        cache: "no-store",
        redirect: "follow",
        headers: { Accept: "text/csv,text/plain;q=0.9,*/*;q=0.8" }
      });
      const responseText = await response.text();
      const contentType = response.headers.get("content-type") || "未提供";

      if (!response.ok) {
        throw makeLoadError("http", `HTTP ${response.status} ${response.statusText || ""}`.trim(), responseText, contentType);
      }
      if (looksLikeHTML(responseText, contentType)) {
        throw makeLoadError("html", "HTTP 200，但回應是 HTML，不是 CSV", responseText, contentType);
      }
      if (!responseText.trim()) {
        throw makeLoadError("empty", "HTTP 200，但回應內容是空白", responseText, contentType);
      }

      const parsedQuestions = parseCSV(responseText);
      if (parsedQuestions.length < QUIZ_SIZE) {
        throw makeLoadError("count", `HTTP ${response.status}；有效題目只有 ${parsedQuestions.length} 題`, responseText, contentType);
      }

      questionBank = parsedQuestions;
      startNewQuiz();
      isLoading = false;
      p.redraw();
    } catch (error) {
      const detail = error && error.userMessage ? error.userMessage : (error instanceof Error ? error.message : String(error));
      const type = error && error.kind ? error.kind : "network";
      const status = error && error.status ? error.status : "未取得 HTTP 狀態（fetch 網路錯誤或 CORS 被瀏覽器阻擋）";
      const contentType = error && error.contentType ? error.contentType : "未取得";
      failLoading(makeDiagnosticForError(type, requestURL, status, detail, contentType));
      console.error("Google Sheets CSV load error:", error);
    }
  }

  function appendCacheBuster(url) {
    const parsed = new URL(url);
    parsed.searchParams.set("_quiz_cache", String(Date.now()));
    return parsed.toString();
  }

  function makeLoadError(kind, message, responseText, contentType) {
    const error = new Error(message);
    error.kind = kind;
    error.userMessage = message;
    error.status = message.match(/HTTP\s+\d{3}[^；]*/i)?.[0] || "HTTP 狀態未明";
    error.contentType = contentType;
    error.responsePreview = String(responseText || "").slice(0, 300);
    return error;
  }

  function makeDiagnosticForError(kind, url, status, detail, contentType) {
    const causes = [];
    if (kind === "network") {
      causes.push("瀏覽器的 CORS 或網路政策阻擋了跨來源 fetch；不能使用 mode: no-cors 來解決，因為那會拿不到 CSV 內容。", "頁面可能是用 file:// 直接開啟，而不是透過本機 HTTP 伺服器。", "試算表可能沒有發布、發布權限不足，或所在網路阻擋 docs.google.com。");
    } else if (kind === "html") {
      causes.push("Google 回傳了登入頁、權限頁或錯誤頁，而不是 CSV。", "試算表尚未發布到網路、發布連結失效，或網址是編輯／檢視頁而非 CSV 發布網址。", `回應 Content-Type：${contentType}。`);
    } else if (kind === "http") {
      causes.push("HTTP 狀態不是 2xx，常見原因是 gid 錯誤、試算表未發布、權限不足或網址已失效。", `回應 Content-Type：${contentType}。`);
    } else if (kind === "count") {
      causes.push("CSV 可讀取，但符合格式且答案有效的題目少於 5 題。", "可能有空白列、欄位拼字錯誤、答案不是 A-D／1-4，或四個選項不完整。");
    } else if (kind === "empty") {
      causes.push("伺服器回傳空白內容，請確認發布的工作表分頁與 gid 正確。", `回應 Content-Type：${contentType}。`);
    } else {
      causes.push(detail || "網址驗證失敗。");
    }
    causes.push("CSV 第一列必須精確包含：id,question,optionA,optionB,optionC,optionD,answer。", "Google Sheets 的發布 CSV 網址必須是 /pub?gid=...&single=true&output=csv 或 /export?format=csv&gid=...。" );
    return {
      url,
      status,
      detail: `${detail}；Content-Type：${contentType}`,
      causes,
      steps: ["在瀏覽器新分頁直接開啟上方實際請求網址；若看到登入頁或 HTML，先重新發布並確認「任何人都能查看」。", "檢查 gid 是否是目標工作表分頁的 gid，並重新複製 CSV 發布網址。", "用 VS Code Live Server、python -m http.server 或其他本機伺服器開啟 index.html；不要使用 file://。", "修改 sketch.js 的 GOOGLE_SHEET_CSV_URL 後，按「重新載入題庫」；若仍失敗，查看本畫面的 HTTP 狀態與主控台錯誤。"]
    };
  }

  function failLoading(data) {
    setDiagnostic(data);
    isLoading = false;
    loadFailed = true;
    quizQuestions = [];
    if (actionButton) actionButton.hidden = false;
    p.redraw();
  }

  function looksLikeHTML(text, contentType) {
    const sample = String(text || "").trim().slice(0, 600).toLowerCase();
    return /text\/html/i.test(contentType) || /^<!doctype\s+html/i.test(sample) || /^<html[\s>]/i.test(sample) || /<(?:head|body|form)[\s>]/i.test(sample) || /sign in|登入|accounts\.google\.com|要求登入|access denied/i.test(sample);
  }

  function parseCSV(csvText) {
    const cleanText = String(csvText).replace(/^\uFEFF/, "");
    const rows = [];
    let row = [];
    let field = "";
    let insideQuotes = false;
    for (let index = 0; index < cleanText.length; index += 1) {
      const character = cleanText[index];
      const nextCharacter = cleanText[index + 1];
      if (character === '"') {
        if (insideQuotes && nextCharacter === '"') { field += '"'; index += 1; }
        else insideQuotes = !insideQuotes;
      } else if (character === "," && !insideQuotes) { row.push(field); field = ""; }
      else if ((character === "\n" || character === "\r") && !insideQuotes) {
        if (character === "\r" && nextCharacter === "\n") index += 1;
        row.push(field);
        if (row.some((value) => value.trim() !== "")) rows.push(row);
        row = []; field = "";
      } else field += character;
    }
    if (insideQuotes) throw new Error("CSV 有未關閉的雙引號");
    row.push(field);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    if (rows.length < 2) throw new Error("CSV 沒有標題列或題目資料");

    const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").trim().toLowerCase());
    const columnIndex = {};
    headers.forEach((header, index) => { if (header) columnIndex[header] = index; });
    const missingHeaders = REQUIRED_HEADERS.filter((header) => !(header in columnIndex));
    if (missingHeaders.length) throw new Error(`CSV 缺少必要欄位：${missingHeaders.join(", ")}`);

    const questions = [];
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const currentRow = rows[rowIndex];
      const question = getCSVValue(currentRow, columnIndex, "question");
      const options = ["optiona", "optionb", "optionc", "optiond"].map((name) => getCSVValue(currentRow, columnIndex, name));
      const answerValue = getCSVValue(currentRow, columnIndex, "answer");
      const answer = parseAnswer(answerValue, options);
      if (question && options.every((option) => option !== "") && answer >= 0) {
        questions.push({ id: getCSVValue(currentRow, columnIndex, "id") || String(rowIndex), question, options, answer });
      }
    }
    return questions;
  }

  function getCSVValue(row, columnIndex, name) { return String(row[columnIndex[name]] ?? "").trim(); }

  function parseAnswer(value, options) {
    const normalized = String(value).trim().toUpperCase();
    const letterIndex = { A: 0, B: 1, C: 2, D: 3 };
    if (normalized in letterIndex) return letterIndex[normalized];
    if (/^[1-4]$/.test(normalized)) return Number(normalized) - 1;
    return options.findIndex((option) => option.toUpperCase() === normalized);
  }

  function startNewQuiz() {
    const shuffled = [...questionBank];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
    }
    quizQuestions = shuffled.slice(0, QUIZ_SIZE);
    currentQuestionIndex = 0; correctCount = 0; selectedOptionIndex = -1; hasAnswered = false; quizFinished = false;
  }

  function getLayout() {
    const small = p.width < 600;
    const short = p.height < 650;
    const margin = small ? 14 : 40;
    const contentWidth = Math.min(p.width - margin * 2, 860);
    const cardY = small ? 94 : 112;
    const cardHeight = short ? (small ? 116 : 140) : (small ? 132 : 164);
    const optionHeight = short ? (small ? 42 : 50) : (small ? 46 : 58);
    const optionGap = short ? 7 : (small ? 9 : 13);
    const optionTop = cardY + cardHeight + (short ? 14 : 20);
    const optionsHeight = optionHeight * 4 + optionGap * 3;
    const feedbackY = optionTop + optionsHeight + (short ? 19 : 24);
    const buttonY = feedbackY + (short ? 24 : 30);
    return { small, contentWidth, titleSize: small ? 22 : 33, progressSize: small ? 14 : 18, questionSize: small ? 16 : 22, optionTextSize: small ? 14 : 18, feedbackSize: small ? 14 : 17, titleY: small ? 28 : 40, progressY: small ? 59 : 77, cardX: (p.width - contentWidth) / 2, cardY, cardHeight, optionTop, optionHeight, optionGap, optionsHeight, feedbackY, buttonY };
  }

  function drawLoadingScreen() {
    p.fill(TEXT_COLOR); p.textSize(p.width < 600 ? 22 : 30);
    drawMixedBlock("正在載入 Google 題庫⋯⋯", p.width / 2, p.height / 2, p.width - 36, 42, true);
  }

  function drawErrorBackground() {
    p.fill("#b91c1c"); p.textSize(p.width < 600 ? 21 : 29);
    drawMixedBlock("Google Sheets 題庫載入失敗", p.width / 2, 48, p.width - 30, 38, true);
  }

  function drawQuizScreen() {
    const layout = getLayout();
    const item = quizQuestions[currentQuestionIndex];
    optionAreas = [];
    p.noStroke(); p.fill(TEXT_COLOR); p.textSize(layout.titleSize);
    drawMixedBlock("高中數學選擇題測驗", p.width / 2, layout.titleY, layout.contentWidth, layout.titleSize * 1.25, true);
    p.fill(MUTED_COLOR); p.textSize(layout.progressSize);
    drawMixedBlock(`第 ${currentQuestionIndex + 1} 題／共 ${quizQuestions.length} 題`, p.width / 2, layout.progressY, layout.contentWidth, layout.progressSize * 1.3, true);
    p.fill("#ffffff"); p.rect(layout.cardX, layout.cardY, layout.contentWidth, layout.cardHeight, 18);
    p.fill(TEXT_COLOR); p.textSize(layout.questionSize);
    drawMixedBlock(item.question, p.width / 2, layout.cardY + layout.cardHeight / 2, layout.contentWidth - 30, layout.questionSize * 1.45, true);
    item.options.forEach((option, index) => drawOption(option, index, layout, item));
    if (hasAnswered) {
      p.fill(selectedOptionIndex === item.answer ? "#15803d" : "#b91c1c"); p.textSize(layout.feedbackSize);
      const feedback = selectedOptionIndex === item.answer ? "答對了！" : `答錯了，正確答案是 ${String.fromCharCode(65 + item.answer)}。`;
      drawMixedBlock(feedback, p.width / 2, layout.feedbackY, layout.contentWidth, layout.feedbackSize * 1.3, true);
    }
  }

  function drawOption(optionText, index, layout, item) {
    const optionX = layout.cardX;
    const optionY = layout.optionTop + index * (layout.optionHeight + layout.optionGap);
    let optionColor = OPTION_COLOR;
    if (hasAnswered && index === item.answer) optionColor = CORRECT_COLOR;
    else if (hasAnswered && index === selectedOptionIndex) optionColor = WRONG_COLOR;
    p.fill(optionColor); p.stroke("#cbd5e1"); p.strokeWeight(2); p.rect(optionX, optionY, layout.contentWidth, layout.optionHeight, 12);
    p.noStroke(); p.fill(TEXT_COLOR); p.textSize(layout.optionTextSize);
    drawMixedBlock(`${String.fromCharCode(65 + index)}. ${optionText}`, optionX + 16, optionY + layout.optionHeight / 2, layout.contentWidth - 30, layout.optionTextSize * 1.25, false);
    optionAreas.push({ x: optionX, y: optionY, width: layout.contentWidth, height: layout.optionHeight });
  }

  function syncActionButton() {
    if (!actionButton) return;
    if (isLoading || (!loadFailed && !quizFinished && !hasAnswered)) { actionButton.hidden = true; return; }
    const layout = getLayout();
    actionButton.hidden = false;
    actionButton.textContent = loadFailed ? "重新載入題庫" : quizFinished ? "重新開始測驗" : currentQuestionIndex === quizQuestions.length - 1 ? "查看結果" : "下一題";
    const buttonWidth = layout.small ? 190 : 220;
    const buttonHeight = layout.small ? 44 : 48;
    let y;
    if (loadFailed) y = Math.min(p.height - buttonHeight - 16, p.height * 0.86);
    else if (quizFinished) y = Math.min(p.height / 2 + 52, p.height - buttonHeight - 18);
    else y = Math.min(layout.buttonY, p.height - buttonHeight - 16);
    actionButton.style.width = `${buttonWidth}px`; actionButton.style.height = `${buttonHeight}px`;
    actionButton.style.left = `${Math.round((p.width - buttonWidth) / 2)}px`; actionButton.style.top = `${Math.round(y)}px`;
    actionButton.style.fontSize = `${layout.small ? 15 : 17}px`;
  }

  function handleActionButton(event) {
    event.preventDefault(); event.stopPropagation();
    if (loadFailed) { loadGoogleSheetQuestions(); return; }
    if (quizFinished) { startNewQuiz(); p.redraw(); return; }
    if (currentQuestionIndex < quizQuestions.length - 1) { currentQuestionIndex += 1; selectedOptionIndex = -1; hasAnswered = false; p.redraw(); return; }
    quizFinished = true; p.redraw();
  }

  function handleCanvasPointer(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (isLoading || loadFailed || quizFinished || hasAnswered) return;
    event.preventDefault();
    const rect = canvas.elt.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (p.width / rect.width);
    const y = (event.clientY - rect.top) * (p.height / rect.height);
    for (let index = 0; index < optionAreas.length; index += 1) {
      const area = optionAreas[index];
      if (x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height) {
        selectedOptionIndex = index; hasAnswered = true;
        if (index === quizQuestions[currentQuestionIndex].answer) correctCount += 1;
        p.redraw(); return;
      }
    }
  }

  function drawResultScreen() {
    const titleSize = p.width < 600 ? 29 : 38;
    p.fill(TEXT_COLOR); p.textSize(titleSize);
    drawMixedBlock("測驗完成！", p.width / 2, p.height / 2 - 92, p.width - 30, titleSize * 1.35, true);
    p.fill("#2563eb"); p.textSize(p.width < 600 ? 21 : 28);
    drawMixedBlock(`你答對了 ${correctCount}／${quizQuestions.length} 題`, p.width / 2, p.height / 2 - 27, p.width - 30, 38, true);
  }

  p.windowResized = () => { p.resizeCanvas(window.innerWidth, window.innerHeight); p.redraw(); };

  function isChineseCharacter(character) { return /[\u3400-\u4dbf\u4e00-\u9fff\uF900-\uFAFF]/u.test(character); }
  function splitMixedText(value) {
    const segments = []; let current = ""; let currentIsChinese = null;
    for (const character of String(value)) {
      const isChinese = isChineseCharacter(character);
      if (currentIsChinese === null || currentIsChinese === isChinese) { current += character; currentIsChinese = isChinese; }
      else { segments.push({ text: current, isChinese: currentIsChinese }); current = character; currentIsChinese = isChinese; }
    }
    if (current) segments.push({ text: current, isChinese: currentIsChinese });
    return segments;
  }
  function measureMixedText(value) {
    let total = 0;
    for (const segment of splitMixedText(value)) { p.textFont(segment.isChinese ? CHINESE_FONT : LATIN_FONT); total += p.textWidth(segment.text); }
    return total;
  }
  function wrapMixedText(value, maxWidth) {
    const lines = [];
    for (const sourceLine of String(value).split(/\r?\n/)) {
      let line = "";
      for (const character of sourceLine) {
        const candidate = line + character;
        if (line && measureMixedText(candidate) > maxWidth) { lines.push(line); line = character; }
        else line = candidate;
      }
      lines.push(line || " ");
    }
    return lines.length ? lines : [" "];
  }
  function drawMixedBlock(value, centerX, centerY, maxWidth, lineHeight, centered) {
    const lines = wrapMixedText(value, maxWidth);
    const firstY = centerY - ((lines.length - 1) * lineHeight) / 2;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex]; const totalWidth = measureMixedText(line);
      let currentX = centered ? centerX - totalWidth / 2 : centerX;
      for (const segment of splitMixedText(line)) {
        p.textFont(segment.isChinese ? CHINESE_FONT : LATIN_FONT); p.textAlign(p.LEFT, p.CENTER);
        p.text(segment.text, currentX, firstY + lineIndex * lineHeight); currentX += p.textWidth(segment.text);
      }
    }
  }
};

 new p5(sketch);
