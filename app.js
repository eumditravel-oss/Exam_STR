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

// ✅ 전체 회차 랜덤 모드
let isAllRoundsMode = false;

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
  return s.replace(/_(\d+)번$/, (_, n) => `_${String(parseInt(n, 10))}번`);
}

/** ✅ round를 숫자/문자(예: "주관식모음") 모두 매칭하기 위한 정규화 */
function normRound(v){
  if(v === null || v === undefined) return "";
  return String(v).trim();
}

/** NO 안전 변환 (문자/빈값 대응) */
function toInt(v, fallback = 0){
  const n = parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

function downloadTxt(filename, text){
  const blob = new Blob([text], {type:"text/plain;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** ✅ 라벨: 숫자면 "n회", 문자열이면 그대로 */
function displayRoundLabel(r){
  const s = normRound(r);
  if(!s) return "";
  return /^\d+$/.test(s) ? `${s}회` : s;
}

function roundLabel(){
  return isAllRoundsMode ? "10~21회(전체)" : displayRoundLabel(selectedRound);
}

/** ---------- TXT Parser ---------- **/
function parseRecords(txt){
  const t = txt.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = t.split("\n@@@\n").map(s => s.trim()).filter(Boolean);

  const recs = [];
  for(const part of parts){
    const body = part.replace(/\n---\s*$/g, "").trim();

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
      if (/^(Q|EX|TABLE|CHOICES|EXPL):\s*$/.test(line)){
        flush();
        curKey = line.replace(":","");
        buf = [];
        continue;
      }

      const m = line.match(/^([A-Z_]+):\s*(.*)$/);
      if(m && !curKey){
        rec[m[1]] = m[2].trim();
        continue;
      }

      if(curKey){
        buf.push(line);
      } else {
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

/** ✅ findFile: round/subject를 String 기준으로 통일 비교 */
function findFile(round, subject){
  const rKey = normRound(round);
  const sKey = String(subject ?? "").trim();

  const hit = (manifest.files || []).find(f => {
    const fr = normRound(f.round);
    const fs = String(f.subject ?? "").trim();
    return fr === rKey && fs === sKey;
  });

  return hit || null;
}

// ✅ 단일 회차 로드 (숫자/문자 round 모두 가능)
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

  const qRecs = parseRecords("\n@@@\n" + qTxt.trim() + "\n");
  qItems = qRecs.map(r => {
    const rawCode = (r.CODE || "").trim();

    const qText =
      (r.Q && r.Q.trim()) ? r.Q :
      (r.QUESTION && r.QUESTION.trim()) ? r.QUESTION :
      (r.RAW && r.RAW.trim()) ? r.RAW :
      "";

    return {
      code: normalizeCode(rawCode),
      codeRaw: rawCode,

      // ✅ ROUND/NO가 비어있거나 문자인 경우에도 안전
      round: (r.ROUND ?? normRound(round)),
      subject: (r.SUBJECT ?? subject),
      no: toInt(r.NO, 0),

      type: (r.TYPE || "").toUpperCase(),
      point: r.POINT ? Number(r.POINT) : null,

      q: qText,

      ex: r.EX || "",
      table: r.TABLE || "",
      choicesRaw: r.CHOICES || ""
    };
  });

  const aRecs = parseRecords("\n@@@\n" + aTxt.trim() + "\n");
  aMap = new Map();
  aRecs.forEach(r => {
    const codeRaw = (r.CODE || "").trim();
    if(!codeRaw) return;
    const code = normalizeCode(codeRaw);
    aMap.set(code, {
      ans: (r.ANS ?? "").toString().trim(),
      expl: (r.EXPL ?? "").toString().trim()
    });
  });
}

// ✅ 전체 회차(해당 과목) 로드 → 합쳐서 qItems/aMap 구성
//   - "재무회계_주관식모음" 같은 신규 파일이 files에 있어도 자동 포함
async function loadAllRoundsQA(subject){
  qItems = [];
  aMap = new Map();

  const files = (manifest.files || []).filter(f => String(f.subject ?? "").trim() === String(subject ?? "").trim());
  if(!files.length) throw new Error("해당 과목에 등록된 files가 없습니다.");

  // 숫자 round 먼저, 그 다음 문자열 round
  files.sort((a,b) => {
    const ar = normRound(a.round), br = normRound(b.round);
    const an = /^\d+$/.test(ar), bn = /^\d+$/.test(br);
    if(an && bn) return parseInt(ar,10) - parseInt(br,10);
    if(an && !bn) return -1;
    if(!an && bn) return 1;
    return ar.localeCompare(br);
  });

  for(const file of files){
    const [qRes, aRes] = await Promise.all([
      fetch(file.q, {cache:"no-store"}),
      fetch(file.a, {cache:"no-store"})
    ]);

    if(!qRes.ok || !aRes.ok) continue;

    const [qTxt, aTxt] = await Promise.all([qRes.text(), aRes.text()]);

    const qRecs = parseRecords("\n@@@\n" + qTxt.trim() + "\n");
    qRecs.forEach(r => {
      const rawCode = (r.CODE || "").trim();

      const qText =
        (r.Q && r.Q.trim()) ? r.Q :
        (r.QUESTION && r.QUESTION.trim()) ? r.QUESTION :
        (r.RAW && r.RAW.trim()) ? r.RAW :
        "";

      qItems.push({
        code: normalizeCode(rawCode),
        codeRaw: rawCode,

        round: (r.ROUND ?? normRound(file.round)),
        subject: (r.SUBJECT ?? subject),
        no: toInt(r.NO, 0),

        type: (r.TYPE || "").toUpperCase(),
        point: r.POINT ? Number(r.POINT) : null,

        q: qText,
        ex: r.EX || "",
        table: r.TABLE || "",
        choicesRaw: r.CHOICES || ""
      });
    });

    const aRecs = parseRecords("\n@@@\n" + aTxt.trim() + "\n");
    aRecs.forEach(r => {
      const codeRaw = (r.CODE || "").trim();
      if(!codeRaw) return;
      const code = normalizeCode(codeRaw);
      aMap.set(code, {
        ans: (r.ANS ?? "").toString().trim(),
        expl: (r.EXPL ?? "").toString().trim()
      });
    });
  }

  if(!qItems.length) throw new Error("전체 회차 로드 결과, 문제 데이터가 비어 있습니다.");
}

/** ---------- UI Builders ---------- **/
function renderHome(){
  const sg = $("subjectGrid");
  sg.innerHTML = "";

  (manifest.subjects || []).forEach(sub => {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = sub;
    b.onclick = () => {
      selectedSubject = sub;

      // ✅ 과목 변경 시: 선택 초기화
      selectedRound = null;
      isAllRoundsMode = false;

      [...sg.querySelectorAll(".chip")].forEach(x => x.classList.toggle("on", x === b));
      renderRoundGrid();
      updateHomeHint();
    };
    sg.appendChild(b);
  });

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
    b.textContent = displayRoundLabel(r);

    if(selectedSubject){
      const has = !!findFile(r, selectedSubject);
      if(!has) b.classList.add("disabled");
    }

    b.onclick = () => {
      isAllRoundsMode = false;
      selectedRound = r;

      [...rg.querySelectorAll(".chip")].forEach(x => x.classList.toggle("on", x === b));
      updateHomeHint();
    };

    rg.appendChild(b);
  });

  // ✅ 추가 버튼: 과목 선택된 상태에서만 노출
  if(selectedSubject){
    const bAll = document.createElement("button");
    bAll.className = "chip chip-all";
    bAll.textContent = "10~21회 전체 랜덤";

    bAll.onclick = () => {
      isAllRoundsMode = true;
      selectedRound = null;

      [...rg.querySelectorAll(".chip")].forEach(x => x.classList.remove("on"));
      bAll.classList.add("on");
      updateHomeHint();
    };

    rg.appendChild(bAll);
  }
}

function updateHomeHint(){
  const hint = $("homeHint");

  if(!selectedSubject){
    hint.textContent = "과목과 회차를 선택하세요. (manifest.json의 files에 존재하는 조합만 활성화됩니다)";
    return;
  }

  if(isAllRoundsMode){
    hint.textContent = `선택됨: ${selectedSubject} · 10~21회 전체 랜덤 (등록된 files 기준으로 합산 출제)`;
    return;
  }

  if(selectedRound === null || selectedRound === undefined){
    hint.textContent = "회차를 선택하세요. (또는 '10~21회 전체 랜덤'을 선택하세요)";
    return;
  }

  const file = findFile(selectedRound, selectedSubject);
  hint.textContent = file
    ? `선택됨: ${displayRoundLabel(selectedRound)} / ${selectedSubject}  ·  문제: ${file.q}  ·  답안: ${file.a}`
    : "선택한 조합의 TXT 파일이 없습니다. manifest.json의 files에 등록하세요.";
}

/** ---------- Quiz Flow ---------- **/
function buildQuiz(count){
  const pool = qItems.slice().sort((a,b)=>{
    const ar = normRound(a.round), br = normRound(b.round);
    const an = /^\d+$/.test(ar), bn = /^\d+$/.test(br);
    if(an && bn){
      const d = parseInt(ar,10) - parseInt(br,10);
      if(d) return d;
    } else if(an && !bn) return -1;
    else if(!an && bn) return 1;
    else {
      const d = ar.localeCompare(br);
      if(d) return d;
    }

    if((a.no||0) !== (b.no||0)) return (a.no||0) - (b.no||0);
    return String(a.code).localeCompare(String(b.code));
  });

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

  if((item.ex || "").trim()){
    $("exText").textContent = item.ex;
    show("exBlock");
  } else hide("exBlock");

  if((item.table || "").trim()){
    $("tableHost").textContent = item.table;
    show("tableBlock");
  } else hide("tableBlock");

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

  const out = [];
  for(const line of lines){
    const m = line.match(/^([1-4])\)\s*(.*)$/);
    if(m) out.push({no:m[1], text:m[2]});
  }
  return out;
}

function markChoice(host, v){
  const items = [...host.querySelectorAll(".choiceItem")];
  if(items.length){
    items.forEach(el => el.classList.toggle("on", el.dataset.no === String(v)));
    return;
  }

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
    else wrong.push({ item, ua: ua || "(미입력)", ca, expl: a?.expl || "" });
  }

  let t = "";
  t += "[오답노트]\n";
  t += `과목: ${selectedSubject}\n`;
  t += `회차: ${roundLabel()}\n`;
  t += `문항수: ${quiz.length}\n`;
  t += `정답: ${correct} / ${quiz.length}\n\n`;

  wrong.forEach((w, i) => {
    const it = w.item;

    t += `==============================\n`;
    t += `${i+1}. ${it.codeRaw || it.code}\n`;
    t += `내 답: ${w.ua}\n`;
    t += `정답: ${w.ca || "(정답 미등록)"}\n`;
    if(w.expl) t += `해설: ${w.expl}\n`;
    t += `------------------------------\n`;

    if((it.q || "").trim()){
      t += "[문제]\n";
      t += `${it.q.trim()}\n\n`;
    }

    if((it.ex || "").trim()){
      t += "[예제/자료]\n";
      t += `${it.ex.trim()}\n\n`;
    }

    if((it.table || "").trim()){
      t += "[표]\n";
      t += `${it.table.trim()}\n\n`;
    }

    const choices = parseChoices(it.choicesRaw);
    if(choices.length){
      t += "[보기]\n";
      t += choices.map(c => `${c.no}) ${c.text}`).join("\n");
      t += "\n\n";
    }

    t += "\n";
  });

  wrongNoteText = t;
  $("scoreText").textContent = `정답 ${correct} / ${quiz.length}`;
  $("resultHint").textContent = `오답노트 파일명 예: 오답노트_${roundLabel()}_${selectedSubject}.txt`;
}

/** ---------- Events ---------- **/
$("btnStart").onclick = async () => {
  if(!selectedSubject){
    $("homeHint").textContent = "과목을 먼저 선택하세요.";
    return;
  }
  if(!isAllRoundsMode && (selectedRound === null || selectedRound === undefined)){
    $("homeHint").textContent = "회차를 선택하거나, '10~21회 전체 랜덤'을 선택하세요.";
    return;
  }

  if(!isAllRoundsMode){
    const file = findFile(selectedRound, selectedSubject);
    if(!file){
      $("homeHint").textContent = "선택한 회차/과목의 TXT 파일이 없습니다. manifest.json files에 등록하세요.";
      return;
    }
  }

  const count = Math.max(1, parseInt($("countInput").value, 10) || 1);

  try{
    $("homeHint").textContent = "로딩 중...";

    if(isAllRoundsMode){
      await loadAllRoundsQA(selectedSubject);
    } else {
      await loadQA(selectedRound, selectedSubject);
    }

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
  const fn = `오답노트_${roundLabel()}_${selectedSubject}.txt`;
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
