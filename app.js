/* app.js - Image-based Quiz (bank.json + answers.json + explanations.json)
   - 과목 선택 → 랜덤 문항 수 선택 → 풀이 UI
   - 정답/해설은 분리 파일에서 우선 로드 (없으면 bank.json fallback)
   - ✅ crop: 픽셀(px) 좌표를 "정확히" 잘라서 표시 (img absolute + overflow hidden)
   - ✅ 7번 같은 멀티파트(parts 2개 이상): 한 문제 화면에서 "합쳐서" 전부 표시
*/

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const SCREENS = {
  home: $("#home"),
  pick: $("#pick"),
  quiz: $("#quiz"),
};

const state = {
  subject: null,
  bank: [],

  // ✅ 분리 데이터(정답/해설)
  answerMap: {},      // { [id]: 1~4 }
  explainMap: {},     // { [id]: "..." }

  quizItems: [],
  idx: 0,
  answers: {},        // { id: 1~4 } (사용자 선택)
  graded: {},         // { id: true/false } (채점 버튼 누른 뒤 표시)

  timerStart: null,
  timerHandle: null,

  // ✅ 이미지 원본 크기 캐시
  _imgSizeCache: {},  // { [src]: {w,h} }
};

function showScreen(name){
  Object.entries(SCREENS).forEach(([k, el]) => {
    el.classList.toggle("hidden", k !== name);
  });
}

function toast(msg){
  const el = $("#toast");
  if(!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), 1600);
}

// ✅ 안전 로드(없어도 앱 동작)
async function loadJsonOptional(url){
  try{
    const res = await fetch(url + (url.includes("?") ? "&" : "?") + "v=" + Date.now());
    if(!res.ok) return null;
    return await res.json();
  }catch(e){
    return null;
  }
}

async function loadBank(){
  const res = await fetch("data/bank.json?v=" + Date.now());
  if(!res.ok) throw new Error("bank.json 로드 실패");
  const data = await res.json();
  state.bank = Array.isArray(data) ? data : [];
}

async function loadAnswerAndExplain(){
  // answers.json 지원 형태:
  // 1) {"재무회계-10-001": 3, ... }
  // 2) [{ "id":"재무회계-10-001", "answer":3 }, ...]
  const a = await loadJsonOptional("data/answers.json");
  const ansMap = {};

  if(Array.isArray(a)){
    a.forEach(r => {
      if(r && r.id && typeof r.answer === "number") ansMap[r.id] = r.answer;
    });
  }else if(a && typeof a === "object"){
    Object.entries(a).forEach(([k,v]) => {
      if(typeof v === "number") ansMap[k] = v;
    });
  }
  state.answerMap = ansMap;

  // explanations.json 지원 형태:
  // 1) {"재무회계-10-001": "해설...", ... }
  // 2) [{ "id":"재무회계-10-001", "explain":"..." }, ...]
  const e = await loadJsonOptional("data/explanations.json");
  const expMap = {};

  if(Array.isArray(e)){
    e.forEach(r => {
      if(r && r.id && typeof r.explain === "string") expMap[r.id] = r.explain;
    });
  }else if(e && typeof e === "object"){
    Object.entries(e).forEach(([k,v]) => {
      if(typeof v === "string") expMap[k] = v;
    });
  }
  state.explainMap = expMap;
}

// ✅ 정답/해설 getter (분리파일 우선, 없으면 bank.json fallback)
function getAnswerFor(q){
  const v = state.answerMap?.[q.id];
  if(typeof v === "number") return v;
  return (typeof q.answer === "number") ? q.answer : null;
}
function getExplainFor(q){
  const v = state.explainMap?.[q.id];
  if(typeof v === "string") return v;
  return (typeof q.explain === "string") ? q.explain : "";
}

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1; i>0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fmtTime(ms){
  const sec = Math.max(0, Math.floor(ms/1000));
  const m = Math.floor(sec/60);
  const s = sec % 60;
  const mm = String(m).padStart(2,"0");
  const ss = String(s).padStart(2,"0");
  return `${mm}:${ss}`;
}

function startTimer(){
  state.timerStart = Date.now();
  if(state.timerHandle) clearInterval(state.timerHandle);
  state.timerHandle = setInterval(() => {
    const el = $("#timerText");
    if(el) el.textContent = fmtTime(Date.now() - state.timerStart);
  }, 250);
}

function stopTimer(){
  if(state.timerHandle) clearInterval(state.timerHandle);
  state.timerHandle = null;
}

function pickQuestions(subject, count){
  const all = state.bank.filter(q => q.subject === subject);
  const max = all.length;
  const n = Math.max(1, Math.min(count, max || 1));
  return shuffle(all).slice(0, n);
}

/* ✅ 해설 패널 (index.html에 #explainPanel, #explainMeta, #myPickText, #answerText, #explainText가 있을 때 동작) */
function hideExplainPanel(){
  const p = $("#explainPanel");
  if(p) p.classList.add("hidden");
}
function showExplainPanel(q){
  const p = $("#explainPanel");
  if(!p) return;

  const sel = state.answers[q.id] ?? null;
  const ans = getAnswerFor(q);
  const exp = getExplainFor(q);

  const meta = $("#explainMeta");
  const myPick = $("#myPickText");
  const answerText = $("#answerText");
  const expText = $("#explainText");

  if(meta) meta.textContent = `${q.subject} / ${q.session}회 / ${q.no}번`;
  if(myPick) myPick.textContent = (sel === null) ? "-" : `${sel}번`;
  if(answerText) answerText.textContent = (typeof ans === "number") ? `${ans}번` : "-";
  if(expText) expText.textContent = exp ? exp : "해설 데이터가 아직 없습니다.";

  p.classList.remove("hidden");
}

/* =========================
   ✅ Crop Utils (픽셀 crop)
   ========================= */

// src 이미지의 natural size를 캐시로 가져오기
function getImageSize(src){
  const cached = state._imgSizeCache[src];
  if(cached) return Promise.resolve(cached);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const size = { w: img.naturalWidth || 1, h: img.naturalHeight || 1 };
      state._imgSizeCache[src] = size;
      resolve(size);
    };
    img.onerror = () => {
      const size = { w: 1, h: 1 };
      state._imgSizeCache[src] = size;
      resolve(size);
    };
    img.src = src;
  });
}

// crop 데이터가 0~1(normalized)이면 px로 변환, px면 그대로
function normalizeCropToPx(crop, imgW, imgH){
  if(!crop || typeof crop.x !== "number") return null;

  const c = crop;
  const isNormalized =
    c.x >= 0 && c.x <= 1 &&
    c.y >= 0 && c.y <= 1 &&
    c.w > 0 && c.w <= 1 &&
    c.h > 0 && c.h <= 1;

  if(isNormalized){
    return {
      x: c.x * imgW,
      y: c.y * imgH,
      w: c.w * imgW,
      h: c.h * imgH,
    };
  }
  return { x: c.x, y: c.y, w: c.w, h: c.h };
}

// box 안에 img를 "정확한 픽셀 crop"으로 맞춰서 배치
async function applyCropPx(box, imgEl, src, crop){
  const { w: imgW, h: imgH } = await getImageSize(src);
  const c = normalizeCropToPx(crop, imgW, imgH);
  if(!c) return;

  // box 폭에 맞춰 crop 영역을 꽉 채우는 스케일
  const boxW = box.clientWidth || 1;
  const scale = boxW / Math.max(1, c.w);

  // 높이 = crop.h * scale 로 "정확히" 맞춤
  const boxH = Math.max(1, Math.round(c.h * scale));
  box.style.height = boxH + "px";

  // imgEl을 확대/이동
  imgEl.style.position = "absolute";
  imgEl.style.left = (-c.x * scale) + "px";
  imgEl.style.top  = (-c.y * scale) + "px";
  imgEl.style.width  = (imgW * scale) + "px";
  imgEl.style.height = (imgH * scale) + "px";
  imgEl.style.objectFit = "fill"; // 위치/크기 직접 지정이므로 영향 거의 없음
}

// 현재 화면의 모든 crop 다시 적용(리사이즈 대응)
function reapplyAllCrops(){
  document.querySelectorAll(".crop-box[data-crop]").forEach(async (box) => {
    const imgEl = box.querySelector("img.crop-img-el");
    if(!imgEl) return;

    const src = box.dataset.src || imgEl.src;
    let crop;
    try{ crop = JSON.parse(box.dataset.crop || "null"); }catch(e){ crop = null; }
    if(!crop) return;

    await applyCropPx(box, imgEl, src, crop);
  });
}

/** =========================
    ✅ Question Render
    ========================= */
function renderQuestion(){
  const q = state.quizItems[state.idx];
  if(!q) return;

  const qNo = $("#qNo");
  const qStatus = $("#qStatus");
  const qMeta = $("#qMeta");
  const progress = $("#progressText");

  if(qNo) qNo.textContent = `${q.no}번`;
  if(qStatus) qStatus.textContent = "풀이";
  if(qMeta) qMeta.textContent = `${q.subject} / ${q.session}회`;
  if(progress) progress.textContent = `${state.idx + 1}/${state.quizItems.length}`;

  // 문제 바뀌면 해설은 접기(채점 누르면 다시 열림)
  hideExplainPanel();

  // ✅ 멀티파트(parts>=2): 한 화면에 전부 "합쳐서" 표시 (세로 스택)
  const stack = $("#qImageStack");
  if(!stack) return;
  stack.innerHTML = "";

  const parts = Array.isArray(q.parts) && q.parts.length ? q.parts : [];
  const multi = parts.length >= 2;

  // (있다면) 파트 네비 UI는 멀티/싱글 모두 숨김(합쳐 보기 기준)
  const nav = $("#partNav");
  if(nav){
    nav.style.display = "none";
    const pt = $("#partText");
    if(pt) pt.textContent = "";
  }

  parts.forEach((p, pidx) => {
    const card = document.createElement("div");
    card.className = "crop-card";

    const box = document.createElement("div");
    box.className = "crop-box";
    box.style.position = "relative";
    box.style.overflow = "hidden";
    box.style.background = "#fff";

    const img = document.createElement("img");
    img.className = "crop-img-el";
    img.alt = `${q.no}번 part ${pidx+1}`;
    img.src = p.pageImage;

    // ✅ crop 적용(픽셀 기반, normalized도 지원)
    if(p.crop && typeof p.crop.x === "number"){
      box.dataset.crop = JSON.stringify(p.crop);
      box.dataset.src = p.pageImage;

      // 이미지 로드 후 crop 적용
      img.addEventListener("load", async () => {
        await applyCropPx(box, img, p.pageImage, p.crop);
      });
    }else{
      // crop 미설정: 전체 이미지(contain)
      box.style.height = "56vw";
      box.style.maxHeight = "520px";
      img.style.position = "absolute";
      img.style.inset = "0";
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "contain";
      img.style.background = "#fff";
    }

    box.appendChild(img);

    const note = document.createElement("div");
    note.className = "crop-note";
    if(multi){
      note.textContent = `part ${pidx+1}/${parts.length} (합쳐보기)`;
    }else{
      note.textContent = p.crop ? `crop 적용` : `crop 미설정(전체 페이지 표시)`;
    }

    card.appendChild(box);
    card.appendChild(note);
    stack.appendChild(card);
  });

  // 선택 표시
  const selected = state.answers[q.id] ?? null;
  $$("#choiceDots .dot").forEach(btn => {
    const c = Number(btn.dataset.choice);
    btn.classList.toggle("selected", selected === c);
    btn.classList.remove("correct","wrong");
  });

  // 채점 표시
  if(state.graded[q.id]){
    paintGrade(q);
  }
}

function paintGrade(q){
  const sel = state.answers[q.id] ?? null;
  const ans = getAnswerFor(q);

  $$("#choiceDots .dot").forEach(btn => {
    const c = Number(btn.dataset.choice);
    btn.classList.remove("correct","wrong");

    if(typeof ans === "number"){
      if(c === ans) btn.classList.add("correct");
      if(sel !== null && c === sel && sel !== ans) btn.classList.add("wrong");
    }
  });

  if(typeof ans !== "number"){
    toast("이 문항은 아직 정답 데이터가 없습니다.");
  }else{
    if(sel === null) toast("선택이 없습니다.");
    else toast(sel === ans ? "정답!" : "오답");
  }

  // 채점 누르면 해설 패널 자동 펼침
  showExplainPanel(q);
}

function nextQuestion(){
  if(state.idx < state.quizItems.length - 1){
    state.idx++;
    renderQuestion();
    return;
  }
  stopTimer();
  toast("끝!");
}

function resetAll(){
  stopTimer();
  state.subject = null;
  state.quizItems = [];
  state.idx = 0;
  state.answers = {};
  state.graded = {};
  const t = $("#timerText");
  if(t) t.textContent = "00:00";
  hideExplainPanel();
  showScreen("home");
}

function openSheet(){
  const s = $("#sheet");
  if(s) s.classList.remove("hidden");
}
function closeSheet(){
  const s = $("#sheet");
  if(s) s.classList.add("hidden");
}

async function init(){
  showScreen("home");

  // ✅ 리사이즈 시 crop 재적용
  window.addEventListener("resize", () => {
    reapplyAllCrops();
  });

  // 1) bank 로드(필수)
  try{
    await loadBank();
  }catch(e){
    alert("data/bank.json을 불러오지 못했습니다.\n경로/파일명을 확인하세요.\n\n" + e.message);
    return;
  }

  // 2) answers/explanations 로드(선택)
  await loadAnswerAndExplain();

  // HOME: 과목 선택
  $$(".subject-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const subj = btn.dataset.subject;
      if(btn.disabled) return;

      state.subject = subj;

      const total = state.bank.filter(q => q.subject === subj).length;
      const title = $("#pickTitle");
      const hint = $("#pickHint");
      const count = $("#countInput");

      if(title) title.textContent = `${subj} 선택`;
      if(hint) hint.textContent = `총 ${total}문항 중 랜덤 출제`;
      if(count){
        count.value = Math.min(20, total || 20);
        count.max = total || 999;
      }

      showScreen("pick");
      setTimeout(()=>{ if(count) count.focus(); }, 50);
    });
  });

  const btnBackHome = $("#btnBackHome");
  if(btnBackHome) btnBackHome.addEventListener("click", () => showScreen("home"));

  // 시작
  const btnStart = $("#btnStart");
  if(btnStart) btnStart.addEventListener("click", () => {
    if(!state.subject) return;

    const total = state.bank.filter(q => q.subject === state.subject).length;
    const n = Math.max(1, Math.min(Number($("#countInput")?.value || 1), total || 1));

    state.quizItems = pickQuestions(state.subject, n);
    state.idx = 0;
    state.answers = {};
    state.graded = {};
    hideExplainPanel();

    showScreen("quiz");
    startTimer();
    renderQuestion();
  });

  // QUIZ: 선택
  $$("#choiceDots .dot").forEach(btn => {
    btn.addEventListener("click", () => {
      const q = state.quizItems[state.idx];
      if(!q) return;
      const c = Number(btn.dataset.choice);
      state.answers[q.id] = c;
      renderQuestion();
    });
  });

  // 다음
  const btnNext = $("#btnNext");
  if(btnNext) btnNext.addEventListener("click", nextQuestion);

  // 채점
  const btnGrade = $("#btnGrade");
  if(btnGrade) btnGrade.addEventListener("click", () => {
    const q = state.quizItems[state.idx];
    if(!q) return;
    state.graded[q.id] = true;
    paintGrade(q);
  });

  // 해설 접기 버튼
  const btnHide = $("#btnHideExplain");
  if(btnHide){
    btnHide.addEventListener("click", hideExplainPanel);
  }

  // 나가기(홈으로)
  const btnExit = $("#btnExit");
  if(btnExit) btnExit.addEventListener("click", () => {
    if(confirm("나가면 풀이 기록이 초기화됩니다. 나갈까요?")){
      resetAll();
    }
  });

  // 메뉴
  const btnMenu = $("#btnMenu");
  if(btnMenu) btnMenu.addEventListener("click", openSheet);

  const btnCloseSheet = $("#btnCloseSheet");
  if(btnCloseSheet) btnCloseSheet.addEventListener("click", closeSheet);

  const sheet = $("#sheet");
  if(sheet){
    sheet.addEventListener("click", (e) => {
      if(e.target.id === "sheet") closeSheet();
    });
  }

  const btnReset = $("#btnReset");
  if(btnReset) btnReset.addEventListener("click", () => {
    closeSheet();
    if(confirm("처음부터 다시 시작할까요?")){
      resetAll();
    }
  });

  // 키보드(PC 편의)
  window.addEventListener("keydown", (e) => {
    if(SCREENS.quiz.classList.contains("hidden")) return;

    if(e.key === "ArrowRight") nextQuestion();
    if(["1","2","3","4"].includes(e.key)){
      const q = state.quizItems[state.idx];
      if(!q) return;
      state.answers[q.id] = Number(e.key);
      renderQuestion();
    }
  });
}

init();
