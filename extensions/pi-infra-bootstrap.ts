import core from "/Users/andrewjochl/Developer/pi-infra/packages/core/index.ts";
import wikiJanitor from "/Users/andrewjochl/Developer/pi-infra/packages/wiki-janitor/index.ts";
import { loadPersonas } from "/Users/andrewjochl/Developer/pi-infra/packages/personas/index.ts";
import { loadIntegrations } from "/Users/andrewjochl/Developer/pi-infra/packages/integrations/index.ts";
import { provision } from "/Users/andrewjochl/Developer/pi-infra/packages/provisioner/index.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default async function (pi: ExtensionAPI) {
  console.log("[pi-infra] Starting federated bootstrap...");

  // Provisioner runs FIRST: handles version sync, hardware profiling,
  // node registration with Cloud VPS, and respects Dual Memory Architecture.
  // packages/memory is intentionally NOT loaded here -- it's a no-op as of
  // 62e78a4; core/index.ts handles memory initialization in its session_start.
  await provision(pi);

  console.log("[pi-infra] Bootstrap loaded -- initializing full system.");
  core(pi);
  wikiJanitor(pi);
  loadIntegrations(pi);
  loadPersonas(pi);
}
