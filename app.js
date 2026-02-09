"use strict";

/** ---------- DOM ---------- **/
const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove("hidden");
const hide = (id) => $(id).classList.add("hidden");
function go(screenId){
  ["screen-home","screen-quiz","screen-result"].forEach(hide);
  show(screenId);
}

/** ---------- State ---------- **/
let manifest = null;

let selectedSubject = null;
let selectedRound = null;

let qItems = [];           // parsed questions for chosen round+subject
let aMap = new Map();      // CODE => { ans, expl }

let quiz = [];             // selected N questions
let idx = 0;
let userAns = new Map();   // CODE => userAnswer

let wrongNoteText = "";

/** ---------- Utils ---------- **/
function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

/** CODE Normalizer: "..._08번" -> "..._8번" */
function normalizeCode(code){
  const s = (code ?? "").toString().trim();
  // 마지막 패턴: _숫자+번 을 찾아서 숫자 앞의 0 제거
  return s.replace(/_(\d+)번$/, (_, n) => `_${String(parseInt(n, 10))}번`);
}


function downloadTxt(filename, text){
  const blob = new Blob([text], {type:"text/plain;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** ---------- TXT Parser ---------- **/
/**
 * Record format:
 * @@@
 * KEY: value
 * Q:
 * multi line...
 * EX:
 * ...
 * ---
 */
function parseRecords(txt){
  // Normalize newlines
  const t = txt.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Split by record start marker
  const parts = t.split("\n@@@\n").map(s => s.trim()).filter(Boolean);

  const recs = [];
  for(const part of parts){
    // Ensure end marker exists; but tolerate missing trailing ---
    const body = part.replace(/\n---\s*$/g, "").trim();

    // Parse fields with block sections (Q/EX/TABLE/CHOICES/EXPL)
    const rec = {};
    const lines = body.split("\n");

    let curKey = null;
    let buf = [];

    function flush(){
      if(curKey){
        rec[curKey] = buf.join("\n").trimEnd();
      }
      curKey = null;
      buf = [];
    }

    for(const line of lines){
      // Block section start like "Q:" exactly
      if (/^(Q|EX|TABLE|CHOICES|EXPL):\s*$/.test(line)){
        flush();
        curKey = line.replace(":",""); // Q, EX, ...
        buf = [];
        continue;
      }

      // Normal KV like "CODE: xxx"
      const m = line.match(/^([A-Z_]+):\s*(.*)$/);
      if(m && !curKey){
        rec[m[1]] = m[2].trim();
        continue;
      }

      // Block content line
      if(curKey){
        buf.push(line);
      } else {
        // tolerate stray lines (append to a RAW bucket)
        rec.RAW = (rec.RAW ? rec.RAW + "\n" : "") + line;
      }
    }
    flush();

    recs.push(rec);
  }
  return recs;
}

/** ---------- Loaders ---------- **/
async function loadManifest(){
  const res = await fetch("data/manifest.json", {cache:"no-store"});
  if(!res.ok) throw new Error("manifest.json 로드 실패");
  return await res.json();
}

function findFile(round, subject){
  const hit = (manifest.files || []).find(f => f.round === round && f.subject === subject);
  return hit || null;
}

async function loadQA(round, subject){
  const file = findFile(round, subject);
  if(!file) throw new Error("선택한 회차/과목 파일이 없습니다.");

  const [qRes, aRes] = await Promise.all([
    fetch(file.q, {cache:"no-store"}),
    fetch(file.a, {cache:"no-store"})
  ]);

  if(!qRes.ok) throw new Error("문제 TXT 로드 실패");
  if(!aRes.ok) throw new Error("답안 TXT 로드 실패");

  const [qTxt, aTxt] = await Promise.all([qRes.text(), aRes.text()]);

  // Parse questions
  const qRecs = parseRecords("\n@@@\n" + qTxt.trim() + "\n");
  qItems = qRecs.map(r => {
  const rawCode = (r.CODE || "").trim();
  return {
    code: normalizeCode(rawCode),     // ✅ 내부 매칭용(정규화)
    codeRaw: rawCode,                 // (선택) 원본 표시용
    round: Number(r.ROUND),
    subject: r.SUBJECT,
    no: Number(r.NO),
    type: (r.TYPE || "").toUpperCase(),
    point: r.POINT ? Number(r.POINT) : null,
    q: r.Q || "",
    ex: r.EX || "",
    table: r.TABLE || "",
    choicesRaw: r.CHOICES || ""
  };
});


  // Parse answers
  const aRecs = parseRecords("\n@@@\n" + aTxt.trim() + "\n");
  aMap = new Map();
  aRecs.forEach(r => {
    const codeRaw = (r.CODE || "").trim();
if(!codeRaw) return;
const code = normalizeCode(codeRaw);  // ✅ 정규화 키로 저장
aMap.set(code, {
  ans: (r.ANS ?? "").toString().trim(),
  expl: (r.EXPL ?? "").toString().trim()
});

  });

  // Sanity: only keep questions that have answers (optional policy)
  // qItems = qItems.filter(q => aMap.has(q.code));
}

/** ---------- UI Builders ---------- **/
function renderHome(){
  // Subjects
  const sg = $("subjectGrid");
  sg.innerHTML = "";
  (manifest.subjects || []).forEach(sub => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = sub;
    b.onclick = () => {
      selectedSubject = sub;
      [...sg.querySelectorAll(".chip")].forEach(x => x.classList.toggle("on", x === b));
      renderRoundGrid(); // apply availability filter
      updateHomeHint();
    };
    sg.appendChild(b);
  });

  // Rounds
  renderRoundGrid();
  updateHomeHint();
}

function renderRoundGrid(){
  const rg = $("roundGrid");
  rg.innerHTML = "";

  const rounds = manifest.rounds || [];
  rounds.forEach(r => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = `${r}회`;

    // disable if subject selected but file missing
    if(selectedSubject){
      const has = !!findFile(r, selectedSubject);
      if(!has) b.classList.add("disabled");
    }

    b.onclick = () => {
      selectedRound = r;
      [...rg.querySelectorAll(".chip")].forEach(x => x.classList.toggle("on", x === b));
      updateHomeHint();
    };

    rg.appendChild(b);
  });
}

function updateHomeHint(){
  const hint = $("homeHint");
  const ok = selectedSubject && selectedRound;
  if(!ok){
    hint.textContent = "과목과 회차를 선택하세요. (manifest.json의 files에 존재하는 조합만 활성화됩니다)";
    return;
  }
  const file = findFile(selectedRound, selectedSubject);
  hint.textContent = file
    ? `선택됨: ${selectedRound}회 / ${selectedSubject}  ·  문제: ${file.q}  ·  답안: ${file.a}`
    : "선택한 조합의 TXT 파일이 없습니다. manifest.json의 files에 등록하세요.";
}

/** ---------- Quiz Flow ---------- **/
function buildQuiz(count){
  const pool = qItems.slice().sort((a,b)=>a.no-b.no); // stable
  const n = Math.min(count, pool.length);
  quiz = shuffle(pool).slice(0, n);
  idx = 0;
  userAns = new Map();
}

function renderQuestion(){
  const item = quiz[idx];
  const total = quiz.length;

  $("meta").textContent = `${idx+1} / ${total} · ${item.code}`;

  $("qText").textContent = item.q || "";

  // EX
  if((item.ex || "").trim()){
    $("exText").textContent = item.ex;
    show("exBlock");
  } else {
    hide("exBlock");
  }

  // TABLE
  if((item.table || "").trim()){
    $("tableHost").textContent = item.table;
    show("tableBlock");
  } else {
    hide("tableBlock");
  }

  // Answer area
  const area = $("answerArea");
  area.innerHTML = "";

  const saved = userAns.get(item.code) ?? "";

  const isMCQ = (item.type === "MCQ") || hasChoices(item.choicesRaw);

  if(isMCQ){
    const choices = parseChoices(item.choicesRaw);

    const list = document.createElement("div");
    list.className = "choiceList";

    const opts = choices.length
      ? choices.map(c => ({ no: c.no, text: c.text }))
      : ["1","2","3","4"].map(n => ({ no: n, text: "" }));

    opts.forEach(opt => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choiceItem";
      btn.dataset.no = opt.no;

      const left = document.createElement("div");
      left.className = "choiceNo";
      left.textContent = `${opt.no})`;

      const right = document.createElement("div");
      right.className = "choiceText";
      right.textContent = opt.text || "";

      btn.appendChild(left);
      btn.appendChild(right);

      btn.onclick = () => {
        userAns.set(item.code, opt.no);
        markChoice(list, opt.no);
      };

      list.appendChild(btn);
    });

    area.appendChild(list);

    if(saved) markChoice(list, saved);

  } else {
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "정답 입력";
    input.value = saved;
    input.oninput = () => userAns.set(item.code, input.value);
    area.appendChild(input);
  }

  // buttons
  if(idx === total - 1){
    hide("btnNext");
    show("btnSubmit");
  } else {
    show("btnNext");
    hide("btnSubmit");
  }
}


function hasChoices(raw){
  return /\b1\)\s*/.test(raw || "");
}

function parseChoices(raw){
  const t = (raw || "").replace(/\r\n/g,"\n").replace(/\r/g,"\n").trim();
  if(!t) return [];
  const lines = t.split("\n").map(s=>s.trim()).filter(Boolean);

  // Expect "1) ..." format
  const out = [];
  for(const line of lines){
    const m = line.match(/^([1-4])\)\s*(.*)$/);
    if(m) out.push({no:m[1], text:m[2]});
  }
  return out;
}

function markChoice(host, v){
  // 보기 전체 클릭형(.choiceItem)
  const items = [...host.querySelectorAll(".choiceItem")];
  if(items.length){
    items.forEach(el => el.classList.toggle("on", el.dataset.no === String(v)));
    return;
  }

  // (구버전 호환) 숫자 버튼형(.choiceBtn)
  [...host.querySelectorAll(".choiceBtn")].forEach(btn=>{
    btn.classList.toggle("on", btn.textContent === String(v));
  });
}


function gradeAndBuildWrongNote(){
  let correct = 0;
  const wrong = [];

  for(const item of quiz){
    const key = item.code;
    const ua = (userAns.get(key) ?? "").toString().trim();
    const a = aMap.get(key);
    const ca = (a?.ans ?? "").toString().trim();

    const ok = ua !== "" && ua === ca;
    if(ok) correct++;
    else wrong.push({item, ua: ua || "(미입력)", ca, expl: a?.expl || ""});
  }

  // Wrong note txt
  let t = "";
  t += "[오답노트]\n";
  t += `과목: ${selectedSubject}\n`;
  t += `회차: ${selectedRound}회\n`;
  t += `문항수: ${quiz.length}\n`;
  t += `정답: ${correct} / ${quiz.length}\n\n`;

  wrong.forEach(w=>{
    t += `- ${w.item.code}\n`;
    t += `  내 답: ${w.ua}\n`;
    t += `  정답: ${w.ca || "(정답 미등록)"}\n`;
    if(w.expl) t += `  해설: ${w.expl}\n`;
    t += "\n";
  });

  wrongNoteText = t;
  $("scoreText").textContent = `정답 ${correct} / ${quiz.length}`;
  $("resultHint").textContent = `오답노트 파일명 예: 오답노트_${selectedRound}회_${selectedSubject}.txt`;
}

/** ---------- Events ---------- **/
$("btnStart").onclick = async () => {
  if(!selectedSubject || !selectedRound){
    $("homeHint").textContent = "과목과 회차를 먼저 선택하세요.";
    return;
  }

  const file = findFile(selectedRound, selectedSubject);
  if(!file){
    $("homeHint").textContent = "선택한 회차/과목의 TXT 파일이 없습니다. manifest.json files에 등록하세요.";
    return;
  }

  const count = Math.max(1, parseInt($("countInput").value, 10) || 1);

  try{
    $("homeHint").textContent = "로딩 중...";
    await loadQA(selectedRound, selectedSubject);

    if(!qItems.length){
      $("homeHint").textContent = "문제 데이터가 비어 있습니다.";
      return;
    }

    buildQuiz(count);
    go("screen-quiz");
    renderQuestion();
  }catch(err){
    $("homeHint").textContent = `로드 실패: ${err.message}`;
  }
};

$("btnNext").onclick = () => {
  if(idx < quiz.length - 1){
    idx++;
    renderQuestion();
  }
};

$("btnSubmit").onclick = () => {
  gradeAndBuildWrongNote();
  go("screen-result");
};

$("btnDownloadWrong").onclick = () => {
  const fn = `오답노트_${selectedRound}회_${selectedSubject}.txt`;
  downloadTxt(fn, wrongNoteText);
};

$("btnBackHome").onclick = () => {
  go("screen-home");
  renderRoundGrid();
  updateHomeHint();
};

$("btnQuit").onclick = () => {
  go("screen-home");
  renderRoundGrid();
  updateHomeHint();
};

/** ---------- Init ---------- **/
(async function init(){
  go("screen-home");
  try{
    manifest = await loadManifest();
    renderHome();
  }catch(err){
    $("homeHint").textContent = `manifest.json 로드 실패: ${err.message}`;
  }
})();
 
