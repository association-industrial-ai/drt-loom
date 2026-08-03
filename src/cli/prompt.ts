/**
 * Minimal interactive prompting over node:readline/promises.
 *
 * Deliberately plain: no cursor control, no alternate screen, nothing that
 * breaks when the output is piped to a file or read by CI.
 */

import { createInterface, type Interface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export class Prompter {
  private rl: Interface | null = null;

  private io(): Interface {
    if (!this.rl) this.rl = createInterface({ input: stdin, output: stdout });
    return this.rl;
  }

  /** Free-text question. Empty input takes `fallback`. */
  async text(question: string, fallback: string): Promise<string> {
    const answer = (await this.io().question(`${question} [${fallback}]: `)).trim();
    return answer === "" ? fallback : answer;
  }

  /** One of `choices`. Re-asks until the answer is valid. */
  async choice<T extends string>(
    question: string,
    choices: readonly T[],
    fallback: T,
  ): Promise<T> {
    for (;;) {
      const answer = (
        await this.io().question(`${question} (${choices.join(" / ")}) [${fallback}]: `)
      )
        .trim()
        .toLowerCase();
      if (answer === "") return fallback;
      const hit = choices.find((c) => c.toLowerCase() === answer);
      if (hit) return hit;
      console.log(`  "${answer}" is not one of ${choices.join(", ")}. Try again.`);
    }
  }

  async confirm(question: string, fallback: boolean): Promise<boolean> {
    const answer = (await this.io().question(`${question} (y/n) [${fallback ? "y" : "n"}]: `))
      .trim()
      .toLowerCase();
    if (answer === "") return fallback;
    return answer.startsWith("y");
  }

  /**
   * Numbered multi-select. Accepts "1,3", "all", "none", or empty for the
   * pre-selected default. Re-asks on an out-of-range number rather than
   * silently dropping it.
   */
  async multiSelect(
    question: string,
    options: { key: string; label: string; hint: string; preselected: boolean }[],
  ): Promise<Set<string>> {
    console.log(`\n${question}`);
    options.forEach((o, i) => {
      console.log(`  ${i + 1}) [${o.preselected ? "x" : " "}] ${o.label.padEnd(12)} ${o.hint}`);
    });
    const preselected = options.filter((o) => o.preselected).map((o) => o.key);

    for (;;) {
      const raw = (
        await this.io().question(
          `Select numbers, comma separated — "all", "none", or Enter for [${
            preselected.join(", ") || "none"
          }]: `,
        )
      ).trim();

      if (raw === "") return new Set(preselected);
      if (raw.toLowerCase() === "all") return new Set(options.map((o) => o.key));
      if (raw.toLowerCase() === "none") return new Set();

      const picked = new Set<string>();
      let bad: string | null = null;
      for (const token of raw.split(/[,\s]+/).filter(Boolean)) {
        const n = Number(token);
        if (!Number.isInteger(n) || n < 1 || n > options.length) {
          bad = token;
          break;
        }
        picked.add(options[n - 1]!.key);
      }
      if (bad === null) return picked;
      console.log(`  "${bad}" is not a number between 1 and ${options.length}. Try again.`);
    }
  }

  close(): void {
    this.rl?.close();
    this.rl = null;
  }
}

/** True when there is a human on the other end to answer a question. */
export function isInteractive(): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY);
}
