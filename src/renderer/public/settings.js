// Settings window logic (plain JS; served verbatim from public/).
/* global window, document */

const $ = (id) => document.getElementById(id);
const api = window.pixelpal;

let currentPalette = 'marmalade';

function markActiveSwatch() {
  document.querySelectorAll('.swatch').forEach((el) => {
    el.classList.toggle('active', el.dataset.palette === currentPalette);
  });
}

function applyAppearance() {
  api.settingsApply({
    appearance: {
      palette: currentPalette,
      customColor: $('custom-color').value,
      spriteScale: parseFloat($('scale').value),
      typingThresholdKpm: parseInt($('typing-threshold').value, 10) || 300
    }
  });
}

function applyPomodoroConfig() {
  api.settingsApply({
    pomodoro: {
      workMin: parseFloat($('work-min').value) || 25,
      breakMin: parseFloat($('break-min').value) || 5,
      longBreakMin: parseFloat($('long-min').value) || 15,
      cyclesPerLong: parseInt($('cycles').value, 10) || 4
    }
  });
}

function applyReminderConfig() {
  api.settingsApply({
    reminders: {
      stretch: {
        enabled: $('stretch-on').checked,
        intervalMin: parseInt($('stretch-min').value, 10) || 45
      },
      water: {
        enabled: $('water-on').checked,
        intervalMin: parseInt($('water-min').value, 10) || 60
      },
      nativeNotifications: $('notif').checked
    }
  });
}

async function refreshAlarms() {
  const alarms = await api.alarmList();
  const list = $('alarm-list');
  list.innerHTML = '';
  for (const alarm of alarms) {
    const li = document.createElement('li');
    const when = new Date(alarm.at);
    const label = document.createElement('span');
    label.textContent = `${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — ${alarm.message || '(no message)'}`;
    const remove = document.createElement('button');
    remove.textContent = '✕';
    remove.className = 'secondary';
    remove.addEventListener('click', async () => {
      await api.alarmRemove(alarm.id);
      refreshAlarms();
    });
    li.appendChild(label);
    li.appendChild(remove);
    list.appendChild(li);
  }
}

async function refreshPomodoroStatus() {
  const state = await api.pomodoroGetState();
  const status = $('pomo-status');
  const toggle = $('pomo-toggle');
  if (state.phase === 'idle') {
    status.textContent = 'Pomodoro idle';
    toggle.textContent = 'Start';
  } else {
    const mins = Math.floor(state.remainingSec / 60);
    const secs = String(state.remainingSec % 60).padStart(2, '0');
    status.textContent = `${state.phase} — ${mins}:${secs} left (cycle ${state.cycle})`;
    toggle.textContent = 'Stop';
  }
}

async function load() {
  const s = await api.settingsGet();

  currentPalette = s.appearance.palette;
  $('custom-color').value = s.appearance.customColor;
  $('scale').value = String(s.appearance.spriteScale);
  $('typing-threshold').value = String(s.appearance.typingThresholdKpm);
  markActiveSwatch();

  $('quiet').checked = s.quietMode;
  $('stay').checked = s.stayMode;
  $('login').checked = s.launchAtLogin;

  $('work-min').value = String(s.pomodoro.workMin);
  $('break-min').value = String(s.pomodoro.breakMin);
  $('long-min').value = String(s.pomodoro.longBreakMin);
  $('cycles').value = String(s.pomodoro.cyclesPerLong);

  $('stretch-on').checked = s.reminders.stretch.enabled;
  $('stretch-min').value = String(s.reminders.stretch.intervalMin);
  $('water-on').checked = s.reminders.water.enabled;
  $('water-min').value = String(s.reminders.water.intervalMin);
  $('notif').checked = s.reminders.nativeNotifications;

  $('note-text').value = s.pinnedNote ?? '';

  refreshAlarms();
  refreshPomodoroStatus();
}

// --- wiring ---

document.querySelectorAll('.swatch').forEach((el) => {
  el.addEventListener('click', () => {
    currentPalette = el.dataset.palette;
    markActiveSwatch();
    applyAppearance();
  });
});

$('custom-color').addEventListener('change', () => {
  currentPalette = 'custom';
  markActiveSwatch();
  applyAppearance();
});

$('scale').addEventListener('change', applyAppearance);
$('typing-threshold').addEventListener('change', applyAppearance);

$('quiet').addEventListener('change', () => {
  api.settingsApply({ quietMode: $('quiet').checked });
});
$('stay').addEventListener('change', () => {
  api.settingsApply({ stayMode: $('stay').checked });
});
$('login').addEventListener('change', () => {
  api.settingsApply({ launchAtLogin: $('login').checked });
});

['work-min', 'break-min', 'long-min', 'cycles'].forEach((id) => {
  $(id).addEventListener('change', applyPomodoroConfig);
});
['stretch-on', 'stretch-min', 'water-on', 'water-min', 'notif'].forEach((id) => {
  $(id).addEventListener('change', applyReminderConfig);
});

$('pomo-toggle').addEventListener('click', async () => {
  const state = await api.pomodoroGetState();
  if (state.phase === 'idle') api.pomodoroStart();
  else api.pomodoroStop();
  setTimeout(refreshPomodoroStatus, 300);
});

$('alarm-add').addEventListener('click', async () => {
  const time = $('alarm-time').value;
  if (!time) return;
  const [hh, mm] = time.split(':').map((v) => parseInt(v, 10));
  const at = new Date();
  at.setHours(hh, mm, 0, 0);
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
  await api.alarmAdd(at.getTime(), $('alarm-msg').value);
  $('alarm-msg').value = '';
  refreshAlarms();
});

$('note-set').addEventListener('click', () => {
  api.noteSet($('note-text').value);
});
$('note-clear').addEventListener('click', () => {
  $('note-text').value = '';
  api.noteSet(null);
});

$('reset').addEventListener('click', async () => {
  await api.settingsReset();
  load();
});

setInterval(refreshPomodoroStatus, 1000);
load();
