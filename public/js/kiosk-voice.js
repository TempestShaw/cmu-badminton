// Optional read-aloud on the court screen: when a group is called, this
// computer says "Group 5, please go to court 2" and the names. Not push notifications.
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
    button.textContent = voiceOn ? '🔊 Reading names aloud' : '🔊 Read names aloud';
    button.classList.toggle('confirm', voiceOn);
    if (voiceOn) speak('I will read out each group when it is called');
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
    const line = `Group ${group.no}, please go to court ${group.court}. ${group.players.map((p) => p.name).join(', ')}`;
    speak(line);
    speak(line);
  }
}
