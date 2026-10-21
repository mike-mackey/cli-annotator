// Remembers only the last bundle's file name and generation time, as a reminder of
// what to drop again. The bundle and dumps themselves are never stored.
const KEY = 'cli-annotator.lastBundle';

export function rememberBundle(name, generatedAt) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ name, generatedAt: generatedAt ?? null }));
  } catch {
    // Storage blocked or full: the reminder is optional.
  }
}

export function lastBundle() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return v && typeof v.name === 'string' ? { name: v.name, generatedAt: v.generatedAt ?? null } : null;
  } catch {
    return null;
  }
}
