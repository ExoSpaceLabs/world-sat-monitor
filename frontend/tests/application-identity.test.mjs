import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);

test("application identity exposes ExoSpaceLabs and v1.0.0", async () => {
  const [page, about, application, aboutStyles, packageJson] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/components/about/AboutPanel.tsx", root), "utf8"),
    readFile(new URL("app/domain/application.ts", root), "utf8"),
    readFile(new URL("app/components/about/styles.css", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);
  const pkg = JSON.parse(packageJson);

  assert.equal(pkg.version, "1.0.0");
  assert.match(page, /<AboutControl\/>/);
  assert.match(application, /owner: "ExoSpaceLabs"/);
  assert.match(application, /version: "1\.0\.0"/);
  assert.match(application, /https:\/\/github\.com\/ExoSpaceLabs\/world-sat-monitor/);
  assert.match(application, /exispacelabs@gmail\.com/);
  assert.match(about, /APPLICATION_INFO\.version/);
  assert.match(aboutStyles, /EXOSPACELABS/);
  assert.match(aboutStyles, /\.brand small::after/);
});
