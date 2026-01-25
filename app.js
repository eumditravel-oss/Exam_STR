/* app.js - Image-based Quiz (bank.json + answers.json + explanations.json)
   - 과목 선택 → 랜덤 문항 수 선택 → 풀이 UI
   - 정답/해설은 분리 파일에서 우선 로드 (없으면 bank.json fallback)
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

/** crop 렌더링 */
function renderQuestion(){
  const q = state.quizItems[state.idx];
  if(!q) return;

  $("#qNo").textContent = `${q.no}번`;
  $("#qStatus").textContent = "풀이";
  $("#qMeta").textContent = `${q.subject} / ${q.session}회`;
  $("#progressText").textContent = `${state.idx + 1}/${state.quizItems.length}`;

  // 문제 바뀌면 해설은 접기(채점 누르면 다시 열림)
  hideExplainPanel();

  // 이미지 스택
  const stack = $("#qImageStack");
  stack.innerHTML = "";

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

    // ✅ crop이 있으면: 픽셀 기준으로 정확히 잘라서 보이게
    if (p.crop && typeof p.crop.x === "number") {
      // crop 데이터 저장(리사이즈 대응)
      box.dataset.crop = JSON.stringify(p.crop);

      img.addEventListener("load", () => {
        applyCrop(box, img);
      });
    } else {
      // crop 미설정: 전체 이미지(contain 느낌)
      img.style.position = "relative";
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "contain";
    }

    box.appendChild(img);

    const note = document.createElement("div");
    note.className = "crop-note";
    note.textContent = p.crop ? `part ${pidx+1} / crop 적용` : `part ${pidx+1} / crop 미설정(전체 페이지 표시)`;

    card.appendChild(box);
    card.appendChild(note);
    stack.appendChild(card);
  });

   function applyCrop(box, img){
  const crop = JSON.parse(box.dataset.crop || "null");
  if(!crop) return;

  // box 실제 폭 기준으로 스케일 계산
  const boxW = box.clientWidth || 1;
  const scale = boxW / crop.w;

  // 이미지 원본 크기
  const iw = img.naturalWidth || 1;
  const ih = img.naturalHeight || 1;

  // crop 영역이 box에 꽉 차도록: 이미지 자체를 확대/이동
  img.style.position = "absolute";
  img.style.left = (-crop.x * scale) + "px";
  img.style.top  = (-crop.y * scale) + "px";
  img.style.width  = (iw * scale) + "px";
  img.style.height = (ih * scale) + "px";
}

function reapplyAllCrops(){
  document.querySelectorAll(".crop-box").forEach(box=>{
    const img = box.querySelector("img.crop-img-el");
    if(!img) return;
    if(box.dataset.crop){
      applyCrop(box, img);
    }
  });
}


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
  $("#sheet").classList.remove("hidden");
}
function closeSheet(){
  $("#sheet").classList.add("hidden");
}

async function init(){
  showScreen("home");

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
  $("#btnNext").addEventListener("click", nextQuestion);

  // 채점
  $("#btnGrade").addEventListener("click", () => {
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
