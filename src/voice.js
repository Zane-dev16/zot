"use strict";

// Wake word interface.
// Data shape is WakeConfig { wakeWord, language, threshold }.

const state = { listening: false, wakeWord: "zot", hits: 0 };

function startListening(config) {
  const c = config || {};
  state.listening = true;
  if (c.wakeWord) state.wakeWord = c.wakeWord;
  return { listening: state.listening, wakeWord: state.wakeWord, hits: state.hits };
}

function stopListening() {
  state.listening = false;
  return { listening: state.listening, wakeWord: state.wakeWord, hits: state.hits };
}

// Returns true when transcript contains the wake word.
function onTranscript(text, wakeWord) {
  const w = wakeWord || state.wakeWord;
  if (!text) return false;
  const hit = text.toLowerCase().indexOf(String(w).toLowerCase()) !== -1;
  if (hit) state.hits += 1;
  return hit;
}

function getVoiceState() {
  return { listening: state.listening, wakeWord: state.wakeWord, hits: state.hits };
}

module.exports = { startListening, stopListening, onTranscript, getVoiceState };
