import dbMigrationService from "../src/service/dbMigrationService";
import { DBAdapter } from "../src/util/db/dbAdapter";

const args = process.argv.slice(2);

// 解析命令行参数
let command = "";
let env = "node";

for (let i = 0; i < args.length; i++) {
    if (args[i] === "--env" || args[i] === "-e") {
        env = args[i + 1] || "";
        i++;
    } else if (!command) {
        command = args[i];
    }
}

// 主入口
async function main() {
    if (!command) {
        console.error(
            "Usage: npx tsx script/db.ts <command> [--env node|test]",
        );
        console.error("Commands: migrate, status, clear, init");
        process.exit(1);
    }

    if (env !== "node" && env !== "test") {
        console.error(
            `Invalid environment: ${env || "(missing)"}. Must be node or test.`,
        );
        process.exit(1);
    }

    const environment: "node" | "test" = env;

    console.log(`=== DB Automation Script ===`);
    console.log(`Command: ${command}`);
    console.log(`Environment: ${env}`);
    console.log(`============================\n`);

    let adapter: DBAdapter;
    try {
        adapter = dbMigrationService.createDBAdapter(environment);
    } catch (e: any) {
        console.error("Failed to initialize database adapter:", e.message);
        process.exit(1);
    }

    try {
        switch (command) {
            case "migrate":
                await dbMigrationService.migrate(adapter, environment);
                break;
            case "status":
                await dbMigrationService.status(adapter, environment);
                break;
            case "clear":
                await dbMigrationService.clear(adapter, environment);
                break;
            case "init":
                await dbMigrationService.init(adapter, environment);
                break;
            default:
                console.error(`Unknown command: ${command}`);
                console.log("Available commands: migrate, status, clear, init");
                process.exit(1);
        }
    } catch (e) {
        console.error("\nExecution failed:");
        console.error(e);
        process.exit(1);
    } finally {
        await adapter.close();
    }
}

// Only run main() if this file is executed directly as a CLI script.
// require.main === module is unreliable when bundled with esbuild (always true at top level).
// Use argv[1] instead: when run as `npx tsx script/db.ts`, argv[1] contains 'db.ts'.
const _scriptPath = process.argv[1] || "";
if (_scriptPath.endsWith("db.ts") || _scriptPath.endsWith("db.js") || _scriptPath.includes("/script/db")) {
    main();
}
