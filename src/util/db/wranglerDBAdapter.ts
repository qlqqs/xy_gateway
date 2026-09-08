import { execFileSync } from "child_process";
import { DBAdapter } from "./dbAdapter";

export class WranglerDBAdapter implements DBAdapter {
    private target: "--local" | "--remote";
    private configPath: string;
    private dbName: string;

    constructor(target: "--local" | "--remote", configPath: string = "", dbName: string = "gt_ai_gateway") {
        this.target = target;
        this.configPath = configPath;
        this.dbName = dbName;
    }

    private runWrangler(args: string[]): string {
        const command = process.platform === "win32" ? "npx.cmd" : "npx";
        const commandArgs = ["wrangler", "d1", "execute", this.dbName, this.target];
        if (this.configPath) {
            commandArgs.push("--config", this.configPath);
        }
        commandArgs.push(...args);
        console.log(`> ${command} ${commandArgs.join(" ")}`);
        try {
            const output = execFileSync(command, commandArgs, { encoding: "utf-8", stdio: "pipe" });
            return output;
        } catch (e: any) {
            console.error("Wrangler command failed:", e.message);
            if (e.stdout) console.error("stdout:", e.stdout);
            if (e.stderr) console.error("stderr:", e.stderr);
            throw e;
        }
    }

    exec(sql: string): void {
        // 使用参数数组保留换行和引号。迁移常以 `--` 注释开头，压平为单行会使
        // 整份 SQL 被 SQLite 当作注释；拼 shell 字符串还会引入额外转义风险。
        this.runWrangler(["--command", sql]);
    }

    query<T>(sql: string): T[] {
        // Wrangler --json output format: [{results: [...], success: true, ...}]
        const output = this.runWrangler(["--json", "--command", sql]);
        try {
            const match = output.match(/\[.*\]/s);
            if (match) {
                const parsed = JSON.parse(match[0]);
                // wrangler d1 returns [{results: [...]}], extract the actual rows
                if (
                    Array.isArray(parsed) &&
                    parsed.length > 0 &&
                    Array.isArray(parsed[0]?.results)
                ) {
                    return parsed[0].results as T[];
                }
                return parsed as T[];
            }
            return [];
        } catch (e) {
            return [];
        }
    }

    run(sql: string): void {
        this.exec(sql);
    }

    close(): void {
        // No-op
    }
}
