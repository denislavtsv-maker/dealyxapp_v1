#!/usr/bin/env node
/* Dealyx — Android WebView session patch
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *   The Capacitor shell loads the live site from a remote origin
 *   (https://dealyx.online/?dealyx_app=1). Inside the WebView that is a
 *   cross-site context, and Android's WebView rejects third-party cookies by
 *   default. The session cookie is therefore never stored, so the login POST
 *   arrives with no session, the server answers `csrf`, and the member sees
 *   "Session expired" even with correct credentials.
 *
 *   No Java source is editable in this repository: `npx cap add android`
 *   GENERATES the native project during the build, so a hand-edited
 *   MainActivity.java would be thrown away on the next build. This script runs
 *   right after `cap add android` and applies the required changes to the
 *   generated file, which makes the fix reproducible and reviewable.
 *
 * WHAT IT CHANGES
 *   1. CookieManager.setAcceptCookie(true) and setAcceptThirdPartyCookies(webView, true)
 *   2. flush() on create/pause/stop so the cookie store is written to disk
 *      (without it, a cold start loses the session and re-prompts for login)
 *   3. Keeps the existing bridge/settings untouched otherwise.
 *
 * USAGE
 *   node scripts/patch-android.mjs            (patches MainActivity.java)
 *   node scripts/patch-android.mjs --check    (exit 1 if the patch is missing)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const JAVA_DIR = join(ROOT, 'android', 'app', 'src', 'main', 'java');
const CHECK_ONLY = process.argv.includes('--check');

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === 'MainActivity.java') out.push(p);
  }
  return out;
}

const files = walk(JAVA_DIR);
if (!files.length) {
  console.error('[patch-android] No MainActivity.java found under ' + JAVA_DIR);
  console.error('[patch-android] Run `npx cap add android` first.');
  process.exit(2);
}

let changed = 0;
let missing = 0;

for (const file of files) {
  let src = readFileSync(file, 'utf8');
  const before = src;

  const hasThirdParty = /setAcceptThirdPartyCookies\s*\(/.test(src);
  const hasAccept = /setAcceptCookie\s*\(\s*true\s*\)/.test(src);

  if (CHECK_ONLY) {
    if (!hasThirdParty || !hasAccept) {
      console.error(`[patch-android] NOT PATCHED: ${file}`);
      missing++;
    } else {
      console.log(`[patch-android] ok: ${file}`);
    }
    continue;
  }

  if (!hasThirdParty || !hasAccept) {
    /* Insert the cookie setup immediately after the WebView is constructed.
       Capacitor generates `public void onCreate(Bundle savedInstanceState)` with
       `super.onCreate(savedInstanceState);` as its first statement. */
    const marker = /(super\.onCreate\s*\(\s*savedInstanceState\s*\)\s*;)/;
    const injection = `$1

        // --- Dealyx: cross-site session persistence (added by scripts/patch-android.mjs) ---
        android.webkit.CookieManager cookieManager = android.webkit.CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(getBridge().getWebView(), true);
        cookieManager.flush();
        // --- end Dealyx patch ---`;

    if (marker.test(src)) {
      src = src.replace(marker, injection);
    } else {
      console.error(`[patch-android] Could not find super.onCreate(...) in ${file}`);
      continue;
    }
  }

  /* Flush on pause/stop so the cookie jar survives process death. */
  const lifecycle = [
    ['onPause', '        super.onPause();'],
    ['onStop', '        super.onStop();']
  ];
  for (const [method, superCall] of lifecycle) {
    if (new RegExp(`void\\s+${method}\\s*\\(`).test(src)) {
      if (!new RegExp(`void\\s+${method}\\s*\\([^)]*\\)\\s*\\{[^}]*flush\\(\\)`, 's').test(src)) {
        src = src.replace(
          new RegExp(`(void\\s+${method}\\s*\\([^)]*\\)\\s*\\{)`),
          `$1\n        try { android.webkit.CookieManager.getInstance().flush(); } catch (Exception ignored) {}`
        );
      }
    } else {
      /* Add the override just before the final closing brace of the class. */
      const idx = src.lastIndexOf('}');
      if (idx > 0) {
        src = src.slice(0, idx) +
          `\n    @Override\n    public void ${method}() {\n        try { android.webkit.CookieManager.getInstance().flush(); } catch (Exception ignored) {}\n` +
          superCall.replace('        ', '        ') + `\n    }\n` +
          src.slice(idx);
      }
    }
  }

  if (src !== before) {
    writeFileSync(file, src, 'utf8');
    console.log(`[patch-android] patched: ${file}`);
    changed++;
  } else {
    console.log(`[patch-android] already up to date: ${file}`);
  }
}

if (CHECK_ONLY && missing) {
  console.error('[patch-android] The WebView cookie patch is MISSING.');
  process.exit(1);
}
console.log(`[patch-android] done (${changed} file(s) changed)`);
