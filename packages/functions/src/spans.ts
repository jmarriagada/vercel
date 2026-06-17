export type Spans = {
  resourceSpans?: Array<{
    scopeSpans: Array<{
      scope?: { name: string; version?: string };
      spans?: Array<{
        traceId: string;
        spanId: string;
        parentSpanId?: string;
        name: string;
        kind: number;
        startTimeUnixNano: string;
        endTimeUnixNano: string;
        attributes: IKeyValue[];
        droppedAttributesCount: number;
        events: unknown[];
        droppedEventsCount: number;
        status: { code: number; message?: string };
        links: unknown[];
        droppedLinksCount: number;
      }>;
    }>;
  }>;
};

export interface SpanContext {
  traceId: string;
  spanId: string;
  traceFlags?: number;
}

export interface IKeyValue {
  key: string;
  value: IAnyValue;
}

export interface IAnyValue {
  stringValue?: string | null;
  boolValue?: boolean;
  intValue?: number;
  doubleValue?: number;
}
