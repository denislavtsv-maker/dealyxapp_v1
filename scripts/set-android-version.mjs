import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const gradle = resolve('android/app/build.gradle');
const code = process.env.APP_VERSION_CODE ? Number(process.env.APP_VERSION_CODE) + 100 : 101;
const name = String(process.env.APP_VERSION_NAME || '1.1.0');
if (!Number.isInteger(code) || code < 1) throw new Error('APP_VERSION_CODE must be a positive integer');
let source = readFileSync(gradle, 'utf8');
if (!/versionCode\s+\d+/.test(source) || !/versionName\s+['"][^'"]+['"]/ .test(source)) throw new Error('Could not find versionCode/versionName in generated android/app/build.gradle');
source = source.replace(/versionCode\s+\d+/, `versionCode ${code}`);
source = source.replace(/versionName\s+(['"])[^'"]+\1/, `versionName \"${name}\"`);
writeFileSync(gradle, source);
console.log(`[version] Android app versionCode=${code} versionName=${name}`);
