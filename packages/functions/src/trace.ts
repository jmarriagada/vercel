import { getContext } from './get-context';
import type { IAnyValue, IKeyValue, SpanContext, Spans } from './spans';

const SCOPE_NAME = 'vercel.functions';
const INTERNAL_SPAN_KIND = 1;
const ZERO_SPAN_CONTEXT: SpanContext = {
  traceId: '00000000000000000000000000000000',
  spanId: '0000000000000000',
  traceFlags: 0,
};

export interface Instrument {
  createSpan(name: string): Instrument;
  setAttribute(key: string, value: SpanAttributeValue): Instrument;
  setAttributes(attributes: Record<string, SpanAttributeValue>): Instrument;
  end(): void;
}

type SpanAttributeValue = string | number | boolean | null | undefined;

class NoopSpan implements Instrument {
  end() {
    console.info('[trace] noop span end');
  }
  createSpan(name: string) {
    console.info('[trace] noop child span requested', { name });
    return this;
  }
  setAttribute(key: string, value: SpanAttributeValue) {
    console.info('[trace] noop span attribute set', { key, value });
    return this;
  }
  setAttributes(attributes: Record<string, SpanAttributeValue>) {
    console.info('[trace] noop span attributes set', { attributes });
    return this;
  }
}

class Span implements Instrument {
  private startTime = unixTimeNano();
  private startHrTime = process.hrtime.bigint();
  private ended = false;
  private spanContext: SpanContext;
  private attributes: IKeyValue[] = [];

  constructor(
    readonly name: string,
    private readonly parent: SpanContext,
    private reportSpans: (spans: Spans) => void
  ) {
    this.spanContext = {
      traceId: parent.traceId,
      spanId: allocateSpanId(),
      traceFlags: parent.traceFlags,
    };
    console.info('[trace] span created', {
      name,
      traceId: this.spanContext.traceId,
      spanId: this.spanContext.spanId,
      parentSpanId: parent.spanId,
      traceFlags: this.spanContext.traceFlags,
      startTimeUnixNano: this.startTime.toString(),
    });
  }

  createSpan(name: string) {
    console.info('[trace] child span requested', {
      name,
      parentName: this.name,
      parentSpanId: this.spanContext.spanId,
      traceId: this.spanContext.traceId,
    });
    return new Span(name, this.spanContext, this.reportSpans);
  }

  setAttribute(key: string, value: SpanAttributeValue) {
    const attribute = toKeyValue(key, value);
    const existingAttributeIndex = this.attributes.findIndex(
      ({ key: attributeKey }) => attributeKey === key
    );

    if (existingAttributeIndex === -1) {
      this.attributes.push(attribute);
    } else {
      this.attributes[existingAttributeIndex] = attribute;
    }

    console.info('[trace] span attribute set', {
      name: this.name,
      spanId: this.spanContext.spanId,
      key,
      value,
    });

    return this;
  }

  setAttributes(attributes: Record<string, SpanAttributeValue>) {
    for (const [key, value] of Object.entries(attributes)) {
      this.setAttribute(key, value);
    }

    return this;
  }

  end() {
    if (this.ended) {
      console.warn('[trace] span already ended', {
        name: this.name,
        spanId: this.spanContext.spanId,
      });
      return;
    }

    const endedAt = this.startTime + process.hrtime.bigint() - this.startHrTime;
    const payload: Spans = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              scope: { name: SCOPE_NAME },
              spans: [
                {
                  traceId: this.spanContext.traceId,
                  spanId: this.spanContext.spanId,
                  parentSpanId: this.parent.spanId,
                  name: this.name,
                  kind: INTERNAL_SPAN_KIND,
                  startTimeUnixNano: this.startTime.toString(),
                  endTimeUnixNano: endedAt.toString(),
                  attributes: this.attributes,
                  droppedAttributesCount: 0,
                  events: [],
                  droppedEventsCount: 0,
                  status: { code: 0 },
                  links: [],
                  droppedLinksCount: 0,
                },
              ],
            },
          ],
        },
      ],
    };

    console.info('[trace] reporting span', {
      name: this.name,
      traceId: this.spanContext.traceId,
      spanId: this.spanContext.spanId,
      parentSpanId: this.parent.spanId,
      startTimeUnixNano: this.startTime.toString(),
      endTimeUnixNano: endedAt.toString(),
      durationMs: Number(endedAt - this.startTime) / 1_000_000,
      payload: JSON.stringify(payload, null, 2),
    });

    this.reportSpans(payload);
    this.ended = true;
    console.info('[trace] span ended', {
      name: this.name,
      spanId: this.spanContext.spanId,
    });
  }
}

export function createRootSpan(name: string): Instrument {
  const context = getContext();
  const telemetry = context?.telemetry;
  if (telemetry?.reportSpans && telemetry.rootSpanContext) {
    console.info('[trace] creating root span', {
      name,
      rootSpanContext: telemetry.rootSpanContext,
      hasReportSpans: true,
      contextKeys: Object.keys(context),
    });
    return new Span(name, telemetry.rootSpanContext, telemetry.reportSpans);
  }
  console.warn('[trace] no span context in request context, nooping', {
    name,
    hasTelemetry: !!telemetry,
    hasReportSpans: !!telemetry?.reportSpans,
    hasRootSpanContext: !!telemetry?.rootSpanContext,
    contextKeys: Object.keys(context),
  });
  return new NoopSpan();
}

function toKeyValue(key: string, value: SpanAttributeValue): IKeyValue {
  return { key, value: toAnyValue(value) };
}

function toAnyValue(value: SpanAttributeValue): IAnyValue {
  if (typeof value === 'string') {
    return { stringValue: value };
  }

  if (typeof value === 'boolean') {
    return { boolValue: value };
  }

  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { intValue: value }
      : { doubleValue: value };
  }

  return { stringValue: null };
}

function unixTimeNano(): bigint {
  return BigInt(Date.now()) * 1000000n;
}

function allocateSpanId(): string {
  let spanId = '';

  do {
    spanId = '';
    for (let i = 0; i < 2; i++) {
      spanId += ((Math.random() * 2 ** 32) >>> 0).toString(16).padStart(8, '0');
    }
  } while (spanId === ZERO_SPAN_CONTEXT.spanId);

  return spanId;
}
