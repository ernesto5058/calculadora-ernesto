// Dispara la construccion del APK (evento repository_dispatch "build-apk")
// usando el token propio de la corrida del vigia — el token vive y muere
// dentro de GitHub Actions, nunca sale de ahi.
import { readFileSync } from "fs";
let v = { version_name: "1.0.0", version_code: "10000" };
try {
  const o = JSON.parse(readFileSync("orden-build.json", "utf8"));
  if (o.version_name) v.version_name = String(o.version_name);
  if (o.version_code) v.version_code = String(o.version_code);
} catch (e) {}
const t = process.env.GH_TOKEN;
const r = await fetch("https://api.github.com/repos/ernesto5058/calculadora-ernesto/dispatches", {
  method: "POST",
  headers: {
    Authorization: "Bearer " + t,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "vigia-dispatch"
  },
  body: JSON.stringify({ event_type: "build-apk", client_payload: v })
});
console.log("dispatch HTTP " + r.status);
if (r.status !== 204) {
  console.log((await r.text()).slice(0, 400));
  process.exit(1);
}
console.log("Build disparado: v" + v.version_name + " (" + v.version_code + ")");
