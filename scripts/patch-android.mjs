
#!/usr/bin/env node
/* Dealyx — Android WebView cookie persistence patch */
import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const JAVA_DIR = join(
  ROOT, 'android', 'app', 'src', 'main', 'java'
);
const CHECK_ONLY = process.argv.includes('--check');

const COOKIE_SETUP = `
        // Dealyx: persistent cross-site WebView cookies
        android.webkit.CookieManager cookieManager =
            android.webkit.CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(
            getBridge().getWebView(), true
        );
        cookieManager.flush();
        // End Dealyx cookie setup`;

const PATCH_MARKER = 'Dealyx: persistent cross-site WebView cookies';

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }

  for (const name of entries) {
    const path = join(dir, name);
    let info;

    try {
      info = statSync(path);
    } catch {
      continue;
    }

    if (info.isDirectory()) {
      walk(path, out);
    } else if (name === 'MainActivity.java') {
      out.push(path);
    }
  }

  return out;
}

function patchSource(source, file) {
  let src = source;

  if (!src.includes('extends BridgeActivity')) {
    throw new Error('MainActivity does not extend BridgeActivity');
  }

  if (!src.includes(PATCH_MARKER)) {
    const onCreate = /public\s+void\s+onCreate\s*\(\s*Bundle\s+savedInstanceState\s*\)\s*\{/;

    if (onCreate.test(src)) {
      const start = src.match(onCreate);
      const bodyStart = start.index + start[0].length;
      const superCall =
        /super\.onCreate\s*\(\s*savedInstanceState\s*\)\s*;/g;
      superCall.lastIndex = bodyStart;
      const match = superCall.exec(src);

      if (!match) {
        throw new Error(
          'Found onCreate(), but could not locate super.onCreate(savedInstanceState)'
        );
      }

      const end = match.index + match[0].length;
      src = src.slice(0, end) + '\n' + COOKIE_SETUP + '\n' + src.slice(end);
    } else {
      const classEnd = src.lastIndexOf('}');

      if (classEnd < 0) {
        throw new Error('Could not locate the end of the Java class');
      }

      const method = `
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
${COOKIE_SETUP}
    }

`;

      src = src.slice(0, classEnd) + method + src.slice(classEnd);
    }
  }

  for (const method of ['onPause', 'onStop']) {
    const signature = new RegExp(
      `public\\\\s+void\\\\s+${method}\\\\s*\\\\(\\\\s*\\\\)`
    );

    if (!signature.test(src)) {
      const classEnd = src.lastIndexOf('}');

      if (classEnd < 0) {
        throw new Error('Could not locate the end of the Java class');
      }

      const lifecycleMethod = `
    @Override
    public void ${method}() {
        try {
            android.webkit.CookieManager.getInstance().flush();
        } catch (Exception ignored) {
        }
        super.${method}();
    }

`;

      src = src.slice(0, classEnd) +
        lifecycleMethod + src.slice(classEnd);
    } else {
      const methodRegex = new RegExp(
        `(public\\\\s+void\\\\s+${method}\\\\s*\\\\(\\\\s*\\\\)\\\\s*\\\\{)`
      );
      const match = src.match(methodRegex);

      if (match) {
        const afterSignature = match.index + match[0].length;
        const nextText = src.slice(afterSignature, afterSignature + 500);

        if (!nextText.includes('CookieManager.getInstance().flush()')) {
          src = src.slice(0, afterSignature) + `
        try {
            android.webkit.CookieManager.getInstance().flush();
        } catch (Exception ignored) {
        }
` + src.slice(afterSignature);
        }
      }
    }
  }

  return src;
}

const files = walk(JAVA_DIR);

if (!files.length) {
  console.error('[patch-android] No MainActivity.java found.');
  console.error('[patch-android] Run npx cap add android first.');
  process.exit(2);
}

let failures = 0;
let changed = 0;

for (const file of files) {
  try {
    const original = readFileSync(file, 'utf8');
    const patched = patchSource(original, file);

    if (CHECK_ONLY) {
      const valid =
        patched.includes(PATCH_MARKER) &&
        /setAcceptCookie\s*\(\s*true\s*\)/.test(patched) &&
        /setAcceptThirdPartyCookies\s*\(/.test(patched) &&
        /public\s+void\s+onPause\s*\(/.test(patched) &&
        /public\s+void\s+onStop\s*\(/.test(patched) &&
        /CookieManager\.getInstance\(\)\.flush\(\)/.test(patched);

      if (!valid || patched !== original) {
        console.error(`[patch-android] NOT PATCHED: ${file}`);
        failures++;
      } else {
        console.log(`[patch-android] OK: ${file}`);
      }

      continue;
    }

    if (patched !== original) {
      writeFileSync(file, patched, 'utf8');
      console.log(`[patch-android] patched: ${file}`);
      changed++;
    } else {
      console.log(`[patch-android] already patched: ${file}`);
    }
  } catch (error) {
    console.error(`[patch-android] ERROR: ${file}`);
    console.error(error.message);
    failures++;
  }
}

if (failures > 0) {
  console.error(`[patch-android] failed (${failures} file(s))`);
  process.exit(1);
}

console.log(
  CHECK_ONLY
    ? '[patch-android] verification passed'
    : `[patch-android] done (${changed} file(s) changed)`
);
