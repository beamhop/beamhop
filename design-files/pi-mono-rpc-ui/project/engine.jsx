/* ============================================================
   engine.jsx — plays a scenario as a timed RPC event stream.
   Uses requestAnimationFrame + delta-time so it completes in
   target wall-clock time even when the tab throttles timers.
   ============================================================ */

const toks = (s) => Math.max(1, Math.round((s || "").length / 4));

// A short timer tick. Foreground: ~16ms (smooth). Background: clamped to ~1s by
// the browser — but the delta-time typewriter below completes in 1-2 ticks either
// way, so we never queue dozens of sequential timers.
const tick = () => new Promise((r) => setTimeout(r, 16));

// wall-clock wait via a single timer (bounded count; abort checked by callers)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// delta-time typewriter: reveals `full` over `durMs` of wall time
async function typeInto(api, msgId, blockIdx, full, signal, durMs = 850) {
  const start = performance.now();
  let shown = -1;
  for (;;) {
    if (signal.aborted) break;
    const p = Math.min(1, (performance.now() - start) / durMs);
    const n = Math.floor(p * full.length);
    if (n !== shown) {
      shown = n;
      api.update(msgId, (m) => { m.blocks[blockIdx].text = full.slice(0, n); });
    }
    if (p >= 1) break;
    await tick();
  }
  api.update(msgId, (m) => { m.blocks[blockIdx].text = full; m.blocks[blockIdx].streaming = false; });
}

async function playScenario(steps, prompt, api, signal) {
  api.event({ k: "agent_start" });
  await wait(220, signal);
  if (signal.aborted) return finishAborted(api);

  const msgId = api.pushMsg({
    id: uid("m"), role: "assistant", ts: Date.now(),
    model: api.model().name, stopReason: null, streaming: true,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, blocks: [],
  });
  api.event({ k: "turn_start" });
  api.event({ k: "message_start" });

  let outChars = 0;

  for (const step of steps) {
    if (signal.aborted) return finishAborted(api, msgId);

    if (step.t === "think") {
      const idx = await addBlock(api, msgId, { type: "thinking", text: "", streaming: true, collapsed: false });
      api.event({ k: "message_update", d: "thinking_delta" });
      await typeInto(api, msgId, idx, step.text, signal, 1000);
      await wait(350, signal);
      api.update(msgId, (m) => { m.blocks[idx].collapsed = true; });
      outChars += step.text.length;
    }

    else if (step.t === "say") {
      const idx = await addBlock(api, msgId, { type: "text", text: "", streaming: true });
      api.event({ k: "message_update", d: "text_delta" });
      await typeInto(api, msgId, idx, step.text, signal, 780);
      outChars += step.text.length;
      bumpTurnUsage(api, msgId, outChars);
    }

    else if (step.t === "tool") {
      const callId = uid("call");
      const idx = await addBlock(api, msgId, {
        type: "toolCall", callId, name: step.name, args: step.args,
        status: "running", output: "", diff: step.diff || null, streaming: !!step.stream,
      });
      api.event({ k: "tool_execution_start", name: step.name, callId });
      await wait(step.dur ? Math.min(450, step.dur * 0.4) : 380, signal);
      if (signal.aborted) return finishAborted(api, msgId);

      if (step.stream) {
        let acc = "";
        for (const chunk of step.stream) {
          if (signal.aborted) break;
          acc += chunk;
          api.update(msgId, (m) => { m.blocks[idx].output = acc; });
          api.event({ k: "tool_execution_update", callId });
          await wait((step.dur || 1400) / step.stream.length, signal);
        }
        api.update(msgId, (m) => { m.blocks[idx].output = acc; });
      } else {
        await wait(Math.max(220, (step.dur || 650) * 0.7), signal);
        api.update(msgId, (m) => { m.blocks[idx].output = step.output || ""; });
      }
      api.update(msgId, (m) => { m.blocks[idx].status = step.isError ? "error" : "done"; m.blocks[idx].streaming = false; });
      api.event({ k: "tool_execution_end", name: step.name, callId, isError: !!step.isError });
    }

    else if (step.t === "dialog") {
      api.event({ k: "extension_ui_request", method: step.method });
      const answer = await api.requestDialog({
        method: step.method, title: step.title, message: step.message,
        options: step.options, cmd: step.cmd,
      });
      const approved = answer.confirmed || answer.value === "Allow";
      await addBlock(api, msgId, {
        type: "notice", tone: approved ? "ok" : "block",
        text: answer.cancelled ? "User dismissed the prompt."
          : approved ? `Approved · ran \`${step.cmd || step.title}\``
            : "Blocked by user — choosing a safe alternative.",
      });
      if (approved) {
        await addBlock(api, msgId, {
          type: "toolCall", callId: uid("call"), name: "bash", args: { command: step.cmd },
          status: "done", output: "added 1 package in 2.1s\n\n1 package is looking for funding", diff: null,
        });
      }
    }

    else if (step.t === "afterDialog") {
      const idx = await addBlock(api, msgId, { type: "text", text: "", streaming: true });
      await typeInto(api, msgId, idx,
        "Swapped the in-memory map for an `ioredis` client using `INCR` + `EXPIRE` on a per-IP key. The limiter is now consistent across every instance behind the load balancer. Falls back to in-memory if `REDIS_URL` is unset.",
        signal, 900);
      outChars += 220;
      bumpTurnUsage(api, msgId, outChars);
    }

    else if (step.t === "wait") { await wait(step.ms, signal); }
  }

  api.update(msgId, (m) => { m.streaming = false; m.stopReason = "stop"; });
  api.event({ k: "turn_end" });
  api.event({ k: "agent_end" });
}

async function addBlock(api, msgId, block) {
  let idx = 0;
  api.update(msgId, (m) => { m.blocks.push(block); idx = m.blocks.length - 1; });
  await tick();
  return idx;
}

function bumpTurnUsage(api, msgId, outChars) {
  const out = toks("x".repeat(outChars));
  api.update(msgId, (m) => { m.usage.output = out; m.usage.input = 5400; m.usage.cacheRead = 24800; });
  api.bumpUsage();
}

function finishAborted(api, msgId) {
  if (msgId) api.update(msgId, (m) => { m.streaming = false; m.stopReason = "aborted"; });
  api.event({ k: "agent_end", aborted: true });
}

Object.assign(window, { playScenario });
