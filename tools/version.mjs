import fs from "node:fs";
const v = JSON.parse(fs.readFileSync("version.json", "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(v.version) || !Number.isSafeInteger(v.versionCode) || v.versionCode < 3 || v.minNativeCode > v.versionCode || v.channel !== "stable") throw Error("Invalid version.json");
const files = new Map();
files.set("app/src/main/assets/version.js", `// version.json에서 생성한 배포 정보\nexport const VERSION = Object.freeze(${JSON.stringify(v, null, 2)});\n`);
const manifest = fs.readFileSync("app/src/main/AndroidManifest.xml", "utf8").replace(/android:versionCode="\d+"/, `android:versionCode="${v.versionCode}"`).replace(/android:versionName="[^"]+"/, `android:versionName="${v.version}"`);
files.set("app/src/main/AndroidManifest.xml", manifest);
const gradle = fs.readFileSync("app/build.gradle", "utf8").replace(/versionCode \d+/, `versionCode ${v.versionCode}`).replace(/versionName '[^']+'/, `versionName '${v.version}'`);
files.set("app/build.gradle", gradle);
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
pkg.version = v.version;
files.set("package.json", JSON.stringify(pkg, null, 2) + "\n");
for (const [file, data] of files) {
  if (process.argv.includes("--check")) {
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== data) throw Error(`Run node tools/version.mjs: ${file}`);
  } else fs.writeFileSync(file, data);
}
console.log(`FERAL ${v.version} (${v.versionCode}), minimum native ${v.minNativeCode}`);
