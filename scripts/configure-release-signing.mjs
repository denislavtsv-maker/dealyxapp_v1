import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const file = resolve('android/app/build.gradle');
let src = readFileSync(file, 'utf8');
if (!src.includes('signingConfigs {')) {
  const config = `\n    signingConfigs {\n        release {\n            storeFile file(System.getenv('ANDROID_KEYSTORE_FILE'))\n            storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')\n            keyAlias System.getenv('ANDROID_KEY_ALIAS')\n            keyPassword System.getenv('ANDROID_KEY_PASSWORD')\n        }\n    }\n`;
  src = src.replace(/android\s*\{/, match => match + config);
}
if (!/buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?signingConfig\s+signingConfigs\.release/.test(src)) {
  const match = /buildTypes\s*\{\s*release\s*\{/;
  if (!match.test(src)) throw new Error('Generated Android build.gradle has no release build type');
  src = src.replace(match, m => m + `\n            signingConfig signingConfigs.release`);
}
writeFileSync(file, src);
console.log('[signing] Release signing configured from GitHub Secrets environment variables.');
