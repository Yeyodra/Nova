// Capture SSE stream from /v1/chat/completions for canva-pptx
const apiKey = "pool-proxy-secret-key";
const body = JSON.stringify({
  model: "canva-pptx",
  messages: [{ role: "user", content: "5 slide test" }],
  stream: true,
});

const ctrl = new AbortController();
const timeoutMs = 12000;
const timer = setTimeout(() => ctrl.abort(), timeoutMs);

try {
  const res = await fetch("http://localhost:1930/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
    },
    body,
    signal: ctrl.signal,
  });

  console.log(`STATUS=${res.status}`);
  console.log(`CONTENT_TYPE=${res.headers.get("content-type")}`);

  if (!res.body) {
    console.log("NO_BODY");
    process.exit(0);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let chunkCount = 0;
  const start = Date.now();

  let stop = false;
  while (!stop) {
    if (Date.now() - start > timeoutMs) {
      console.log("TIMEOUT_REACHED");
      break;
    }
    const { done, value } = await reader.read();
    if (done) {
      console.log("STREAM_DONE");
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) {
        chunkCount++;
        console.log(`LINE[${chunkCount}]: ${line.slice(0, 250)}`);
        if (chunkCount >= 20) {
          console.log("CAPPED_AT_20_LINES");
          ctrl.abort();
          stop = true;
          break;
        }
      }
    }
  }
} catch (e: any) {
  console.log(`ERROR: ${e.name}: ${e.message?.slice(0, 200)}`);
} finally {
  clearTimeout(timer);
}
