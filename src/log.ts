/** One JSON line per event on stdout, pino's shape (level 30 info, 40 warn, 50 error) so the log collector reads it unchanged. */
export type Logger = {
  readonly info: (fields: Record<string, unknown>, msg: string) => void;
  readonly warn: (fields: Record<string, unknown>, msg: string) => void;
  readonly error: (fields: Record<string, unknown>, msg: string) => void;
};

export function jsonLogger(write: (line: string) => void = (l) => void process.stdout.write(`${l}\n`), now: () => Date = () => new Date()): Logger {
  const at = (level: number) => (fields: Record<string, unknown>, msg: string): void =>
    write(JSON.stringify({ level, time: now().getTime(), service: "viafrei-database", ...fields, msg }));
  return { info: at(30), warn: at(40), error: at(50) };
}
