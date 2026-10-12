import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);

test("application identity matches the declared release version", async () => {
  const [page, about, application, aboutStyles, packageJson, lockJson, versionText, readme] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/components/about/AboutPanel.tsx", root), "utf8"),
    readFile(new URL("app/domain/application.ts", root), "utf8"),
    readFile(new URL("app/components/about/styles.css", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("package-lock.json", root), "utf8"),
    readFile(new URL("../VERSION", root), "utf8"),
    readFile(new URL("../README.md", root), "utf8"),
  ]);
  const pkg = JSON.parse(packageJson);
  const lock = JSON.parse(lockJson);
  const version = versionText.trim();

  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version, version);
  assert.equal(lock.version, version);
  assert.equal(lock.packages[""].version, version);
  assert.match(page, /<AboutControl\/>/);
  assert.match(application, /owner: "ExoSpaceLabs"/);
  assert.ok(application.includes(`version: "${version}"`));
  assert.ok(readme.includes(`Current release: **v${version}**`));
  assert.match(application, /https:\/\/github\.com\/ExoSpaceLabs\/world-sat-monitor/);
  assert.match(application, /exospacelabs@gmail\.com/);
  assert.match(readme, /exospacelabs@gmail\.com/);
  assert.doesNotMatch(application, /exispacelabs@gmail\.com/);
  assert.doesNotMatch(readme, /exispacelabs@gmail\.com/);
  assert.match(about, /APPLICATION_INFO\.version/);
  assert.match(aboutStyles, /EXOSPACELABS/);
  assert.match(aboutStyles, /\.brand small::after/);
});
