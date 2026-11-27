import { statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function workbuddyConfigDirectory(home = os.homedir(), env = process.env) {
  const configured = env.WORKBUDDY_CONFIG_DIR?.trim();
  if (configured) return path.resolve(configured);
  const desktop = path.join(home, '.workbuddy-ai');
  try {
    if (statSync(desktop, { throwIfNoEntry: false })?.isDirectory()) return desktop;
  } catch { /* The desktop profile is inaccessible. */ }
  return path.join(home, '.workbuddy');
}
