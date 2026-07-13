// Minimal SSE parser over a fetch body stream. Handles multi-line data,
// event names, and chunk boundaries that split lines — providers' streams
// fragment arbitrarily and a naive split("\n\n") corrupts under load.

export interface SseEvent {
  event: string | null;
  data: string;
}

export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  let eventName: string | null = null;
  let dataLines: string[] = [];

  const flush = (): SseEvent | null => {
    if (dataLines.length === 0) return null;
    const evt = { event: eventName, data: dataLines.join("\n") };
    eventName = null;
    dataLines = [];
    return evt;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, "");
        buffer = buffer.slice(newlineIdx + 1);

        if (line === "") {
          const evt = flush();
          if (evt) yield evt;
        } else if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
        // comments (":") and other fields are ignored per the SSE spec
      }
    }
    const evt = flush();
    if (evt) yield evt;
  } finally {
    reader.releaseLock();
  }
}
