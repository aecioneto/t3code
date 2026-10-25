import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { evaluateGolden, type GoldenEntry } from "../src/golden.ts";
import type { ProjectProfile } from "../src/profile.ts";

const dir = process.env.T3_GOLDEN_DIR ?? NodePath.join(process.env.HOME ?? "", "t3-golden");
const readLines = (file: string): ReadonlyArray<GoldenEntry> =>
  NodeFS.readFileSync(NodePath.join(dir, file), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as GoldenEntry);
const profiles = JSON.parse(
  NodeFS.readFileSync(NodePath.join(dir, "profiles.json"), "utf8"),
) as ReadonlyArray<ProjectProfile>;

const report = evaluateGolden(
  [...readLines("routing.real.jsonl"), ...readLines("routing.synthetic.jsonl")],
  profiles,
  undefined,
  { noProjectLabels: ["nada"] },
);
const pct = (value: number, total: number) =>
  total === 0 ? "n/a" : `${((value / total) * 100).toFixed(1)}%`;
console.log(
  `labeled=${report.labeled} top1=${pct(report.top1, report.labeled)} top3=${pct(report.top3, report.labeled)}`,
);
console.log(
  `abstained=${report.abstained} wrong=${report.labeled - report.top1 - report.abstained} precision-when-answered=${pct(report.top1, report.labeled - report.abstained)}`,
);
console.log(`modes ${JSON.stringify(report.modes)}`);
console.log(
  `no-project prompts=${report.unlabeled} asked=${pct(report.unlabeledAsked, report.unlabeled)}`,
);
console.log(`misses=${report.misses.length}`);
