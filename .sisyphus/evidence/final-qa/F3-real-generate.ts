import { readFileSync } from "fs";
const token = readFileSync(".sisyphus/evidence/final-qa/F3-jwt.txt", "utf8").trim();

// Issue request with abort after a short window — we just want to see whether
// the request enters the worker pipeline (i.e. routing layer reaches dispatch).
const ctrl = new AbortController();
const timeoutMs = 25_000;
setTimeout(() => ctrl.abort(), timeoutMs);

const start = Date.now();
try {
  const res = await fetch("http://localhost:1930/api/image-studio/generate", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "pptx",
      prompt: "F3 QA real generate test — buat ppt 3 slide tentang QA verification",
      slideCount: 3,
      format: "pptx",
    }),
    signal: ctrl.signal,
  });
  const dur = Date.now() - start;
  console.log(`STATUS=${res.status} duration_ms=${dur}`);
  const txt = await res.text();
  console.log(`BODY (first 800 chars):\n${txt.slice(0, 800)}`);
} catch (e: any) {
  const dur = Date.now() - start;
  console.log(`ABORTED_OR_ERROR after ${dur}ms: ${e.name}: ${e.message?.slice(0, 200)}`);
}
