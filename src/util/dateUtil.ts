/**
 * Convert an application Date to the textual value accepted by each
 * persistence driver. SQLite accepts ISO-8601 strings, while MySQL's
 * strict TIMESTAMP/DATETIME mode rejects the `T...Z` form and requires a
 * `YYYY-MM-DD HH:mm:ss` value.
 */
function toDatabaseTimestamp(value: Date): string {
    const iso = value.toISOString();
    if (typeof process !== "undefined" && process.env.DB_DRIVER === "mysql") {
        return iso.slice(0, 19).replace("T", " ");
    }
    return iso;
}

export default { toDatabaseTimestamp };
