import { existsSync, readFileSync } from "fs";
import { join } from "path";
import requestHelper from "./requestHelper";

const STREAM_LOG_DIR = join(process.cwd(), "log", "stream");


/**
 * Enable stream log writing by setting the DB config via the config API.
 * dbHelper.truncate() wipes the config table and clears the server cache, so
 * this must be called after truncate in test setup when the test class needs
 * stream logs to be written. The server-side configService cache is updated by
 * the API handler, so no extra cache-clear is needed.
 */
async function enableStreamLog(adminToken: string): Promise<void> {
    await requestHelper.put(
        "/config.json",
        { stream_log_enabled: "true" },
        adminToken,
    );
}

async function waitForStreamLog(recordId: number): Promise<string> {
    const logPath = join(STREAM_LOG_DIR, `${recordId}.log`);

    for (let i = 0; i < 20; i++) {
        if (existsSync(logPath)) {
            return logPath;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(`Stream log not found for record ${recordId}: ${logPath}`);
}


async function waitForRequestLog(recordId: number): Promise<string> {
    const logPath = join(STREAM_LOG_DIR, `${recordId}.after_convert_req.log`);

    for (let i = 0; i < 20; i++) {
        if (existsSync(logPath)) {
            return logPath;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(`Request log not found for record ${recordId}: ${logPath}`);
}


async function readStreamLog(recordId: number): Promise<string> {
    const sourcePath = await waitForStreamLog(recordId);
    return readFileSync(sourcePath, "utf-8");
}


async function readRequestLog(recordId: number): Promise<string> {
    const sourcePath = await waitForRequestLog(recordId);
    return readFileSync(sourcePath, "utf-8");
}


export default {
    enableStreamLog,
    readRequestLog,
    readStreamLog,
};
