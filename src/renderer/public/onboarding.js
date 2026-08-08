// Onboarding page logic (plain JS; served verbatim from public/).
const statusEl = document.getElementById('status');

document.getElementById('open-settings').addEventListener('click', () => {
  window.pixelpal.openAccessibilitySettings();
});

document.getElementById('recheck').addEventListener('click', async () => {
  const granted = await window.pixelpal.recheckAccessibility();
  statusEl.textContent = granted
    ? 'Permission granted — enjoy your cat!'
    : 'Not enabled yet. In System Settings, turn on PixelPal under Privacy & Security → Accessibility.';
});
