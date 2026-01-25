/* app.js - Image-based Quiz (bank.json 기반)
   - 과목 선택 → 랜덤 문항 수 선택 → 풀이 UI
   - 답안/해설은 현재 null/빈값이어도 동작 (채점 시 안내)
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
  quizItems: [],
  idx: 0,
  answers: {},      // { id: 1~4 }
  graded: {},       // { id: true/false } (채점 버튼 누른 뒤 표시 용)
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
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), 1600);
}

async function loadBank(){
  // GitHub Pages에서 fetch 가능
  const res = await fetch("data/bank.json?v=" + Date.now());
  if(!res.ok) throw new Error("bank.json 로드 실패");
  const data = await res.json();
  state.bank = Array.isArray(data) ? data : [];
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
    $("#timerText").textContent = fmtTime(Date.now() - state.timerStart);
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

/** crop 렌더링:
 *  - crop이 null이면: 전체 이미지 보여줌(설정 전 상태)
 *  - crop이 {x,y,w,h}면: background-position/size로 자른 영역만 보이게 구현
 */
function renderQuestion(){
  const q = state.quizItems[state.idx];
  if(!q) return;

  $("#qNo").textContent = `${q.no}번`;
  $("#qStatus").textContent = "풀이";
  $("#qMeta").textContent = `${q.subject} / ${q.session}회`;
  $("#progressText").textContent = `${state.idx + 1}/${state.quizItems.length}`;

  // 이미지 스택
  const stack = $("#qImageStack");
  stack.innerHTML = "";

  const parts = Array.isArray(q.parts) && q.parts.length ? q.parts : [];
  parts.forEach((p, pidx) => {
    const card = document.createElement("div");
    card.className = "crop-card";

    const box = document.createElement("div");
    box.className = "crop-box";

    const img = document.createElement("div");
    img.className = "crop-img";

    const src = p.pageImage;
    img.style.backgroundImage = `url("${src}")`;

    if(p.crop && typeof p.crop.x === "number"){
      // crop 영역을 박스 전체에 꽉 차게(cover처럼) 보이도록:
      // background-size는 (1/w, 1/h) 배 확대
      const bx = p.crop.x, by = p.crop.y, bw = p.crop.w, bh = p.crop.h;
      const scaleX = 1 / Math.max(0.0001, bw);
      const scaleY = 1 / Math.max(0.0001, bh);

      img.style.backgroundSize = `${scaleX*100}% ${scaleY*100}%`;
      img.style.backgroundPosition = `${(-bx/(bw))*100}% ${(-by/(bh))*100}%`;
      // 위 계산은 직관적이지만 브라우저마다 느낌이 달 수 있어
      // 실제로는 editor로 좌표 찍고 확인하면서 미세 보정 가능
    }else{
      // crop 미설정: 전체 페이지 표시
      img.style.backgroundSize = "contain";
      img.style.backgroundPosition = "center";
      img.style.backgroundColor = "#fff";
    }

    box.appendChild(img);

    const note = document.createElement("div");
    note.className = "crop-note";
    if(p.crop){
      note.textContent = `part ${pidx+1} / crop 적용`;
    }else{
      note.textContent = `part ${pidx+1} / crop 미설정(전체 페이지 표시)`;
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

  // 채점 표시(정답 데이터 없으면 표시 안 함)
  if(state.graded[q.id]){
    paintGrade(q);
  }
}

function paintGrade(q){
  const sel = state.answers[q.id] ?? null;
  const ans = q.answer; // 현재는 null일 수 있음

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
}

function nextQuestion(){
  if(state.idx < state.quizItems.length - 1){
    state.idx++;
    renderQuestion();
    return;
  }
  // 마지막이면 결과 요약(정답 없으면 단순 완료)
  stopTimer();
  toast("끝! (정답/해설 세팅 후 점수화 가능)");
}

function resetAll(){
  stopTimer();
  state.subject = null;
  state.quizItems = [];
  state.idx = 0;
  state.answers = {};
  state.graded = {};
  $("#timerText").textContent = "00:00";
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

  // 1) bank 로드
  try{
    await loadBank();
  }catch(e){
    alert("data/bank.json을 불러오지 못했습니다.\n경로/파일명을 확인하세요.\n\n" + e.message);
    return;
  }

  // HOME: 과목 선택
  $$(".subject-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const subj = btn.dataset.subject;
      if(btn.disabled) return;

      state.subject = subj;

      // 해당 과목 총 문항
      const total = state.bank.filter(q => q.subject === subj).length;
      $("#pickTitle").textContent = `${subj} 선택`;
      $("#pickHint").textContent = `총 ${total}문항 중 랜덤 출제`;
      $("#countInput").value = Math.min(20, total || 20);
      $("#countInput").max = total || 999;

      showScreen("pick");
      setTimeout(()=>$("#countInput").focus(), 50);
    });
  });

  $("#btnBackHome").addEventListener("click", () => {
    showScreen("home");
  });

  // 시작
  $("#btnStart").addEventListener("click", () => {
    if(!state.subject) return;

    const total = state.bank.filter(q => q.subject === state.subject).length;
    const n = Math.max(1, Math.min(Number($("#countInput").value || 1), total || 1));

    state.quizItems = pickQuestions(state.subject, n);
    state.idx = 0;
    state.answers = {};
    state.graded = {};

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
