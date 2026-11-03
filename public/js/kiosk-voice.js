// Optional read-aloud on the court screen: when a group is called, this
// computer says "Group 5, please go to court 2" (group and court only, no
// names). Separate from the push notifications phones get.
let voiceOn = false;
let announced = null;

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.95;
  speechSynthesis.speak(utterance);
}

export function setupVoice(button) {
  button.addEventListener('click', () => {
    voiceOn = !voiceOn;
    button.textContent = voiceOn ? '🔊 Announcing groups' : '🔊 Announce groups';
    button.classList.toggle('confirm', voiceOn);
    if (voiceOn) speak('I will announce each group when it is called');
    else speechSynthesis?.cancel();
  });
}

// Announces each group the first time it shows up on a court.
export function announce(state) {
  const playing = state.groups.filter((g) => g.status === 'playing');
  if (announced === null) {
    announced = new Set(playing.map((g) => g.id));
    return;
  }
  for (const group of playing) {
    if (announced.has(group.id)) continue;
    announced.add(group.id);
    if (!voiceOn) continue;
    const line = `Group ${group.no}, please go to court ${group.court}.`;
    speak(line);
    speak(line);
  }
}
