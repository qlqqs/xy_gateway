import type { ProtocolStreamEvent } from "../protocolConverter/protocolTypes";

interface ParsedSSEEvent extends ProtocolStreamEvent {}

interface SplitSSEEventsResult {
    events: string[];
    remainingBuffer: string;
}

function splitEvents(buffer: string): SplitSSEEventsResult {
    const events: string[] = [];
    const delimiter = /\r?\n\r?\n/g;
    let eventStart = 0;
    let match: RegExpExecArray | null;

    while ((match = delimiter.exec(buffer)) !== null) {
        events.push(buffer.slice(eventStart, match.index));
        eventStart = delimiter.lastIndex;
    }

    return {
        events,
        remainingBuffer: buffer.slice(eventStart),
    };
}


function parseEvent(event: string): ParsedSSEEvent | null {
    const lines = event.split(/\r?\n/);
    const dataLines = lines.filter((line) => line.startsWith("data:"));
    const data = dataLines.map((line) => line.slice(5).trim()).join("\n");
    if (!data) {
        return null;
    }

    const eventType = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || undefined;
    const id = lines.find((line) => line.startsWith("id:"))?.slice(3).trim() || undefined;
    return { data, event: eventType, id };
}


export default {
    splitEvents,
    parseEvent,
};
