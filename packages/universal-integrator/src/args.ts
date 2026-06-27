import { resolve } from "path";

export interface Args {
  service: string;
  simRepo: string;
  dryRun: boolean;
  outDir: string;
  verbose: boolean;
}

export function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let service = "";
  let simRepo = resolve(process.cwd());
  let dryRun = false;
  let outDir = resolve("./generated");
  let verbose = false;

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--sim-repo":
        simRepo = resolve(argv[++i] ?? ".");
        break;
      case "--out":
        outDir = resolve(argv[++i] ?? "./generated");
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--verbose":
      case "-v":
        verbose = true;
        break;
      default:
        if (!argv[i]!.startsWith("--") && !service) service = argv[i]!;
    }
  }
  return { service, simRepo, dryRun, outDir, verbose };
}
