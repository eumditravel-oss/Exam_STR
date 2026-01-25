/* app.js - Random Quiz (finish → results)
   - 풀이 중 정답/해설/채점 기능 노출 X
   - 마지막까지 다 풀면 결과 화면에서 오답 + 정답/해설 제공
   - ✅ crop: px / 0~1 정규화 자동 인식
*/

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const SCREENS = {
  home: $("#home"),
  pick: $("#pick"),
  quiz: $("#quiz"),
  result: $("#result"),
};

const state = {
  subject: null,
  bank: [],

  answerMap: {},   // 분리 정답 (optional)
  explainMap: {},  // 분리 해설 (optional)

  quizItems: [],
  idx: 0,
  answers: {},     // 사용자 선택 {id:1~4}
  timerStart: null,
  timerHandle: null,

  // 결과 필터
  showOnlyWrong: true,
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
  const a = await loadJsonOptional("data/answers.json");
  const ansMap = {};
  if(Array.isArray(a)){
    a.forEach(r => { if(r?.id && typeof r.answer === "number") ansMap[r.id] = r.answer; });
  }else if(a && typeof a === "object"){
    Object.entries(a).forEach(([k,v]) => { if(typeof v === "number") ansMap[k] = v; });
  }
  state.answerMap = ansMap;

  const e = await loadJsonOptional("data/explanations.json");
  const expMap = {};
  if(Array.isArray(e)){
    e.forEach(r => { if(r?.id && typeof r.explain === "string") expMap[r.id] = r.explain; });
  }else if(e && typeof e === "object"){
    Object.entries(e).forEach(([k,v]) => { if(typeof v === "string") expMap[k] = v; });
  }
  state.explainMap = expMap;
}

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
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
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

/* ===== Crop Utils (px / norm) ===== */
function isNormalizedCrop(c){
  if(!c) return false;
  const vals = [c.x, c.y, c.w, c.h];
  if(vals.some(v => typeof v !== "number")) return false;
  return vals.every(v => v >= -0.001 && v <= 1.001);
}
function toPixelCrop(crop, iw, ih){
  if(!crop) return null;
  if(isNormalizedCrop(crop)){
    return { x: crop.x*iw, y: crop.y*ih, w: crop.w*iw, h: crop.h*ih };
  }
  return { x: crop.x, y: crop.y, w: crop.w, h: crop.h };
}
function applyCrop(box, img){
  const raw = JSON.parse(box.dataset.crop || "null");
  if(!raw) return;

  const iw = img.naturalWidth || 1;
  const ih = img.naturalHeight || 1;
  const c = toPixelCrop(raw, iw, ih);
  if(!c || !isFinite(c.w) || !isFinite(c.h) || c.w <= 0 || c.h <= 0) return;

  const boxW = box.clientWidth || 1;
  const scale = boxW / c.w;

  const minH = 220;
  const maxH = 900;
  const targetH = Math.max(minH, Math.min(c.h * scale, maxH));
  box.style.height = `${Math.round(targetH)}px`;

  img.style.position = "absolute";
  img.style.left = (-c.x * scale) + "px";
  img.style.top  = (-c.y * scale) + "px";
  img.style.width  = (iw * scale) + "px";
  img.style.height = (ih * scale) + "px";
}
function renderPartsInto(container, q){
  container.innerHTML = "";
  const parts = Array.isArray(q.parts) && q.parts.length ? q.parts : [];

  parts.forEach((p, pidx) => {
    const card = document.createElement("div");
    card.className = "crop-card";

    const box = document.createElement("div");
    box.className = "crop-box";

    const img = document.createElement("img");
    img.className = "crop-img-el";
    img.alt = `${q.no}번 part ${pidx+1}`;
    img.src = p.pageImage;

    if(p.crop && typeof p.crop.x === "number"){
      box.dataset.crop = JSON.stringify(p.crop);
      img.addEventListener("load", () => applyCrop(box, img));
    }else{
      box.style.height = "520px";
      img.style.position = "relative";
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "contain";
    }

    box.appendChild(img);

    const note = document.createElement("div");
    note.className = "crop-note";
    note.textContent = `part ${pidx+1}`;

    card.appendChild(box);
    card.appendChild(note);
    container.appendChild(card);
  });
}

function reapplyAllCrops(){
  document.querySelectorAll(".crop-box").forEach(box=>{
    const img = box.querySelector("img.crop-img-el");
    if(!img) return;
    if(img.complete && img.naturalWidth && box.dataset.crop){
      applyCrop(box, img);
    }
  });
}
/* ================================ */

function pickQuestions(subject, count){
  const all = state.bank.filter(q => q.subject === subject);
  const max = all.length;
  const n = Math.max(1, Math.min(count, max || 1));
  return shuffle(all).slice(0, n);
}

function resetAll(){
  stopTimer();
  state.subject = null;
  state.quizItems = [];
  state.idx = 0;
  state.answers = {};
  state.showOnlyWrong = true;
  const t = $("#timerText");
  if(t) t.textContent = "00:00";
  showScreen("home");
}

function openSheet(){ $("#sheet").classList.remove("hidden"); }
function closeSheet(){ $("#sheet").classList.add("hidden"); }

function renderQuestion(){
  const q = state.quizItems[state.idx];
  if(!q) return;

  $("#qNo").textContent = `${q.no}번`;
  $("#qStatus").textContent = "풀이";
  $("#qMeta").textContent = `${q.subject} / ${q.session}회`;
  $("#progressText").textContent = `${state.idx + 1}/${state.quizItems.length}`;

  // 마지막 문제면 다음 버튼을 "결과"로 표시
  const isLast = state.idx === state.quizItems.length - 1;
  $("#btnNext").textContent = isLast ? "결과" : "›";

  // 문제 이미지
  renderPartsInto($("#qImageStack"), q);

  // 선택 표시만
  const selected = state.answers[q.id] ?? null;
  $$("#choiceDots .dot").forEach(btn => {
    const c = Number(btn.dataset.choice);
    btn.classList.toggle("selected", selected === c);
  });
}

function nextStep(){
  const isLast = state.idx === state.quizItems.length - 1;
  if(!isLast){
    state.idx++;
    renderQuestion();
    return;
  }

  // ✅ 마지막이면 결과 화면으로
  stopTimer();
  renderResults();
  showScreen("result");
}

/* ===== 결과 화면 ===== */
function computeResult(){
  const total = state.quizItems.length;
  let correct = 0;
  const rows = state.quizItems.map(q => {
    const my = state.answers[q.id] ?? null;
    const ans = getAnswerFor(q); // null 가능
    const ok = (typeof ans === "number") && (my === ans);
    if(ok) correct++;
    return { q, my, ans, ok, explain: getExplainFor(q) };
  });

  const wrong = rows.filter(r => !r.ok);
  return { total, correct, wrongCount: total - correct, rows, wrong };
}

function renderResults(){
  const elapsed = state.timerStart ? (Date.now() - state.timerStart) : 0;
  const t = fmtTime(elapsed);

  const { total, correct, wrongCount, rows, wrong } = computeResult();

  $("#scoreText").textContent = `${correct} / ${total} 정답`;
  $("#scoreMeta").textContent = `소요시간 ${t} · 오답 ${wrongCount}문항`;

  const list = $("#resultList");
  list.innerHTML = "";

  const data = state.showOnlyWrong ? wrong : rows;

  if(data.length === 0){
    const empty = document.createElement("div");
    empty.className = "result-card";
    empty.textContent = "표시할 항목이 없습니다.";
    list.appendChild(empty);
    return;
  }

  data.forEach((r) => {
    const q = r.q;
    const my = r.my;
    const ans = r.ans;
    const ok = r.ok;

    const card = document.createElement("div");
    card.className = "wrong-card";

    const head = document.createElement("div");
    head.className = "wrong-head";

    const title = document.createElement("div");
    title.className = "wrong-title";
    title.textContent = `${q.subject} / ${q.session}회 / ${q.no}번`;

    const pill = document.createElement("div");
    pill.className = "pill " + (ok ? "good" : "bad");
    pill.textContent = ok ? "정답" : "오답";

    head.appendChild(title);
    head.appendChild(pill);

    const body = document.createElement("div");
    body.className = "wrong-body";

    // 이미지(문제 영역 그대로)
    const imgWrap = document.createElement("div");
    renderPartsInto(imgWrap, q);

    const row1 = document.createElement("div");
    row1.className = "qa-row";
    row1.innerHTML = `<span class="k">내 선택</span><span class="v">${my === null ? "-" : my + "번"}</span>`;

    const row2 = document.createElement("div");
    row2.className = "qa-row";
    row2.innerHTML = `<span class="k">정답</span><span class="v">${typeof ans === "number" ? ans + "번" : "-"}</span>`;

    const exp = document.createElement("div");
    exp.className = "explain-box";
    exp.textContent = (r.explain && r.explain.trim())
      ? r.explain
      : "해설 데이터가 아직 없습니다.";

    body.appendChild(imgWrap);
    body.appendChild(row1);
    body.appendChild(row2);
    body.appendChild(exp);

    card.appendChild(head);
    card.appendChild(body);
    list.appendChild(card);
  });

  // 결과 화면에서 crop 재적용(이미지 로드 타이밍 보정)
  setTimeout(reapplyAllCrops, 80);
}
/* ===================== */

async function init(){
  showScreen("home");

  window.addEventListener("resize", () => reapplyAllCrops());

  // 1) bank 필수
  try{
    await loadBank();
  }catch(e){
    alert("data/bank.json을 불러오지 못했습니다.\n경로/파일명을 확인하세요.\n\n" + e.message);
    return;
  }

  // 2) answers/explanations 선택
  await loadAnswerAndExplain();

  // HOME: 과목 선택
  $$(".subject-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if(btn.disabled) return;
      const subj = btn.dataset.subject;
      state.subject = subj;

      const total = state.bank.filter(q => q.subject === subj).length;
      $("#pickTitle").textContent = `${subj} 선택`;
      $("#pickHint").textContent = `총 ${total}문항 중 랜덤 출제`;
      $("#countInput").value = Math.min(20, total || 20);
      $("#countInput").max = total || 999;

      showScreen("pick");
      setTimeout(()=>$("#countInput").focus(), 50);
    });
  });

  $("#btnBackHome").addEventListener("click", () => showScreen("home"));

  // 시작
  $("#btnStart").addEventListener("click", () => {
    if(!state.subject) return;

    const total = state.bank.filter(q => q.subject === state.subject).length;
    const n = Math.max(1, Math.min(Number($("#countInput").value || 1), total || 1));

    state.quizItems = pickQuestions(state.subject, n);
    state.idx = 0;
    state.answers = {};
    state.showOnlyWrong = true;

    showScreen("quiz");
    startTimer();
    renderQuestion();
  });

  // QUIZ: 선택 (풀이 중엔 정답/해설 노출 X)
  $$("#choiceDots .dot").forEach(btn => {
    btn.addEventListener("click", () => {
      const q = state.quizItems[state.idx];
      if(!q) return;
      const c = Number(btn.dataset.choice);
      state.answers[q.id] = c;
      renderQuestion();
    });
  });

  // 다음(마지막이면 결과)
  $("#btnNext").addEventListener("click", () => {
    // 마지막에서 미선택이면 경고만(원하면 강제 선택도 가능)
    const q = state.quizItems[state.idx];
    const isLast = state.idx === state.quizItems.length - 1;
    const my = state.answers[q.id] ?? null;
    if(my === null){
      toast("선택하지 않았습니다. 그대로 진행할까요?");
      // 한번 더 누르면 넘어가게 하려면 아래 주석 해제하고 flag 쓰면 됨
      // (지금은 바로 진행 가능하게 유지)
    }
    nextStep();
  });

  // 나가기(초기화)
  $("#btnExit").addEventListener("click", () => {
    if(confirm("나가면 풀이 기록이 초기화됩니다. 나갈까요?")){
      resetAll();
    }
  });

  // 메뉴
  $("#btnMenu").addEventListener("click", openSheet);
  $("#btnCloseSheet").addEventListener("click", closeSheet);
  $("#sheet").addEventListener("click", (e) => {
    if(e.target.id === "sheet") closeSheet();
  });

  $("#btnReset").addEventListener("click", () => {
    closeSheet();
    if(confirm("처음부터 다시 시작할까요?")){
      resetAll();
    }
  });

  // RESULT 버튼들
  $("#btnResultHome").addEventListener("click", () => resetAll());
  $("#btnRetry").addEventListener("click", () => {
    // 같은 과목/같은 개수로 재시작
    const subj = state.subject;
    const count = state.quizItems.length || 20;
    if(!subj){
      resetAll();
      return;
    }
    state.quizItems = pickQuestions(subj, count);
    state.idx = 0;
    state.answers = {};
    state.showOnlyWrong = true;

    showScreen("quiz");
    startTimer();
    renderQuestion();
  });

  $("#btnOnlyWrong").addEventListener("click", () => {
    state.showOnlyWrong = true;
    renderResults();
  });
  $("#btnAllList").addEventListener("click", () => {
    state.showOnlyWrong = false;
    renderResults();
  });

  // 키보드 (선택/다음)
  window.addEventListener("keydown", (e) => {
    if(SCREENS.quiz.classList.contains("hidden")) return;

    if(e.key === "ArrowRight") $("#btnNext").click();
    if(["1","2","3","4"].includes(e.key)){
      const q = state.quizItems[state.idx];
      if(!q) return;
      state.answers[q.id] = Number(e.key);
      renderQuestion();
    }
  });
}

init();
