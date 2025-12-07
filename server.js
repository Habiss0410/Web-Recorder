// ===============================
// ✅ ENV + MODULES
// ===============================

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { spawnSync } = require("child_process");

// ===============================
// ✅ EXPRESS SETUP
// ===============================

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const root = __dirname;

const uploadsRoot = path.join(root, "uploads");
const logsRoot = path.join(root, "logs");

if (!fs.existsSync(uploadsRoot)) fs.mkdirSync(uploadsRoot, { recursive: true });
if (!fs.existsSync(logsRoot)) fs.mkdirSync(logsRoot, { recursive: true });

// ===============================
// ✅ UTILITIES
// ===============================

function sanitizeFolderName(name) {
    const safe = (name || "user").replace(/[^a-z0-9]/gi, "_").toLowerCase();
    const stamp = new Date().toISOString().replace(/[:.]/g, "_");
    return `${stamp}_${safe}`;
}

function writeLog(msg) {
    fs.appendFileSync(
        path.join(logsRoot, "sessions.log"),
        `[${new Date().toISOString()}] ${msg}\n`
    );
}

function ffmpegExtractWav(videoPath, wavPath) {
    const ffmpegPath = path.join(root, "bin", "ffmpeg");

    const res = spawnSync(ffmpegPath, [
        "-y",
        "-i", videoPath,
        "-ar", "16000",
        "-ac", "1",
        wavPath
    ]);

    if (res.status !== 0) {
        throw new Error("FFmpeg failed: " + res.stderr.toString());
    }
}


// ===============================
// ✅ START SESSION
// ===============================

app.post("/api/session/start", (req, res) => {
    try {
        const { token, userName } = req.body;

        if (token !== "12345")
            return res.status(401).json({ ok: false });

        const folder = sanitizeFolderName(userName);
        const folderPath = path.join(uploadsRoot, folder);

        fs.mkdirSync(folderPath, { recursive: true });

        writeLog(`START: ${folder}`);

        return res.json({ ok: true, folder });

    } catch (err) {
        return res.status(500).json({ ok: false, message: err.message });
    }
});


// ===============================
// ✅ UPLOAD CONFIG
// ===============================

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dest = path.join(uploadsRoot, req.body.folder);
        fs.mkdirSync(dest, { recursive: true });
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        cb(null, `Q${req.body.questionIndex}.webm`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 }
});


// ===============================
// ✅ UPLOAD VIDEO
// ===============================

app.post("/api/upload-one", upload.single("file"), (req, res) => {
    try {
        return res.json({
            ok: true,
            savedAs: req.file.filename
        });
    } catch (err) {
        return res.status(500).json({ ok: false, message: err.message });
    }
});

function runVoskCLI(wavPath) {
    return new Promise((resolve, reject) => {
        const cliPath = path.join(root, "models", "vosk-osx-0.3.32");

        const proc = spawnSync(cliPath, [
            "-i", wavPath,
            "-m", path.join(root, "models", "vosk-model-small-en-us-0.15")
        ]);


        if (proc.status !== 0) {
            return reject(new Error(proc.stderr.toString()));
        }

        try {
            const json = JSON.parse(proc.stdout.toString());
            resolve(json.text || "");
        } catch (e) {
            reject(e);
        }
    });
}

// ===============================
// ✅ TRANSCRIBE USING VOSK
// ===============================

app.post("/api/transcribe", async (req, res) => {
    try {
        const { folder, questionIndex } = req.body;

        const folderPath = path.join(uploadsRoot, folder);
        const videoPath = path.join(folderPath, `Q${questionIndex}.webm`);
        const wavPath = path.join(folderPath, `Q${questionIndex}.wav`);

        // ✅ Convert video → wav (mono 16k)
        ffmpegExtractWav(videoPath, wavPath);

        // ✅ Call Vosk CLI instead of vosk-node
        const text = await runVoskCLI(wavPath);

        return res.json({
            ok: true,
            text
        });

    } catch (err) {
        return res.status(500).json({ ok: false, message: err.message });
    }
});

// ===============================
// ✅ SAVE TRANSCRIPT
// ===============================

app.post("/api/save-transcript", (req, res) => {
    try {
        const { folder, questionIndex, text } = req.body;

        const pathFile = path.join(uploadsRoot, folder, "transcript.txt");

        const block = `===== Question ${questionIndex} =====\n${text}\n\n`;

        fs.appendFileSync(pathFile, block);

        return res.json({ ok: true });

    } catch (err) {
        return res.status(500).json({ ok: false, message: err.message });
    }
});


// ===============================
// ✅ FINISH SESSION
// ===============================

app.post("/api/session/finish", (req, res) => {
    try {
        const { token, folder } = req.body;

        if (token !== "12345")
            return res.status(401).json({ ok: false });

        writeLog(`FINISH: ${folder}`);

        return res.json({ ok: true });

    } catch (err) {
        return res.status(500).json({ ok: false, message: err.message });
    }
});


// ===============================
// ✅ START SERVER
// ===============================

app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});
