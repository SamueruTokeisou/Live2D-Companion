import { readFileSync } from 'node:fs';
const tabs = await (await fetch('http://127.0.0.1:9237/json')).json();
const target = tabs.find(t => t.type === 'page' && t.title.startsWith('stage'));
if (!target) throw new Error('No stage page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const expression = process.argv[2] === '--file' ? readFileSync(process.argv[3], 'utf8') : process.argv[2];
const result = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('CDP timeout')), 20000);
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id === 1) { clearTimeout(timeout); resolve(m); } };
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
});
ws.close();
if (result.result?.exceptionDetails) { console.error(result.result.exceptionDetails.text); process.exitCode = 1; }
else console.log(JSON.stringify(result.result?.result?.value ?? null));
