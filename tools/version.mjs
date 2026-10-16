import fs from "node:fs";
const v = JSON.parse(fs.readFileSync("version.json", "utf8"));
if (
  !/^\d+\.\d+\.\d+$/.test(v.version) ||
  !Number.isSafeInteger(v.versionCode) ||
  v.versionCode < 3 ||
  v.minNativeCode > v.versionCode ||
  v.channel !== "stable"
)
  throw Error("Invalid version.json");
const nativeCode = v.nativeCode ?? v.versionCode;
const nativeVersion = v.nativeVersion ?? v.version;
if (
  !Number.isSafeInteger(nativeCode) ||
  nativeCode < v.minNativeCode ||
  !/^\d+\.\d+\.\d+$/.test(nativeVersion)
)
  throw Error("Invalid native version");
const files = new Map();
files.set(
  "app/src/main/assets/game-version.json",
  JSON.stringify({ version: v.version, versionCode: v.versionCode }, null, 2) +
    "\n",
);
files.set(
  "app/src/main/assets/version.js",
  `// version.json에서 생성한 배포 정보\nexport const VERSION = Object.freeze(${JSON.stringify(v, null, 2)});\n`,
);
const manifest = fs
  .readFileSync("app/src/main/AndroidManifest.xml", "utf8")
  .replace(/android:versionCode="\d+"/, `android:versionCode="${nativeCode}"`)
  .replace(
    /android:versionName="[^"]+"/,
    `android:versionName="${nativeVersion}"`,
  );
files.set("app/src/main/AndroidManifest.xml", manifest);
const gradle = fs
  .readFileSync("app/build.gradle", "utf8")
  .replace(/versionCode \d+/, `versionCode ${nativeCode}`)
  .replace(/versionName '[^']+'/, `versionName '${nativeVersion}'`);
files.set("app/build.gradle", gradle);
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
pkg.version = v.version;
files.set("package.json", JSON.stringify(pkg, null, 2) + "\n");
for (const [file, data] of files) {
  if (process.argv.includes("--check")) {
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== data)
      throw Error(`Run node tools/version.mjs: ${file}`);
  } else fs.writeFileSync(file, data);
}
console.log(
  `FERAL ${v.version} (${v.versionCode}), minimum native ${v.minNativeCode}`,
);
