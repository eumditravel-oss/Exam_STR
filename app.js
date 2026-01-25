// app.js - MVP: 과목 선택 → 문항수 선택 → 랜덤 출제(기본 UI)
// - data/bank.json 로드 (subject 필터)
// - 이후 parts[] 크롭 렌더링 로직만 붙이면 완성

const SUBJECTS = [
  "재무회계",
  "원가관리회계",
  "제조원가실무",
  "공사기타원가회계",
  "제도및법규"
];

let bank = [];               // 전체 문제은행
let pool = [];               // 선택 과목 문제 풀
let quiz = [];               // 출제된 문제 리스트(랜덤)
let answers = new Map();     // id -> 선택답
let currentIndex = 0;

let selectedSubject = null;
let maxCount = 0;

// timer
let timerSec = 0;
let timerHandle = null;
let paused = false;

// elements
const el = (id) => document.getElementById(id);

const startScreen = el("startScreen");
const quizScreen = el("quizScreen");
const topbar = el("topbar");

const subjectGrid = el("subjectGrid");

const modalBackdrop = el("modalBackdrop");
const modalSub = el("modalSub");
const countInput = el("countInput");
const countHint = el("countHint");
const btnCancel = el("btnCancel");
const btnStart = el("btnStart");

const timerText = el("timerText");
const btnPause = el("btnPause");
const btnExit = el("btnExit");
const btnGrade = el("btnGrade");

const tabQuestion = el("tabQuestion");
const tabExplain = el("tabExplain");
const tabival들; // placeholder? nope remove. We'll avoid errors.

const tabAnswer = el("tabAnswer");

const qNoText = el("qNoText");
const qInfoText = el("qInfoText");
const qBody = el("qBody");
const qExplain = el("qExplain");
const qAnswer = el("qAnswer");

const progressText = el("progressText");
const btnPrev = el("btnPrev");
const btnNext = el("btnNext");
const choiceButtons = Array.from(document.querySelectorAll(".choice-btn"));

// ------- init -------
renderSubjectButtons();
loadBank();

// ------- UI: subject selection -------
function renderSubjectButtons(){
  subjectGrid.innerHTML = "";
  SUBJECTS.forEach((name) => {
    const btn = document.createElement("button");
    btn.className = "subject-btn";
    btn.innerHTML = `<span class="subject-name">${name}</span><span class="subject-arrow">›</span>`;
    btn.addEventListener("click", () => onPickSubject(name));
    subjectGrid.appendChild(btn);
  });
}

async function loadBank(){
  // bank.json이 없으면 일단 데모 데이터로 동작하도록
  try{
    const res = await fetch("data/bank.json");
    if(!res.ok) throw new Error("bank.json not found");
    bank = await res.json();
  }catch(e){
    // demo data (동작 확인용)
    bank = [
      { id:"재무회계-10-001", subject:"재무회계", session:10, no:1, choices:4, answer:3, explain:"(데모) 재무상태표 구성요소..." , parts:[] },
      { id:"재무회계-10-007", subject:"재무회계", session:10, no:7, choices:4, answer:4, explain:"(데모) 페이지 넘어가는 보기 케이스", parts:[] },
      { id:"제도및법규-01-001", subject:"제도및법규", session:1, no:1, choices:4, answer:2, explain:"(데모) 법규 문제", parts:[] }
    ];
  }
}

function onPickSubject(name){
  selectedSubject = name;
  pool = bank.filter(q => q.subject === name);

  if(pool.length === 0){
    alert(`"${name}" 과목 데이터가 없습니다.\n먼저 data/bank.json에 문제를 추가해주세요.`);
    return;
  }

  maxCount = pool.length;
  modalSub.textContent = `선택한 과목: ${name}`;
  countHint.textContent = `최대: ${maxCount} (이 과목 전체 문제 수)`;

  countInput.value = "";
  openModal();
}

// ------- Modal controls -------
btnCancel.addEventListener("click", closeModal);

btnStart.addEventListener("click", () => {
  const n = Number(countInput.value);
  if(!Number.isFinite(n) || n <= 0){
    alert("문항수를 1 이상으로 입력해주세요.");
    return;
  }
  const count = Math.min(n, maxCount);
  startQuiz(count);
  closeModal();
});

function openModal(){
  modalBackdrop.hidden = false;
  countInput.focus();
}

function closeModal(){
  modalBackdrop.hidden = true;
}

// ------- Quiz start -------
function startQuiz(count){
  quiz = shuffle([...pool]).slice(0, count);
  answers = new Map();
  currentIndex = 0;

  // 화면 전환
  startScreen.hidden = true;
  quizScreen.hidden = false;
  topbar.hidden = false;

  // tabs reset
  setTab("question", false);

  // timer start
  timerSec = 0;
  paused = false;
  btnPause.textContent = "⏸";
  startTimer();

  renderQuestion();
}

function exitQuiz(){
  stopTimer();
  quiz = [];
  answers = new Map();
  currentIndex = 0;
  selectedSubject = null;

  // 화면 전환
  topbar.hidden = true;
  quizScreen.hidden = true;
  startScreen.hidden = false;
}
btnExit.addEventListener("click", () => {
  if(confirm("시험을 종료하고 처음 화면으로 돌아갈까요?")) exitQuiz();
});

// ------- Timer -------
function startTimer(){
  stopTimer();
  timerHandle = setInterval(() => {
    if(paused) return;
    timerSec++;
    timerText.textContent = formatTime(timerSec);
  }, 1000);
}

function stopTimer(){
  if(timerHandle){
    clearInterval(timerHandle);
    timerHandle = null;
  }
}

btnPause.addEventListener("click", () => {
  paused = !paused;
  btnPause.textContent = paused ? "▶" : "⏸";
});

function formatTime(s){
  const hh = Math.floor(s/3600);
  const mm = Math.floor((s%3600)/60);
  const ss = s%60;
  return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
}

// ------- Tabs (문제/해설/정답) -------
tabQuestion.addEventListener("click", () => setTab("question"));
tabExplain.addEventListener("click", () => setTab("explain"));
tabAnswer.addEventListener("click", () => setTab("answer"));

function setTab(mode, keepUnlock=true){
  // active UI
  [tabQuestion, tabExplain, tabAnswer].forEach(t => t.classList.remove("active"));
  if(mode === "question") tabQuestion.classList.add("active");
  if(mode === "explain") tabExplain.classList.add("active");
  if(mode === "answer") tabAnswer.classList.add("active");

  // show/hide
  qBody.hidden = mode !== "question";
  qExplain.hidden = mode !== "explain";
  qAnswer.hidden = mode !== "answer";

  // keepUnlock = false일 때는 해설/정답 잠금 유지
  if(!keepUnlock){
    tabExplain.disabled = true;
    tabAnswer.disabled = true;
  }
}

// ------- Navigation -------
btnPrev.addEventListener("click", () => {
  if(currentIndex > 0){
    currentIndex--;
    setTab("question");
    renderQuestion();
  }
});

btnNext.addEventListener("click", () => {
  if(currentIndex < quiz.length - 1){
    currentIndex++;
    setTab("question");
    renderQuestion();
  }else{
    // 마지막 문제 -> 채점 유도
    if(confirm("마지막 문제입니다. 지금 채점할까요?")) gradeQuiz();
  }
});

// ------- Choice selection -------
choiceButtons.forEach((b) => {
  b.addEventListener("click", () => {
    const choice = Number(b.dataset.choice);
    const q = quiz[currentIndex];
    answers.set(q.id, choice);
    renderChoiceState();
  });
});

function renderChoiceState(){
  const q = quiz[currentIndex];
  const picked = answers.get(q.id) ?? null;
  choiceButtons.forEach((b) => {
    const c = Number(b.dataset.choice);
    b.classList.toggle("active", picked === c);
  });
}

// ------- Render Question -------
function renderQuestion(){
  const q = quiz[currentIndex];

  qNoText.textContent = `${currentIndex + 1}번`;
  qInfoText.textContent = `${q.subject} · ${q.session}회 · ${q.no}번`;
  progressText.textContent = `${currentIndex + 1} / ${quiz.length}`;

  // (MVP) 문제 표시: 우선 텍스트로. 이후 parts[] 크롭 렌더링로 교체.
  // q.parts가 있으면 "이미지 기반"임을 표시해두고, 실제 렌더 함수로 교체하면 됨.
  if(Array.isArray(q.parts) && q.parts.length){
    qBody.textContent =
      `[이미지 문제]\n` +
      `parts: ${q.parts.length}개 (여기에 crop 렌더링 로직 연결)\n\n` +
      `id: ${q.id}`;
  }else{
    qBody.textContent =
      `(${q.subject} ${q.session}회 ${q.no}번)\n` +
      `데모 표시입니다. (bank.json 연결 후 교체)\n\n` +
      `보기는 아래 원형 버튼(1~4)로 선택하세요.`;
  }

  qExplain.textContent = q.explain ? q.explain : "해설이 아직 없습니다.";
  qAnswer.textContent = q.answer ? `정답: ${q.answer}` : "정답 정보가 없습니다.";

  renderChoiceState();
}

// ------- Grade -------
btnGrade.addEventListener("click", () => gradeQuiz());

function gradeQuiz(){
  stopTimer();

  let correct = 0;
  const total = quiz.length;

  quiz.forEach((q) => {
    const picked = answers.get(q.id);
    if(picked === q.answer) correct++;
  });

  // 해설/정답 탭 활성화
  tabExplain.disabled = false;
  tabAnswer.disabled = false;

  alert(
    `채점 완료!\n` +
    `점수: ${correct} / ${total}\n` +
    `시간: ${formatTime(timerSec)}\n\n` +
    `상단 탭에서 해설/정답을 확인할 수 있어요.`
  );

  // 채점 후에는 현재 문제에서 해설 탭으로 이동해도 자연스러움
  setTab("explain");
}

// ------- Utils -------
function shuffle(arr){
  for(let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
