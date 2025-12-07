// ================== CONFIG ==================
const BASE = "http://localhost:3000";
const API = {
  start: `${BASE}/api/session/start`,
  upload: `${BASE}/api/upload-one`,
  finish: `${BASE}/api/session/finish`,
  saveTranscript: `${BASE}/api/save-transcript`,
  transcribe: `${BASE}/api/transcribe`
};

// ================== QUESTIONS ==================
const QUESTIONS = [
  "Tell me about yourself.",
  "What interests you about our company?",
  "What is the most challenging model you’ve deployed and why?",
  "How do you detect and handle data drift in a live ML system?",
  "When would you choose a simpler model over a complex one?"
];

// ================== DOM ELEMENTS ==================
const els = {
  token: document.getElementById("token"),
  startBtn: document.getElementById("startBtn"),
  nextBtn: document.getElementById("nextBtn"),
  finishBtn: document.getElementById("finishBtn"),
  retryBtn: document.getElementById("retryBtn"),
  uploadStatus: document.getElementById("uploadStatus"),
  interview: document.getElementById("interview"),
  playbackSection: document.getElementById("playbackSection"),
  videoGrid: document.getElementById("videoGrid"),
  video: document.getElementById("previewVideo"),
  questionText: document.getElementById("questionText"),
  startContainer: document.getElementById("start-container")
};

// ================== STATE ==================
let folder = null;
let currentQuestion = 1;
let mediaRecorder = null;
let mediaStream = null;
let chunks = [];
let currentBlob = null;

// ================== HELPERS ==================
async function postJSON(url, data) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function uploadBlob(q, blob) {
  return new Promise((resolve, reject) => {
    if (!blob) {
      els.uploadStatus.textContent = "❌ No recorded video!";
      return reject(new Error("Blob missing"));
    }

    const xhr = new XMLHttpRequest();
    const progressFill = document.getElementById("progressFill");

    const form = new FormData();
    form.append("token", els.token.value);
    form.append("folder", folder);
    form.append("questionIndex", q);
    form.append("file", blob, `Q${q}.webm`);

    xhr.open("POST", API.upload, true);

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;

      const percent = Math.round((e.loaded / e.total) * 100);
      progressFill.style.width = percent + "%";
      els.uploadStatus.textContent = `📤 Uploading ${percent}%`;
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        progressFill.style.width = "100%";
        els.uploadStatus.textContent = "✅ Upload success!";
        resolve(JSON.parse(xhr.responseText));
      } else {
        progressFill.style.width = "0%";
        els.uploadStatus.textContent = "❌ Upload failed!";
        reject(new Error("Server error"));
      }
    };

    xhr.onerror = () => {
      progressFill.style.width = "0%";
      els.uploadStatus.textContent = "❌ Network error!";
      reject(new Error("Network error"));
    };

    xhr.send(form);
  });
}

function updateUIQuestion() {
  els.questionText.textContent =
    `Question ${currentQuestion}: ${QUESTIONS[currentQuestion - 1]}`;
}

// ================== RECORDING ==================
function startRecording() {
  chunks = [];
  currentBlob = null;

  mediaRecorder.start();
  els.uploadStatus.textContent = "Recording...";
}

function stopRecording() {
  return new Promise(resolve => {
    const handler = () => {
      mediaRecorder.onstop = null;
      currentBlob = new Blob(chunks, { type: "video/webm" });
      resolve();
    };

    mediaRecorder.onstop = handler;
    mediaRecorder.stop();
    els.uploadStatus.textContent = "⏹️ Recording stopped...";
  });
}

// ================== START SESSION ==================
els.startBtn.addEventListener("click", async () => {
  try {
    const out = await postJSON(API.start, {
      token: els.token.value,
      userName: "guest"
    });

    folder = out.folder;

    els.startContainer.style.display = "none";
    els.interview.style.display = "block";

    updateUIQuestion();

    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    els.video.srcObject = mediaStream;

    const options = { mimeType: "video/webm; codecs=vp8,opus" };
    mediaRecorder = new MediaRecorder(mediaStream, options);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    await sleep(300);
    startRecording();
    els.nextBtn.disabled = false;

  } catch (err) {
    alert("Cannot begin session: " + err.message);
  }
});

// ================== NEXT QUESTION ==================
els.nextBtn.addEventListener("click", async () => {
  els.nextBtn.disabled = true;

  els.uploadStatus.textContent = `Processing question ${currentQuestion}...`;

  // 1) Stop recording → ensure blob is ready
  await stopRecording();
  await sleep(150);

  // 2) Upload recorded video
  try {
    await uploadBlob(currentQuestion, currentBlob);
  } catch {
    els.uploadStatus.textContent = "❌ Upload failed!";
    els.retryBtn.style.display = "inline-block";
    return;
  }

  // 3) Ask server to transcribe (give server time for FFmpeg)
  els.uploadStatus.textContent = "🧠 Transcribing on server...";
  await sleep(200);

  const res = await postJSON(API.transcribe, {
    folder,
    questionIndex: currentQuestion
  });

  const transcript = res.text;

  // 4) Save transcript
  await postJSON(API.saveTranscript, {
    folder,
    questionIndex: currentQuestion,
    text: transcript
  });

  els.uploadStatus.textContent = "✅ Transcript saved!";

  // 5) Move next
  currentQuestion++;

  if (currentQuestion > QUESTIONS.length) {
    els.uploadStatus.textContent = "Interview finished!";
    els.nextBtn.style.display = "none";
    els.finishBtn.style.display = "inline-block";

    mediaStream.getTracks().forEach(t => t.stop());
    return;
  }

  updateUIQuestion();
  els.uploadStatus.textContent = "Ready for next question...";

  await sleep(200);
  startRecording();
  els.nextBtn.disabled = false;
});

// ================== FINISH ==================
els.finishBtn.addEventListener("click", async () => {
  els.finishBtn.disabled = true;
  els.finishBtn.textContent = "Processing...";

  await postJSON(API.finish, {
    token: els.token.value,
    folder,
    questionsCount: QUESTIONS.length
  });

  els.interview.style.display = "none";
  els.playbackSection.style.display = "block";

  for (let i = 1; i <= QUESTIONS.length; i++) {
    const wrap = document.createElement("div");
    wrap.style.border = "1px solid #475569";
    wrap.style.padding = "10px";
    wrap.style.borderRadius = "10px";

    const title = document.createElement("p");
    title.textContent = `Question ${i}: ${QUESTIONS[i - 1]}`;
    title.style.color = "#fcd34d";
    title.style.fontWeight = "bold";

    const v = document.createElement("video");
    v.src = `${BASE}/uploads/${folder}/Q${i}.webm`;
    v.controls = true;
    v.style.width = "100%";

    wrap.appendChild(title);
    wrap.appendChild(v);
    els.videoGrid.appendChild(wrap);
  }
});

// ================== RETRY ==================
els.retryBtn.addEventListener("click", async () => {
  els.retryBtn.style.display = "none";

  let attempt = 0;

  async function tryUpload() {
    try {
      els.uploadStatus.textContent = `♻️ Retry attempt ${attempt + 1}`;
      await uploadBlob(currentQuestion, currentBlob);
      els.uploadStatus.textContent = "✅ Upload successful!";
    } catch {
      attempt++;

      if (attempt >= 3) {
        els.uploadStatus.textContent = "❌ Upload failed after 3 attempts";
        els.retryBtn.style.display = "inline-block";
        return;
      }

      const wait = Math.pow(2, attempt) * 1000;

      els.uploadStatus.textContent = `⏳ Retry in ${wait / 1000}s...`;
      await sleep(wait);

      return tryUpload();
    }
  }

  tryUpload();
});
